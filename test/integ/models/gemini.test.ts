import { describe, expect, it } from 'vitest'
import {
  Agent,
  DocumentBlock,
  ImageBlock,
  Message,
  SlidingWindowConversationManager,
  TextBlock,
} from '@strands-agents/sdk'
import type { ModelStreamEvent } from '$/sdk/models/streaming.js'

import { collectIterator } from '$/sdk/__fixtures__/model-test-helpers.js'
import { loadFixture } from '../__fixtures__/test-helpers.js'

import { gemini } from '../__fixtures__/model-providers.js'

// Import fixtures using Vite's ?url suffix
import yellowPngUrl from '../__resources__/yellow.png?url'

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

  describe('Media Content Types', () => {
    describe('Image Content', () => {
      it.concurrent('processes image content and describes it', async () => {
        const provider = gemini.createModel({
          modelId: 'gemini-2.0-flash',
          params: { maxOutputTokens: 100 },
        })

        const imageBytes = await loadFixture(yellowPngUrl)
        const imageBlock = new ImageBlock({
          format: 'png',
          source: { bytes: imageBytes },
        })

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('What color is this image? Answer in one word.'), imageBlock],
          }),
        ]

        const events = await collectIterator<ModelStreamEvent>(provider.stream(messages))

        let text = ''
        for (const event of events) {
          if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
            text += event.delta.text
          }
        }

        expect(text.toLowerCase()).toContain('yellow')
      })

      // Note: Gemini only supports Google Cloud Storage URIs for fileData, not arbitrary URLs
      // Image URL test skipped - use bytes source instead
    })

    describe('Document Content', () => {
      it.concurrent('processes document with text source', async () => {
        const provider = gemini.createModel({
          modelId: 'gemini-2.0-flash',
          params: { maxOutputTokens: 100 },
        })

        const docBlock = new DocumentBlock({
          name: 'secret.txt',
          format: 'txt',
          source: { text: 'The secret code word is GIRAFFE.' },
        })

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('What is the secret code word in the document?'), docBlock],
          }),
        ]

        const events = await collectIterator<ModelStreamEvent>(provider.stream(messages))

        let text = ''
        for (const event of events) {
          if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
            text += event.delta.text
          }
        }

        expect(text.toUpperCase()).toContain('GIRAFFE')
      })
    })

    describe('Agent with Image Input', () => {
      it('processes image in agent conversation', async () => {
        const agent = new Agent({
          model: gemini.createModel({ params: { maxOutputTokens: 100 } }),
          printer: false,
        })

        const imageBytes = await loadFixture(yellowPngUrl)
        const imageBlock = new ImageBlock({
          format: 'png',
          source: { bytes: imageBytes },
        })

        const result = await agent.invoke([new TextBlock('What color is this image? Answer in one word.'), imageBlock])

        expect(result.stopReason).toBe('endTurn')
        expect(result.lastMessage.role).toBe('assistant')

        let text = ''
        for (const block of result.lastMessage.content) {
          if (block.type === 'textBlock') {
            text += block.text
          }
        }
        expect(text.toLowerCase()).toContain('yellow')
      })
    })
  })

  describe.skipIf(!gemini.supports.reasoning)('Reasoning Content', () => {
    it('emits reasoning content delta events with thinking model', async () => {
      const provider = gemini.createReasoningModel({
        params: { maxOutputTokens: 2048 },
      })

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('What is 15 * 23? Think through this step by step.')],
        }),
      ]

      const events = await collectIterator<ModelStreamEvent>(provider.stream(messages))

      // Check for reasoning content delta events
      const reasoningDeltas = events.filter(
        (e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'reasoningContentDelta'
      )

      // Thinking model should emit reasoning content
      expect(reasoningDeltas.length).toBeGreaterThan(0)

      // Collect reasoning text
      let reasoningText = ''
      for (const event of reasoningDeltas) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'reasoningContentDelta') {
          reasoningText += event.delta.text
        }
      }

      // Reasoning should contain some thought process
      expect(reasoningText.length).toBeGreaterThan(0)

      // Should also have text content with the answer
      const textDeltas = events.filter((e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'textDelta')
      expect(textDeltas.length).toBeGreaterThan(0)

      let answerText = ''
      for (const event of textDeltas) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
          answerText += event.delta.text
        }
      }

      // Answer should contain 345 (15 * 23 = 345)
      expect(answerText).toContain('345')
    })
  })

  // TODO: Add comprehensive agent tests with tools once tool support is implemented
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
