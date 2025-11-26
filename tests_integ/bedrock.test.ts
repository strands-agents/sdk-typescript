import { describe, it, expect } from 'vitest'
import {
  BedrockModel,
  Message,
  Agent,
  NullConversationManager,
  SlidingWindowConversationManager,
} from '@strands-agents/sdk'

// eslint-disable-next-line no-restricted-imports
import { collectIterator } from '../src/__fixtures__/model-test-helpers.js'
import { shouldRunTests } from './__fixtures__/model-test-helpers.js'

describe.skipIf(!(await shouldRunTests()))('BedrockModel Integration Tests', () => {
  describe('Streaming', () => {
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
