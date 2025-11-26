import { describe, it, expect } from 'vitest'
import { OpenAIModel } from '@strands-agents/sdk/openai'
import { Message } from '@strands-agents/sdk'
import type { ToolSpec } from '@strands-agents/sdk'

// eslint-disable-next-line no-restricted-imports
import { collectIterator } from '../src/__fixtures__/model-test-helpers.js'
import { shouldSkipOpenAITests } from './__fixtures__/test-helpers.js'

describe.skipIf(shouldSkipOpenAITests())('OpenAIModel Integration Tests', () => {
  describe('Configuration', () => {
    it.concurrent('respects maxTokens configuration', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
        maxTokens: 20, // Very small limit
      })

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [{ type: 'textBlock', text: 'Write a long story about dragons.' }],
        }),
      ]

      const events = await collectIterator(provider.stream(messages))

      // Check metadata for token usage
      const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
      expect(metadataEvent?.usage?.outputTokens).toBeLessThanOrEqual(25) // Allow small buffer

      // Check that stop reason is maxTokens
      const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(messageStopEvent?.stopReason).toBe('maxTokens')
    })

    it.concurrent('respects temperature configuration', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
        temperature: 0, // Deterministic
        maxTokens: 50,
      })

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [{ type: 'textBlock', text: 'Say "hello world" exactly.' }],
        }),
      ]

      const events1 = await collectIterator(provider.stream(messages))
      const events2 = await collectIterator(provider.stream(messages))

      // Collect text from both runs
      let text1 = ''
      let text2 = ''

      for (const event of events1) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
          text1 += event.delta.text
        }
      }

      for (const event of events2) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
          text2 += event.delta.text
        }
      }

      // With temperature=0, responses should be very similar or identical
      expect(text1.length).toBeGreaterThan(0)
      expect(text2.length).toBeGreaterThan(0)
      // Both should contain "hello" in some form
      expect(text1.toLowerCase()).toContain('hello')
      expect(text2.toLowerCase()).toContain('hello')
    })
  })

  describe('Error Handling', () => {
    it.concurrent('handles invalid model ID gracefully', async () => {
      const provider = new OpenAIModel({
        modelId: 'invalid-model-id-that-does-not-exist-xyz',
      })

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [{ type: 'textBlock', text: 'Hello' }],
        }),
      ]

      // Should throw an error (OpenAI will reject the invalid model)
      await expect(async () => {
        for await (const _event of provider.stream(messages)) {
          throw Error('Should not get here')
        }
      }).rejects.toThrow()
    })
  })

  describe('Content Block Lifecycle', () => {
    it.concurrent('emits complete content block lifecycle events', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
        maxTokens: 50,
      })

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [{ type: 'textBlock', text: 'Say hello.' }],
        }),
      ]

      const events = await collectIterator(provider.stream(messages))

      // Verify complete lifecycle: start -> delta(s) -> stop
      const startEvents = events.filter((e) => e.type === 'modelContentBlockStartEvent')
      const deltaEvents = events.filter((e) => e.type === 'modelContentBlockDeltaEvent')
      const stopEvents = events.filter((e) => e.type === 'modelContentBlockStopEvent')

      expect(startEvents.length).toBeGreaterThan(0)
      expect(deltaEvents.length).toBeGreaterThan(0)
      expect(stopEvents.length).toBeGreaterThan(0)

      // Start should come before delta
      const startIndex = events.findIndex((e) => e.type === 'modelContentBlockStartEvent')
      const firstDeltaIndex = events.findIndex((e) => e.type === 'modelContentBlockDeltaEvent')
      expect(startIndex).toBeLessThan(firstDeltaIndex)

      // Stop should come after all deltas
      const stopIndex = events.findIndex((e) => e.type === 'modelContentBlockStopEvent')
      const lastDeltaIndex = events
        .map((e, i) => (e.type === 'modelContentBlockDeltaEvent' ? i : -1))
        .filter((i) => i !== -1)
        .pop()!
      expect(stopIndex).toBeGreaterThan(lastDeltaIndex)
    })
  })

  describe('Stop Reasons', () => {
    it.concurrent('returns endTurn stop reason for natural completion', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
        maxTokens: 100,
      })

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [{ type: 'textBlock', text: 'Say hi.' }],
        }),
      ]

      const events = await collectIterator(provider.stream(messages))

      const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(messageStopEvent).toBeDefined()
      expect(messageStopEvent?.stopReason).toBe('endTurn')
    })

    it.concurrent('returns maxTokens stop reason when token limit reached', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
        maxTokens: 10, // Very small limit to force cutoff
      })

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [{ type: 'textBlock', text: 'Write a very long story about dragons.' }],
        }),
      ]

      const events = await collectIterator(provider.stream(messages))

      const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(messageStopEvent).toBeDefined()
      expect(messageStopEvent?.stopReason).toBe('maxTokens')
    })

    it.concurrent('returns toolUse stop reason when requesting tool use', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
        maxTokens: 200,
      })

      const calculatorTool: ToolSpec = {
        name: 'calculator',
        description: 'Performs basic arithmetic operations. Use this to calculate math expressions.',
        inputSchema: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'The math expression to calculate' },
          },
          required: ['expression'],
        },
      }

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [{ type: 'textBlock', text: 'Calculate 42 times 7 please.' }],
        }),
      ]

      const events = await collectIterator(provider.stream(messages, { toolSpecs: [calculatorTool] }))

      const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(messageStopEvent).toBeDefined()
      expect(messageStopEvent?.stopReason).toBe('toolUse')
    })
  })
})
