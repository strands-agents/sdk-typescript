import { describe, it, expect } from 'vitest'
import type { Message } from '../../types/messages.js'
import { TestModelProvider, collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { MaxTokensError } from '../../errors.js'

describe('Model', () => {
  describe('streamAggregated', () => {
    describe('when streaming a simple text message', () => {
      it('yields original events plus aggregated content block and returns final message', async () => {
        const provider = new TestModelProvider(async function* () {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent' }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'Hello' },
          }
          yield { type: 'modelContentBlockStopEvent' }
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
          { type: 'modelContentBlockStartEvent' },
          {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'Hello' },
          },
          { type: 'modelContentBlockStopEvent' },
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

      it('throws MaxTokenError when stopReason is MaxTokenError', async () => {
        const provider = new TestModelProvider(async function* () {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent' }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'Hello' },
          }
          yield { type: 'modelContentBlockStopEvent' }
          yield { type: 'modelMessageStopEvent', stopReason: 'maxTokens' }
          yield {
            type: 'modelMetadataEvent',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          }
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        await expect(async () => await collectGenerator(provider.streamAggregated(messages))).rejects.toThrow(
          'Model reached maximum token limit. This is an unrecoverable state that requires intervention.'
        )
      })
    })

    describe('when streaming multiple text blocks', () => {
      it('yields all blocks in order', async () => {
        const provider = new TestModelProvider(async function* () {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent' }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'First' },
          }
          yield { type: 'modelContentBlockStopEvent' }
          yield { type: 'modelContentBlockStartEvent' }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'Second' },
          }
          yield { type: 'modelContentBlockStopEvent' }
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
            start: { type: 'toolUseStart', toolUseId: 'tool1', name: 'get_weather' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: '{"location"' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: ': "Paris"}' },
          }
          yield { type: 'modelContentBlockStopEvent' }
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
      it('throws MaxTokenError when stopReason is MaxTokenError and toolUse is partial', async () => {
        const provider = new TestModelProvider(async function* () {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield {
            type: 'modelContentBlockStartEvent',
            start: { type: 'toolUseStart', toolUseId: 'tool1', name: 'get_weather' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: '{"location"' },
          }
          yield { type: 'modelMessageStopEvent', stopReason: 'maxTokens' }
          yield {
            type: 'modelMetadataEvent',
            usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
          }
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        await expect(async () => await collectGenerator(provider.streamAggregated(messages))).rejects.toThrow(
          MaxTokensError
        )
      })

      it('handles empty tool input', async () => {
        const provider = new TestModelProvider(async function* () {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield {
            type: 'modelContentBlockStartEvent',
            start: { type: 'toolUseStart', toolUseId: 'tool1', name: 'no_input_tool' },
          }
          yield { type: 'modelContentBlockStopEvent' }
          yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' }
          yield {
            type: 'modelMetadataEvent',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          }
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const { items, result } = await collectGenerator(provider.streamAggregated(messages))

        expect(items).toContainEqual({
          type: 'toolUseBlock',
          toolUseId: 'tool1',
          name: 'no_input_tool',
          input: {},
        })

        expect(result).toEqual({
          message: {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'toolUseBlock',
                toolUseId: 'tool1',
                name: 'no_input_tool',
                input: {},
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
          yield { type: 'modelContentBlockStartEvent' }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'reasoningContentDelta', text: 'Thinking about', signature: 'sig1' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'reasoningContentDelta', text: ' the problem' },
          }
          yield { type: 'modelContentBlockStopEvent' }
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
          yield { type: 'modelContentBlockStartEvent' }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'reasoningContentDelta', redactedContent: new Uint8Array(0) },
          }
          yield { type: 'modelContentBlockStopEvent' }
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
          yield { type: 'modelContentBlockStartEvent' }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'reasoningContentDelta', text: 'Thinking' },
          }
          yield { type: 'modelContentBlockStopEvent' }
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
          yield { type: 'modelContentBlockStartEvent' }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'Hello' },
          }
          yield { type: 'modelContentBlockStopEvent' }
          yield {
            type: 'modelContentBlockStartEvent',
            start: { type: 'toolUseStart', toolUseId: 'tool1', name: 'get_weather' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: '{"city": "Paris"}' },
          }
          yield { type: 'modelContentBlockStopEvent' }
          yield { type: 'modelContentBlockStartEvent' }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'reasoningContentDelta', text: 'Reasoning', signature: 'sig1' },
          }
          yield { type: 'modelContentBlockStopEvent' }
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
