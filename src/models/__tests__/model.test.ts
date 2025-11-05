import { describe, it, expect } from 'vitest'
import type { Message } from '../../types/messages.js'
import { TestModelProvider, collectGenerator } from '../../__fixtures__/model-test-helpers.js'

describe('Model', () => {
  describe('streamAggregated', () => {
    describe('when streaming a simple text message', () => {
      it('yields original events plus aggregated content block and returns final message', async () => {
        const provider = new TestModelProvider(async function* () {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent', contentBlockIndex: 0 }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'Hello' },
            contentBlockIndex: 0,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 }
          yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
          yield {
            type: 'modelMetadataEvent',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          }
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const { items, result } = await collectGenerator(provider.streamAggregated(messages))

        // Verify all yielded items (events + aggregated content block)
        expect(items).toEqual([
          { type: 'modelMessageStartEvent', role: 'assistant' },
          { type: 'modelContentBlockStartEvent', contentBlockIndex: 0 },
          {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'Hello' },
            contentBlockIndex: 0,
          },
          { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 },
          { type: 'textBlock', text: 'Hello' },
          { type: 'modelMessageStopEvent', stopReason: 'endTurn' },
        ])

        // Verify the returned result
        expect(result).toEqual({
          message: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'textBlock', text: 'Hello' }],
          },
          stopReason: 'endTurn',
        })
      })
    })

    describe('when streaming multiple text blocks', () => {
      it('yields all blocks in order', async () => {
        const provider = new TestModelProvider(async function* () {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent', contentBlockIndex: 0 }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'First' },
            contentBlockIndex: 0,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 }
          yield { type: 'modelContentBlockStartEvent', contentBlockIndex: 1 }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'Second' },
            contentBlockIndex: 1,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 1 }
          yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
          yield {
            type: 'modelMetadataEvent',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          }
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const { items, result } = await collectGenerator(provider.streamAggregated(messages))

        expect(items).toContainEqual({ type: 'textBlock', text: 'First' })
        expect(items).toContainEqual({ type: 'textBlock', text: 'Second' })

        expect(result).toEqual({
          message: {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'textBlock', text: 'First' },
              { type: 'textBlock', text: 'Second' },
            ],
          },
          stopReason: 'endTurn',
        })
      })
    })

    describe('when streaming tool use', () => {
      it('yields complete tool use block', async () => {
        const provider = new TestModelProvider(async function* () {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield {
            type: 'modelContentBlockStartEvent',
            contentBlockIndex: 0,
            start: { type: 'toolUseStart', toolUseId: 'tool1', name: 'get_weather' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: '{"location"' },
            contentBlockIndex: 0,
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: ': "Paris"}' },
            contentBlockIndex: 0,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 }
          yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' }
          yield {
            type: 'modelMetadataEvent',
            usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
          }
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const { items, result } = await collectGenerator(provider.streamAggregated(messages))

        expect(items).toContainEqual({
          type: 'toolUseBlock',
          toolUseId: 'tool1',
          name: 'get_weather',
          input: { location: 'Paris' },
        })

        expect(result).toEqual({
          message: {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'toolUseBlock',
                toolUseId: 'tool1',
                name: 'get_weather',
                input: { location: 'Paris' },
              },
            ],
          },
          stopReason: 'toolUse',
        })
      })
    })

    describe('when streaming reasoning content', () => {
      it('yields complete reasoning block', async () => {
        const provider = new TestModelProvider(async function* () {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent', contentBlockIndex: 0 }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'reasoningContentDelta', text: 'Thinking about', signature: 'sig1' },
            contentBlockIndex: 0,
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'reasoningContentDelta', text: ' the problem' },
            contentBlockIndex: 0,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 }
          yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
          yield {
            type: 'modelMetadataEvent',
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          }
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const { items, result } = await collectGenerator(provider.streamAggregated(messages))

        expect(items).toContainEqual({
          type: 'reasoningBlock',
          text: 'Thinking about the problem',
          signature: 'sig1',
        })

        expect(result).toEqual({
          message: {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'reasoningBlock',
                text: 'Thinking about the problem',
                signature: 'sig1',
              },
            ],
          },
          stopReason: 'endTurn',
        })
      })

      it('yields redacted content reasoning block', async () => {
        const provider = new TestModelProvider(async function* () {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent', contentBlockIndex: 0 }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'reasoningContentDelta', redactedContent: new Uint8Array(0) },
            contentBlockIndex: 0,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 }
          yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
          yield {
            type: 'modelMetadataEvent',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          }
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const { items, result } = await collectGenerator(provider.streamAggregated(messages))

        expect(items).toContainEqual({
          type: 'reasoningBlock',
          redactedContent: new Uint8Array(0),
        })

        expect(result).toEqual({
          message: {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'reasoningBlock',
                redactedContent: new Uint8Array(0),
              },
            ],
          },
          stopReason: 'endTurn',
        })
      })

      it('omits signature if not present', async () => {
        const provider = new TestModelProvider(async function* () {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent', contentBlockIndex: 0 }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'reasoningContentDelta', text: 'Thinking' },
            contentBlockIndex: 0,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 }
          yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
          yield {
            type: 'modelMetadataEvent',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          }
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const { items, result } = await collectGenerator(provider.streamAggregated(messages))

        expect(items).toContainEqual({
          type: 'reasoningBlock',
          text: 'Thinking',
        })

        expect(result).toEqual({
          message: {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'reasoningBlock',
                text: 'Thinking',
              },
            ],
          },
          stopReason: 'endTurn',
        })
      })
    })

    describe('when streaming mixed content blocks', () => {
      it('yields all blocks in correct order', async () => {
        const provider = new TestModelProvider(async function* () {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent', contentBlockIndex: 0 }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'Hello' },
            contentBlockIndex: 0,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 }
          yield {
            type: 'modelContentBlockStartEvent',
            contentBlockIndex: 1,
            start: { type: 'toolUseStart', toolUseId: 'tool1', name: 'get_weather' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: '{"city": "Paris"}' },
            contentBlockIndex: 1,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 1 }
          yield { type: 'modelContentBlockStartEvent', contentBlockIndex: 2 }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'reasoningContentDelta', text: 'Reasoning', signature: 'sig1' },
            contentBlockIndex: 2,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 2 }
          yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
          yield {
            type: 'modelMetadataEvent',
            usage: { inputTokens: 10, outputTokens: 15, totalTokens: 25 },
          }
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const { items, result } = await collectGenerator(provider.streamAggregated(messages))

        expect(items).toContainEqual({ type: 'textBlock', text: 'Hello' })
        expect(items).toContainEqual({
          type: 'toolUseBlock',
          toolUseId: 'tool1',
          name: 'get_weather',
          input: { city: 'Paris' },
        })
        expect(items).toContainEqual({ type: 'reasoningBlock', text: 'Reasoning', signature: 'sig1' })

        expect(result).toEqual({
          message: {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'textBlock', text: 'Hello' },
              { type: 'toolUseBlock', toolUseId: 'tool1', name: 'get_weather', input: { city: 'Paris' } },
              { type: 'reasoningBlock', text: 'Reasoning', signature: 'sig1' },
            ],
          },
          stopReason: 'endTurn',
        })
      })
    })
  })
})
