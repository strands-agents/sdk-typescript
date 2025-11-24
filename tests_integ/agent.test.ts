import { describe, it, expect } from 'vitest'
import { Agent, DocumentBlock, ImageBlock, Message, tool } from '@strands-agents/sdk'
import { BedrockModel } from '@strands-agents/sdk/bedrock'
import { OpenAIModel } from '@strands-agents/sdk/openai'
import { z } from 'zod'

// eslint-disable-next-line no-restricted-imports
import { collectGenerator } from '../src/__fixtures__/model-test-helpers.js'
import { shouldRunTests } from './__fixtures__/model-test-helpers.js'
import { loadFixture, shouldSkipOpenAITests } from './__fixtures__/test-helpers.js'

// Import fixtures using Vite's ?url suffix
import yellowPngUrl from './__resources__/yellow.png?url'

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

// Provider configurations
const providers = [
  {
    name: 'BedrockModel',
    skip: !(await shouldRunTests()),
    createModel: () => new BedrockModel({ maxTokens: 100 }),
  },
  {
    name: 'OpenAIModel',
    skip: shouldSkipOpenAITests(),
    createModel: () => new OpenAIModel({ modelId: 'gpt-4o-mini', maxTokens: 100 }),
  },
]

describe.each(providers)('Agent with $name', ({ name, skip, createModel }) => {
  describe.skipIf(skip)(`${name} Integration Tests`, () => {
    describe('Basic Functionality', () => {
      it('handles invocation, streaming, system prompts, and tool use', async () => {
        // Test basic invocation with system prompt and tool
        const agent = new Agent({
          model: createModel(),
          printer: false,
          systemPrompt: 'Use the calculator tool to solve math problems. Respond with only the numeric result.',
          tools: [calculatorTool],
        })

        // Test streaming with event collection
        const { items, result } = await collectGenerator(agent.stream('What is 123 * 456?'))

        // Verify high-level agent events are yielded
        expect(items.some((item) => item.type === 'beforeInvocationEvent')).toBe(true)

        // Verify result structure and stop reason
        expect(result.stopReason).toBe('endTurn')
        expect(result.lastMessage.role).toBe('assistant')
        expect(result.lastMessage.content.length).toBeGreaterThan(0)

        // Verify tool was used by checking message history
        const toolUseMessage = agent.messages.find((msg) => msg.content.some((block) => block.type === 'toolUseBlock'))
        expect(toolUseMessage).toBeDefined()

        // Verify final response contains the result (123 * 456 = 56088)
        const textContent = result.lastMessage.content.find((block) => block.type === 'textBlock')
        expect(textContent).toBeDefined()
        expect(textContent?.text).toMatch(/56088/)
      })
    })

    describe('Multi-turn Conversations', () => {
      it('maintains message history and conversation context', async () => {
        const agent = new Agent({ model: createModel(), printer: false })

        // First turn
        await agent.invoke('My name is Alice')
        expect(agent.messages).toHaveLength(2) // user + assistant

        // Second turn
        await agent.invoke('What is my name?')
        expect(agent.messages).toHaveLength(4) // 2 user + 2 assistant

        // Verify message ordering
        expect(agent.messages[0].role).toBe('user')
        expect(agent.messages[1].role).toBe('assistant')
        expect(agent.messages[2].role).toBe('user')
        expect(agent.messages[3].role).toBe('assistant')

        // Verify conversation context is preserved
        const lastMessage = agent.messages[agent.messages.length - 1]
        const textContent = lastMessage.content.find((block) => block.type === 'textBlock')
        expect(textContent?.text).toMatch(/Alice/i)
      })
    })

    describe('Media Blocks', () => {
      it('handles multiple media blocks in single request', async () => {
        // Create document block
        const docBlock = new DocumentBlock({
          name: 'test-document',
          format: 'txt',
          source: { text: 'The document contains the word ZEBRA.' },
        })

        // Create image block
        const imageBytes = loadFixture(yellowPngUrl)
        const imageBlock = new ImageBlock({
          format: 'png',
          source: { bytes: imageBytes },
        })

        // Initialize agent with messages array containing Message instance
        const agent = new Agent({
          model: createModel(),
          messages: [
            new Message({
              role: 'user',
              content: [docBlock, imageBlock],
            }),
          ],
          printer: false,
        })

        const result = await agent.invoke(
          'I shared a document and an image. What animal is in the document and what color is the image? Answer briefly.'
        )

        expect(result.stopReason).toBe('endTurn')
        expect(result.lastMessage.role).toBe('assistant')

        // Response should reference both the document content and image color
        const textContent = result.lastMessage.content.find((block) => block.type === 'textBlock')
        expect(textContent).toBeDefined()
        expect(textContent?.text).toMatch(/zebra/i)
        expect(textContent?.text).toMatch(/yellow/i)
      })
    })
  })
})
