import { describe, it, expect } from 'vitest'
import { commands } from 'vitest/browser'
import { Agent, DocumentBlock, ImageBlock, Message, TextBlock, tool } from '@strands-agents/sdk'
import { BedrockModel } from '@strands-agents/sdk/bedrock'
import { OpenAIModel } from '@strands-agents/sdk/openai'
import { notebook } from '@strands-agents/sdk/vended_tools/notebook'
import { httpRequest } from '@strands-agents/sdk/vended_tools/http_request'
import { z } from 'zod'

import { collectGenerator } from '$/sdk/__fixtures__/model-test-helpers.js'

// Import fixtures
import yellowPngUrl from '../__resources__/yellow.png?url'

// Environment detection for browser vs Node.js
const isNode = typeof process !== 'undefined' && typeof process.versions !== 'undefined' && !!process.versions.node

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
    createModel: async () => {
      const credentials = await commands.getAwsCredentials()
      return new BedrockModel({
        region: 'us-east-1',
        clientConfig: {
          credentials,
        },
      })
    },
  },
  {
    name: 'OpenAIModel',
    createModel: async () =>
      new OpenAIModel({
        apiKey: await commands.getOpenAIAPIKey(),
        clientConfig: {
          dangerouslyAllowBrowser: true,
        },
      }),
  },
]

describe.each(providers)('Agent Browser Tests with $name', async ({ name, createModel }) => {
  describe(`${name} Browser Integration`, () => {
    it('handles basic invocation', async () => {
      const agent = new Agent({ model: await createModel(), printer: false })
      const result = await agent.invoke('Say hello in one word')

      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')
      expect(result.lastMessage.content.length).toBeGreaterThan(0)
    })

    it('handles tool use', async () => {
      const agent = new Agent({
        model: await createModel(),
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
        model: await createModel(),
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

      const result = await agent.invoke('Answer the question!')

      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')
    })
  })

  it('handles tool invocation', async () => {
    const agent = new Agent({
      model: await createModel(),
      tools: [notebook, httpRequest],
      printer: false,
    })

    await agent.invoke('Call Open-Meteo to get the weather in NYC, and take a note of it')

    expect(
      agent.messages.some((message) =>
        message.content.some((block) => block.type == 'toolUseBlock' && block.name == 'notebook')
      )
    ).toBe(true)
    expect(
      agent.messages.some((message) =>
        message.content.some((block) => block.type == 'toolUseBlock' && block.name == 'http_request')
      )
    ).toBe(true)
  })
})
