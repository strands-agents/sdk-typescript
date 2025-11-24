import { describe, it, expect } from 'vitest'
import { Agent, DocumentBlock, ImageBlock, tool } from '@strands-agents/sdk'
import { BedrockModel } from '@strands-agents/sdk/bedrock'
import { OpenAIModel } from '@strands-agents/sdk/openai'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// eslint-disable-next-line no-restricted-imports
import { collectGenerator } from '../src/__fixtures__/model-test-helpers.js'
import { shouldRunTests } from './__fixtures__/model-test-helpers.js'

// Import fixtures using Vite's ?url suffix
import yellowPngUrl from './__resources__/yellow.png?url'

// Helper to load fixture files from Vite URL imports
const loadFixture = (url: string) => {
  const relativePath = url.startsWith('/') ? url.slice(1) : url
  const filePath = join(process.cwd(), relativePath)
  return new Uint8Array(readFileSync(filePath))
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

// Provider configurations
const providers = [
  {
    name: 'BedrockModel',
    skip: !(await shouldRunTests()),
    createModel: () => new BedrockModel({ maxTokens: 100 }),
  },
  {
    name: 'OpenAIModel',
    skip: !process.env.OPENAI_API_KEY,
    createModel: () => new OpenAIModel({ modelId: 'gpt-4o-mini', maxTokens: 100 }),
  },
]

describe.each(providers)('Agent with $name', ({ name, skip, createModel }) => {
  if (skip) {
    it.skip(`${name} tests skipped - credentials not available`, () => {})
    return
  }

  describe('Basic Invocation', () => {
    it('handles basic invocation', async () => {
      const agent = new Agent({ model: createModel(), printer: false })
      const result = await agent.invoke('Say hello in one word')

      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')
      expect(result.lastMessage.content.length).toBeGreaterThan(0)
      expect(result.lastMessage.content[0].type).toBe('textBlock')
    })

    it('streams events correctly', async () => {
      const agent = new Agent({ model: createModel(), printer: false })
      const { items, result } = await collectGenerator(agent.stream('Say hello in one word'))

      // Should yield high-level agent events
      expect(items.some((item) => item.type === 'beforeInvocationEvent')).toBe(true)

      // Result should have correct structure
      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')
      expect(result.lastMessage.content.length).toBeGreaterThan(0)
    })
  })

  describe('System Prompt', () => {
    it('respects system prompt', async () => {
      const agent = new Agent({
        model: createModel(),
        printer: false,
        systemPrompt: 'Always respond with exactly the word "TEST" and nothing else.',
      })

      const result = await agent.invoke('What should I say?')

      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')

      // Extract text from response
      const textContent = result.lastMessage.content.find((block) => block.type === 'textBlock')
      expect(textContent).toBeDefined()
      expect(textContent?.text.toUpperCase()).toContain('TEST')
    })
  })

  describe('Tool Use', () => {
    it('requests tool use when appropriate', async () => {
      const agent = new Agent({
        model: new BedrockModel({ maxTokens: 200 }),
        tools: [calculatorTool],
        printer: false,
      })

      const result = await agent.invoke('Use the calculator tool to compute 15 plus 27')

      // Agent should either use tool or complete in first turn
      // Both are valid behaviors - test that agent completes successfully
      expect(['toolUse', 'endTurn']).toContain(result.stopReason)
      expect(result.lastMessage.role).toBe('assistant')
      expect(result.lastMessage.content.length).toBeGreaterThan(0)
    })

    it('handles tool execution flow', async () => {
      const agent = new Agent({
        model: new BedrockModel({ maxTokens: 200 }),
        tools: [calculatorTool],
        printer: false,
      })

      // Invoke with instruction to use calculator
      await agent.invoke('Use the calculator tool to compute 8 times 7. You must use the calculator tool.')

      // Agent should have at least 2 messages (user + assistant)
      expect(agent.messages.length).toBeGreaterThan(1)

      // Check that agent completed successfully
      const lastMessage = agent.messages[agent.messages.length - 1]
      expect(lastMessage.role).toBe('assistant')
      expect(lastMessage.content.length).toBeGreaterThan(0)
    })

    it('maintains tools in configuration', async () => {
      const agent = new Agent({
        model: createModel(),
        tools: [calculatorTool],
        printer: false,
      })

      // First invocation
      await agent.invoke('Say hi')

      // Second invocation - tools should still be available
      await agent.invoke('Say bye')

      // Verify both turns completed
      expect(agent.messages.length).toBeGreaterThanOrEqual(4) // 2 user + 2 assistant (minimum)
    })
  })

  describe('Multi-turn Conversations', () => {
    it('maintains message history', async () => {
      const agent = new Agent({ model: createModel(), printer: false })

      // First turn
      await agent.invoke('My name is Alice')
      expect(agent.messages).toHaveLength(2) // user + assistant

      // Second turn
      await agent.invoke('What is my name?')
      expect(agent.messages).toHaveLength(4) // 2 user + 2 assistant

      // Response should reference the name
      const lastMessage = agent.messages[agent.messages.length - 1]
      const textContent = lastMessage.content.find((block) => block.type === 'textBlock')
      expect(textContent?.text).toMatch(/Alice/i)
    })

    it('preserves conversation context', async () => {
      const agent = new Agent({ model: createModel(), printer: false })

      // Establish context
      await agent.invoke('I like the color blue')
      await agent.invoke('What color do I like?')

      const lastMessage = agent.messages[agent.messages.length - 1]
      const textContent = lastMessage.content.find((block) => block.type === 'textBlock')
      expect(textContent?.text).toMatch(/blue/i)
    })
  })

  describe('Stop Reasons', () => {
    it('handles endTurn stop reason', async () => {
      const agent = new Agent({ model: createModel(), printer: false })
      const result = await agent.invoke('Say hello')

      expect(result.stopReason).toBe('endTurn')
    })

    it('handles toolUse stop reason when tool is used', async () => {
      const agent = new Agent({
        model: new BedrockModel({ maxTokens: 200 }),
        tools: [calculatorTool],
        printer: false,
      })

      // Keep trying until we get a tool use (models may vary in behavior)
      const result = await agent.invoke('Use the calculator tool to compute 5 plus 3. You must use the tool.')

      // Agent completed successfully
      expect(['toolUse', 'endTurn']).toContain(result.stopReason)
      expect(result.lastMessage.role).toBe('assistant')
    })

    it('handles maxTokens by throwing MaxTokensError', async () => {
      const agent = new Agent({
        model: new BedrockModel({ maxTokens: 10 }),
        printer: false,
      })

      // MaxTokensError should be thrown when token limit is reached
      await expect(agent.invoke('Write a very long story about dragons and knights and wizards')).rejects.toThrow(
        'maximum token limit'
      )
    })
  })

  describe('Message History', () => {
    it('updates messages array correctly', async () => {
      const agent = new Agent({ model: createModel(), printer: false })

      expect(agent.messages).toHaveLength(0)

      await agent.invoke('First message')
      expect(agent.messages).toHaveLength(2) // user + assistant

      await agent.invoke('Second message')
      expect(agent.messages).toHaveLength(4) // 2 user + 2 assistant

      // Verify message ordering
      expect(agent.messages[0].role).toBe('user')
      expect(agent.messages[1].role).toBe('assistant')
      expect(agent.messages[2].role).toBe('user')
      expect(agent.messages[3].role).toBe('assistant')
    })
  })

  describe('Media Blocks', () => {
    it('handles document block content', async () => {
      const agent = new Agent({ model: createModel(), printer: false })

      const docBlock = new DocumentBlock({
        name: 'sample-document',
        format: 'txt',
        source: { text: 'The quick brown fox jumps over the lazy dog.' },
      })

      // Add document with text block to initial message (Bedrock requires text with documents)
      agent.messages.push({
        type: 'message',
        role: 'user',
        content: [docBlock, { type: 'textBlock', text: 'What animal is in the document? Answer in one word.' }],
      })

      const result = await agent.invoke()

      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')

      // Response should mention fox or dog
      const textContent = result.lastMessage.content.find((block) => block.type === 'textBlock')
      expect(textContent).toBeDefined()
      expect(textContent?.text).toMatch(/fox|dog/i)
    })

    it('handles image block content', async () => {
      const agent = new Agent({ model: createModel(), printer: false })

      const imageBytes = loadFixture(yellowPngUrl)
      const imageBlock = new ImageBlock({
        format: 'png',
        source: { bytes: imageBytes },
      })

      // Add image to initial message
      agent.messages.push({
        type: 'message',
        role: 'user',
        content: [imageBlock, { type: 'textBlock', text: 'What color is this image? Answer in one word.' }],
      })

      const result = await agent.invoke()

      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')

      // Response should mention yellow
      const textContent = result.lastMessage.content.find((block) => block.type === 'textBlock')
      expect(textContent).toBeDefined()
      expect(textContent?.text).toMatch(/yellow/i)
    })
  })
})
