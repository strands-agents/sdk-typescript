import { describe, it, expect } from 'vitest'
import { Agent, DocumentBlock, ImageBlock, Message, TextBlock, tool, type Model } from '@strands-agents/sdk'
import { notebook } from '@strands-agents/sdk/vended_tools/notebook'
import { httpRequest } from '@strands-agents/sdk/vended_tools/http_request'
import { z } from 'zod'
import {
  createBedrockModel,
  createOpenAIModel,
  shouldSkipBedrockTests,
  collectGenerator,
  shouldSkipOpenAITests,
} from './__fixtures__/model-test-helpers.js'
import { loadFixture } from './__fixtures__/test-helpers.js'

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
    skip: shouldSkipBedrockTests,
    createModel: () => createBedrockModel(),
  },
  {
    name: 'OpenAIModel',
    skip: shouldSkipOpenAITests,
    createModel: () => createOpenAIModel(),
  },
] satisfies Array<{
  name: string
  skip: () => Promise<boolean>
  createModel: () => Model
}>

describe.each(providers)('Agent with $name', async ({ name, skip, createModel }) => {
  describe(`${name} Integration Tests`, { skip: await skip(), timeout: 60000 }, () => {
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

      it('yields metadata events through the agent stream', async () => {
        const agent = new Agent({
          model: createModel(),
          printer: false,
          systemPrompt: 'Respond with a brief greeting.',
        })

        // Test streaming with event collection
        const { items, result } = await collectGenerator(agent.stream('Say hello'))

        // Verify metadata event is yielded through the agent
        const metadataEvent = items.find((item) => item.type === 'modelMetadataEvent')
        expect(metadataEvent).toBeDefined()
        expect(metadataEvent?.usage).toBeDefined()
        expect(metadataEvent?.usage?.inputTokens).toBeGreaterThan(0)
        expect(metadataEvent?.usage?.outputTokens).toBeGreaterThan(0)

        // Bedrock includes latencyMs in metrics, OpenAI does not
        if (name === 'BedrockModel') {
          expect(metadataEvent?.metrics?.latencyMs).toBeGreaterThan(0)
        }

        // Verify result structure
        expect(result.stopReason).toBe('endTurn')
        expect(result.lastMessage.role).toBe('assistant')
        expect(result.lastMessage.content.length).toBeGreaterThan(0)
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
        expect(agent.messages[0]?.role).toBe('user')
        expect(agent.messages[1]?.role).toBe('assistant')
        expect(agent.messages[2]?.role).toBe('user')
        expect(agent.messages[3]?.role).toBe('assistant')

        // Verify conversation context is preserved
        const lastMessage = agent.messages.at(-1)
        const textContent = lastMessage?.content.find((block) => block.type === 'textBlock')
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
        const imageBytes = await loadFixture(yellowPngUrl)
        const imageBlock = new ImageBlock({
          format: 'png',
          source: { bytes: imageBytes },
        })

        // Initialize agent with messages array containing Message instance
        // Note: Bedrock requires a text block when using documents
        const agent = new Agent({
          model: createModel(),
          messages: [
            new Message({
              role: 'user',
              content: [
                docBlock,
                imageBlock,
                new TextBlock(
                  'I shared a document and an image. What animal is in the document and what color is the image? Answer briefly.'
                ),
              ],
            }),
          ],
          printer: false,
        })

        const result = await agent.invoke([])

        expect(result.stopReason).toBe('endTurn')
        expect(result.lastMessage.role).toBe('assistant')

        // Response should reference both the document content and image color
        const textContent = result.lastMessage.content.find((block) => block.type === 'textBlock')
        expect(textContent).toBeDefined()
        expect(textContent?.text).toMatch(/zebra/i)
        expect(textContent?.text).toMatch(/yellow/i)
      })
    })

    describe('multimodal input', () => {
      it('accepts ContentBlock[] input', async () => {
        const agent = new Agent({
          model: createModel(),
          printer: false,
        })

        const yellowPng = await loadFixture(yellowPngUrl)
        const imageBlock = new ImageBlock({
          format: 'png',
          source: { bytes: yellowPng },
        })

        const contentBlocks = [new TextBlock('What color is this image? Answer in one word.'), imageBlock]

        const result = await agent.invoke(contentBlocks)

        expect(result.stopReason).toBe('endTurn')
        expect(result.lastMessage.role).toBe('assistant')

        const textContent = result.lastMessage.content.find((block) => block.type === 'textBlock')
        expect(textContent).toBeDefined()
        expect(textContent?.text).toMatch(/yellow/i)
      })

      it('accepts Message[] input for conversation history', async () => {
        const agent = new Agent({
          model: createModel(),
          printer: false,
        })

        const conversationHistory = [
          new Message({
            role: 'user',
            content: [new TextBlock('Remember this number: 42')],
          }),
          new Message({
            role: 'assistant',
            content: [new TextBlock('I will remember the number 42.')],
          }),
          new Message({
            role: 'user',
            content: [new TextBlock('What number did I ask you to remember?')],
          }),
        ]

        const result = await agent.invoke(conversationHistory)

        expect(result.stopReason).toBe('endTurn')
        expect(result.lastMessage.role).toBe('assistant')

        const textContent = result.lastMessage.content.find((block) => block.type === 'textBlock')
        expect(textContent).toBeDefined()
        expect(textContent?.text).toMatch(/42/)
      })
    })
  })

  it('handles tool invocation', async () => {
    const agent = new Agent({
      model: createModel(),
      tools: [notebook, httpRequest],
      printer: false,
    })

    await agent.invoke('Call Open-Meteo to get the weather in NYC, and take a note of what you did')
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
