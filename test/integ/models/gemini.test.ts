import { describe, expect, it } from 'vitest'
import { Agent, Message, SlidingWindowConversationManager } from '@strands-agents/sdk'
import type { ModelStreamEvent } from '$/sdk/models/streaming.js'

import { collectIterator } from '$/sdk/__fixtures__/model-test-helpers.js'

import { gemini } from '../__fixtures__/model-providers.js'

describe.skipIf(gemini.skip)('GeminiModel Integration Tests', () => {
  describe('Streaming', () => {
    describe('Configuration', () => {
      it.concurrent('respects temperature configuration', async () => {
        const provider = gemini.createModel({
          modelId: 'gemini-2.0-flash',
          params: { temperature: 0, maxOutputTokens: 50 },
        })

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [{ type: 'textBlock', text: 'Say "hello world" exactly.' }],
          }),
        ]

        const events1 = await collectIterator<ModelStreamEvent>(provider.stream(messages))
        const events2 = await collectIterator<ModelStreamEvent>(provider.stream(messages))

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

        expect(text1.length).toBeGreaterThan(0)
        expect(text2.length).toBeGreaterThan(0)
        expect(text1.toLowerCase()).toContain('hello')
        expect(text2.toLowerCase()).toContain('hello')
      })
    })

    describe('Error Handling', () => {
      it.concurrent('handles invalid model ID gracefully', async () => {
        const provider = gemini.createModel({
          modelId: 'invalid-model-id-that-does-not-exist-xyz',
        })

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [{ type: 'textBlock', text: 'Hello' }],
          }),
        ]

        await expect(collectIterator(provider.stream(messages))).rejects.toThrow(/not found/i)
      })
    })

    describe('Content Block Lifecycle', () => {
      it.concurrent('emits complete content block lifecycle events', async () => {
        const provider = gemini.createModel({
          modelId: 'gemini-2.0-flash',
          params: { maxOutputTokens: 50 },
        })

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [{ type: 'textBlock', text: 'Say hello.' }],
          }),
        ]

        const events = await collectIterator<ModelStreamEvent>(provider.stream(messages))

        const startEvents = events.filter((e) => e.type === 'modelContentBlockStartEvent')
        const deltaEvents = events.filter((e) => e.type === 'modelContentBlockDeltaEvent')
        const stopEvents = events.filter((e) => e.type === 'modelContentBlockStopEvent')

        expect(startEvents.length).toBeGreaterThan(0)
        expect(deltaEvents.length).toBeGreaterThan(0)
        expect(stopEvents.length).toBeGreaterThan(0)

        const startIndex = events.findIndex((e) => e.type === 'modelContentBlockStartEvent')
        const firstDeltaIndex = events.findIndex((e) => e.type === 'modelContentBlockDeltaEvent')
        expect(startIndex).toBeLessThan(firstDeltaIndex)

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
        const provider = gemini.createModel({
          modelId: 'gemini-2.0-flash',
          params: { maxOutputTokens: 100 },
        })

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [{ type: 'textBlock', text: 'Say hi.' }],
          }),
        ]

        const events = await collectIterator<ModelStreamEvent>(provider.stream(messages))

        const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
        expect(messageStopEvent).toBeDefined()
        expect(messageStopEvent?.stopReason).toBe('endTurn')
      })
    })

    describe('System Prompt', () => {
      it.concurrent('respects system prompt instructions', async () => {
        const provider = gemini.createModel({
          modelId: 'gemini-2.0-flash',
          params: { maxOutputTokens: 100 },
        })

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [{ type: 'textBlock', text: 'What is your name?' }],
          }),
        ]

        const events = await collectIterator<ModelStreamEvent>(
          provider.stream(messages, {
            systemPrompt: 'You are a helpful assistant named Claude. Always introduce yourself by name.',
          })
        )

        let text = ''
        for (const event of events) {
          if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
            text += event.delta.text
          }
        }

        expect(text.toLowerCase()).toContain('claude')
      })
    })

    describe('Conversation', () => {
      it.concurrent('maintains conversation context', async () => {
        const provider = gemini.createModel({
          modelId: 'gemini-2.0-flash',
          params: { maxOutputTokens: 100 },
        })

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [{ type: 'textBlock', text: 'My favorite color is blue.' }],
          }),
          new Message({
            role: 'assistant',
            content: [{ type: 'textBlock', text: 'That is a nice color!' }],
          }),
          new Message({
            role: 'user',
            content: [{ type: 'textBlock', text: 'What is my favorite color?' }],
          }),
        ]

        const events = await collectIterator<ModelStreamEvent>(provider.stream(messages))

        let text = ''
        for (const event of events) {
          if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
            text += event.delta.text
          }
        }

        expect(text.toLowerCase()).toContain('blue')
      })
    })
  })

  // TODO: Add comprehensive agent tests (tools, media) once tool and media support is implemented
  describe('Agent with Conversation Manager', () => {
    it('manages conversation history with SlidingWindowConversationManager', async () => {
      const agent = new Agent({
        model: gemini.createModel({ params: { maxOutputTokens: 100 } }),
        conversationManager: new SlidingWindowConversationManager({ windowSize: 4 }),
        printer: false,
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
    })
  })

  describe('Agent Basic', () => {
    it('completes simple request without tools', async () => {
      const agent = new Agent({
        model: gemini.createModel({ params: { maxOutputTokens: 100 } }),
        printer: false,
      })

      const result = await agent.invoke('Say hello')

      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')
      expect(result.lastMessage.content.length).toBeGreaterThan(0)

      // Verify response contains greeting
      let text = ''
      for (const block of result.lastMessage.content) {
        if (block.type === 'textBlock') {
          text += block.text
        }
      }
      expect(text.toLowerCase()).toMatch(/hello|hi|hey/i)
    })
  })
})
