import { describe, it, expect } from 'vitest'
import { Agent, DocumentBlock, ImageBlock, Message, TextBlock, tool } from '@strands-agents/sdk'
import { BedrockModel } from '@strands-agents/sdk/bedrock'
import { OpenAIModel } from '@strands-agents/sdk/openai'
import { z } from 'zod'

// eslint-disable-next-line no-restricted-imports
import { collectGenerator } from '../src/__fixtures__/model-test-helpers.js'

// Import fixtures
import yellowPngUrl from './__resources__/yellow.png?url'

// Environment detection for browser vs Node.js
const isNode =
  typeof process !== 'undefined' && typeof process.versions !== 'undefined' && !!process.versions.node

// Browser-compatible fixture loader
const loadFixture = async (url: string): Promise<Uint8Array> => {
  if (isNode) {
    // In Node.js, use synchronous file reading
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const relativePath = url.startsWith('/') ? url.slice(1) : url
    const filePath = join(process.cwd(), relativePath)
    return new Uint8Array(readFileSync(filePath))
  } else {
    // In browser, use fetch API
    const response = await globalThis.fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    return new Uint8Array(arrayBuffer)
  }
}

// Helper to get credentials in browser environment
const getAWSCredentials = () => {
  if (isNode) {
    return undefined // Let AWS SDK handle it in Node
  }
  // In browser, use credentials injected via import.meta.env
  return {
    accessKeyId: import.meta.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: import.meta.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: import.meta.env.AWS_SESSION_TOKEN,
  }
}

const getOpenAIAPIKey = () => {
  if (isNode) {
    return process.env.OPENAI_API_KEY
  }
  return import.meta.env.OPENAI_API_KEY
}

// Calculator tool for testing
const calculatorTool = tool({
  name: 'calculator',
  description: 'Performs basic arithmetic operations',
  inputSchema: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
  callback: async ({ operation, a, b }) => {
    const ops = {
      add: a + b,
      subtract: a - b,
      multiply: a * b,
      divide: a / b,
    }
    return `Result: ${ops[operation]}`
  },
})

// Provider configurations with browser credential handling
const providers = [
  {
    name: 'BedrockModel',
    skip: !import.meta.env.AWS_ACCESS_KEY_ID, // Skip if no credentials in browser
    createModel: () => {
      const credentials = getAWSCredentials()
      return new BedrockModel({
        maxTokens: 100,
        ...(credentials && { credentials }),
      })
    },
  },
  {
    name: 'OpenAIModel',
    skip: !getOpenAIAPIKey(),
    createModel: () =>
      new OpenAIModel({
        modelId: 'gpt-4o-mini',
        maxTokens: 100,
        apiKey: getOpenAIAPIKey(),
      }),
  },
]

describe.each(providers)('Agent Browser Tests with $name', ({ name, skip, createModel }) => {
  describe.skipIf(skip)(`${name} Browser Integration`, () => {
    it('handles basic invocation', async () => {
      const agent = new Agent({ model: createModel(), printer: false })
      const result = await agent.invoke('Say hello in one word')

      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')
      expect(result.lastMessage.content.length).toBeGreaterThan(0)
    })

    it('handles tool use', async () => {
      const agent = new Agent({
        model: createModel(),
        printer: false,
        systemPrompt: 'Use the calculator tool to solve math problems. Respond with only the numeric result.',
        tools: [calculatorTool],
      })

      const { result } = await collectGenerator(agent.stream('What is 123 * 456?'))

      // Verify tool was used
      const toolUseMessage = agent.messages.find((msg) => msg.content.some((block) => block.type === 'toolUseBlock'))
      expect(toolUseMessage).toBeDefined()

      // Verify final response
      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')
    })

    it('handles media blocks', async () => {
      const docBlock = new DocumentBlock({
        name: 'test-document',
        format: 'txt',
        source: { text: 'The document contains the word ZEBRA.' },
      })

      const imageBytes = await loadFixture(yellowPngUrl)
      const imageBlock = new ImageBlock({
        format: 'png',
        source: { bytes: imageBytes },
      })

      const agent = new Agent({
        model: createModel(),
        messages: [
          new Message({
            role: 'user',
            content: [
              docBlock,
              imageBlock,
              new TextBlock('What animal is in the document and what color is the image? Answer briefly.'),
            ],
          }),
        ],
        printer: false,
      })

      const result = await agent.invoke()

      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')
    })
  })
})
