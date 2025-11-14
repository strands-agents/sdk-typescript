import { describe, it, expect } from 'vitest'
import {
  BedrockModel,
  ContextWindowOverflowError,
  Message,
  ToolSpec,
  ModelStreamEvent,
  Agent,
  NullConversationManager,
  SlidingWindowConversationManager,
} from '@strands-agents/sdk'

// eslint-disable-next-line no-restricted-imports
import { collectIterator, collectGenerator } from '../src/__fixtures__/model-test-helpers.js'
import { shouldRunTests } from './__fixtures__/model-test-helpers.js'

describe.skipIf(!(await shouldRunTests()))('BedrockModel Integration Tests', () => {
  describe('Non-Streaming', () => {
    it('gets a simple text response', async () => {
      const provider = new BedrockModel({
        maxTokens: 100,
      })
      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Say hello in exactly one word.' }],
        },
      ]

      const events = await collectIterator(provider.stream(messages))

      // Type-safely extract the complete text response
      const responseText = events.reduce((acc, event) => {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
          return acc + event.delta.text
        }
        return acc
      }, '')

      expect(responseText.trim().toUpperCase()).toContain('HELLO')

      // Verify the stop reason and usage metrics
      const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(stopEvent?.stopReason).toBe('endTurn')

      const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
      expect(metadataEvent?.usage?.outputTokens).toBeGreaterThan(0)
    })

    it('requests tool use when appropriate', async () => {
      const provider = new BedrockModel({
        maxTokens: 200,
      })
      const calculatorTool: ToolSpec = {
        name: 'calculator',
        description: 'Performs basic arithmetic operations',
        inputSchema: {
          type: 'object',
          properties: {
            operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['operation', 'a', 'b'],
        },
      }
      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'What is 15 plus 27?' }],
        },
      ]

      const events = await collectIterator(provider.stream(messages, { toolSpecs: [calculatorTool] }))

      // Accumulate all tool use input deltas to get the complete JSON
      const toolInputDeltas = events.filter(
        (e): e is ModelStreamEvent & { type: 'modelContentBlockDeltaEvent'; delta: { type: 'toolUseInputDelta' } } =>
          e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'toolUseInputDelta'
      )
      expect(toolInputDeltas.length).toBeGreaterThan(0)

      // Concatenate all input deltas to get the complete JSON string
      const completeInput = toolInputDeltas.reduce((acc, event) => acc + event.delta.input, '')
      const input = JSON.parse(completeInput)
      expect(input).toEqual({ operation: 'add', a: 15, b: 27 })

      // Verify the stop reason was tool use
      const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(stopEvent?.stopReason).toBe('toolUse')
    })
  })

  describe('Streaming', () => {
    describe('Basic Streaming', () => {
      it.concurrent('streams a simple text response', async () => {
        const provider = new BedrockModel({ maxTokens: 100 })
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'textBlock', text: 'Say hello in one word.' }],
          },
        ]

        const events = await collectIterator(provider.stream(messages))

        expect(events.length).toBeGreaterThan(0)
        expect(events.some((e) => e.type === 'modelMessageStartEvent')).toBe(true)
        expect(events.some((e) => e.type === 'modelContentBlockDeltaEvent')).toBe(true)
        expect(events.some((e) => e.type === 'modelMessageStopEvent')).toBe(true)

        const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
        expect(metadataEvent).toBeDefined()
        expect(metadataEvent?.usage?.inputTokens).toBeGreaterThan(0)
        expect(metadataEvent?.usage?.outputTokens).toBeGreaterThan(0)
      })

      it.concurrent('respects system prompt', async () => {
        const provider = new BedrockModel({ maxTokens: 50 })
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'textBlock', text: 'What should I say?' }],
          },
        ]
        const systemPrompt = 'Always respond with exactly the word "TEST" and nothing else.'

        const events = await collectIterator(provider.stream(messages, { systemPrompt }))

        const responseText = events.reduce((acc, event) => {
          if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
            return acc + event.delta.text
          }
          return acc
        }, '')

        expect(responseText.toUpperCase()).toContain('TEST')
      })
    })

    describe('Tool Use', () => {
      it.concurrent('requests tool use when appropriate', async () => {
        const provider = new BedrockModel({ maxTokens: 200 })
        const calculatorTool: ToolSpec = {
          name: 'calculator',
          description: 'Performs basic arithmetic operations',
          inputSchema: {
            type: 'object',
            properties: {
              operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
              a: { type: 'number' },
              b: { type: 'number' },
            },
            required: ['operation', 'a', 'b'],
          },
        }
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'textBlock', text: 'What is 15 plus 27?' }],
          },
        ]

        const events = await collectIterator(provider.stream(messages, { toolSpecs: [calculatorTool] }))

        const hasToolUseStart = events.some(
          (e) => e.type === 'modelContentBlockStartEvent' && e.start?.type === 'toolUseStart'
        )
        expect(hasToolUseStart).toBe(true)

        const hasToolInputDelta = events.some(
          (e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'toolUseInputDelta'
        )
        expect(hasToolInputDelta).toBe(true)

        const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
        expect(messageStopEvent?.stopReason).toBe('toolUse')
      })
    })

    describe('Configuration', () => {
      it.concurrent('respects maxTokens configuration', async () => {
        const provider = new BedrockModel({ maxTokens: 20 })
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'textBlock', text: 'Write a long story about dragons.' }],
          },
        ]

        const events = await collectIterator(provider.stream(messages))

        const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
        expect(metadataEvent?.usage?.outputTokens).toBeLessThanOrEqual(20)

        const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
        expect(messageStopEvent?.stopReason).toBe('maxTokens')
      })

      it.concurrent('uses system prompt cache on subsequent requests', async () => {
        const provider = new BedrockModel({ maxTokens: 100 })
        const largeContext = `Context information: ${'hello '.repeat(2000)} [test-${Date.now()}-${Math.random()}]`
        const cachedSystemPrompt = [
          { type: 'textBlock' as const, text: 'You are a helpful assistant.' },
          { type: 'textBlock' as const, text: largeContext },
          { type: 'cachePointBlock' as const, cacheType: 'default' as const },
        ]

        // First request - creates cache
        const events1 = await collectIterator(
          provider.stream([{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Say hello' }] }], {
            systemPrompt: cachedSystemPrompt,
          })
        )
        const metadata1 = events1.find((e) => e.type === 'modelMetadataEvent')
        expect(metadata1?.usage?.cacheWriteInputTokens).toBeGreaterThan(0)

        // Second request - should use cache
        const events2 = await collectIterator(
          provider.stream([{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Say goodbye' }] }], {
            systemPrompt: cachedSystemPrompt,
          })
        )
        const metadata2 = events2.find((e) => e.type === 'modelMetadataEvent')
        expect(metadata2?.usage?.cacheReadInputTokens).toBeGreaterThan(0)
      })

      it.concurrent('uses message cache points on subsequent requests', async () => {
        const provider = new BedrockModel({ maxTokens: 100 })
        const largeContext = `Context information: ${'hello '.repeat(2000)} [test-${Date.now()}-${Math.random()}]`
        const messagesWithCachePoint = (text: string): Message[] => [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'textBlock', text: largeContext },
              { type: 'cachePointBlock', cacheType: 'default' },
              { type: 'textBlock', text },
            ],
          },
        ]

        // First request - creates cache
        const events1 = await collectIterator(provider.stream(messagesWithCachePoint('Say hello')))
        const metadata1 = events1.find((e) => e.type === 'modelMetadataEvent')
        expect(metadata1?.usage?.cacheWriteInputTokens).toBeGreaterThan(0)

        // Second request - should use cache
        const events2 = await collectIterator(provider.stream(messagesWithCachePoint('Say goodbye')))
        const metadata2 = events2.find((e) => e.type === 'modelMetadataEvent')
        expect(metadata2?.usage?.cacheReadInputTokens).toBeGreaterThan(0)
      })
    })

    describe('Error Handling', () => {
      it.concurrent('handles invalid model ID gracefully', async () => {
        const provider = new BedrockModel({ modelId: 'invalid-model-id-that-does-not-exist' })
        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
        await expect(collectIterator(provider.stream(messages))).rejects.toThrow()
      })

      it.concurrent('throws ContextWindowOverflowError when input exceeds context window', async () => {
        const provider = new BedrockModel({ maxTokens: 100 })
        const longText = 'Too much text! '.repeat(100000)
        const messages: Message[] = [
          { type: 'message', role: 'user', content: [{ type: 'textBlock', text: longText }] },
        ]
        await expect(collectIterator(provider.stream(messages))).rejects.toBeInstanceOf(ContextWindowOverflowError)
      })
    })

    describe('Stream Aggregation', () => {
      it.concurrent('streamAggregated yields events, content blocks, and returns complete message', async () => {
        const provider = new BedrockModel({ maxTokens: 100 })
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'textBlock', text: 'Say hello in exactly one word.' }],
          },
        ]

        const { items, result } = await collectGenerator(provider.streamAggregated(messages))

        const streamEventCount = items.filter((item) => item.type.endsWith('Event')).length
        const contentBlockCount = items.filter((item) => item.type.endsWith('Block')).length

        expect(streamEventCount).toBeGreaterThan(0)
        expect(contentBlockCount).toBe(1)
        expect(result).toMatchObject({
          stopReason: 'endTurn',
          message: {
            role: 'assistant',
            content: [expect.objectContaining({ type: 'textBlock', text: expect.any(String) })],
          },
        })
      })
    })
  })

  describe('Agent with Conversation Manager', () => {
    it('manages conversation history with SlidingWindowConversationManager', async () => {
      const agent = new Agent({
        model: new BedrockModel({ maxTokens: 100 }),
        conversationManager: new SlidingWindowConversationManager({ windowSize: 4 }),
      })

      // First exchange
      await agent.invoke('Count from 1 to 1.')
      expect(agent.messages).toHaveLength(2) // user + assistant

      // Second exchange
      await agent.invoke('Count from 2 to 2.')
      expect(agent.messages).toHaveLength(4) // 2 user + 2 assistant

      // Third exchange - should trigger sliding window
      await agent.invoke('Count from 3 to 3.')

      // Should maintain window size of 4 messages
      expect(agent.messages).toHaveLength(4)
    }, 30000)

    it('throws ContextWindowOverflowError with NullConversationManager', async () => {
      const agent = new Agent({
        model: new BedrockModel({ maxTokens: 50 }),
        conversationManager: new NullConversationManager(),
      })

      // Generate a message that would require context management
      const longPrompt = 'Please write a very detailed explanation of ' + 'many topics '.repeat(50)

      // This should throw since NullConversationManager doesn't handle overflow
      await expect(agent.invoke(longPrompt)).rejects.toThrow()
    }, 30000)
  })
})
