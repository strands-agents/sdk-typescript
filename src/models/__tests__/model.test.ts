import { describe, it, expect } from 'vitest'
import type { Message } from '../../types/messages'
import { TestModelProvider, collectGenerator } from '../../__fixtures__/model-test-helpers'
import {
  ModelMessageStartEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStopEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
  TextDelta,
  ToolUseInputDelta,
  ToolUseStart,
  ReasoningContentDelta,
} from '../streaming'

describe('Model', () => {
  describe('streamAggregated', () => {
    describe('when streaming a simple text message', () => {
      it('yields original events plus aggregated content block and returns final message', async () => {
        const provider = new TestModelProvider(async function* () {
          yield new ModelMessageStartEvent({ role: 'assistant' })
          yield new ModelContentBlockStartEvent({ contentBlockIndex: 0 })
          yield new ModelContentBlockDeltaEvent({
            delta: new TextDelta({ text: 'Hello' }),
            contentBlockIndex: 0,
          })
          yield new ModelContentBlockStopEvent({ contentBlockIndex: 0 })
          yield new ModelMessageStopEvent({ stopReason: 'endTurn' })
          yield new ModelMetadataEvent({
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          })
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

        // Verify the returned message
        expect(result).toEqual({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'textBlock', text: 'Hello' }],
        })
      })
    })

    describe('when streaming multiple text blocks', () => {
      it('yields all blocks in order', async () => {
        const provider = new TestModelProvider(async function* () {
          yield new ModelMessageStartEvent({ role: 'assistant' })
          yield new ModelContentBlockStartEvent({ contentBlockIndex: 0 })
          yield new ModelContentBlockDeltaEvent({
            delta: new TextDelta({ text: 'First' }),
            contentBlockIndex: 0,
          })
          yield new ModelContentBlockStopEvent({ contentBlockIndex: 0 })
          yield new ModelContentBlockStartEvent({ contentBlockIndex: 1 })
          yield new ModelContentBlockDeltaEvent({
            delta: new TextDelta({ text: 'Second' }),
            contentBlockIndex: 1,
          })
          yield new ModelContentBlockStopEvent({ contentBlockIndex: 1 })
          yield new ModelMessageStopEvent({ stopReason: 'endTurn' })
          yield new ModelMetadataEvent({
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          })
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const { items, result } = await collectGenerator(provider.streamAggregated(messages))

        expect(items).toContainEqual({ type: 'textBlock', text: 'First' })
        expect(items).toContainEqual({ type: 'textBlock', text: 'Second' })

        expect(result).toEqual({
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'textBlock', text: 'First' },
            { type: 'textBlock', text: 'Second' },
          ],
        })
      })
    })

    describe('when streaming tool use', () => {
      it('yields complete tool use block', async () => {
        const provider = new TestModelProvider(async function* () {
          yield new ModelMessageStartEvent({ role: 'assistant' })
          yield new ModelContentBlockStartEvent({
            contentBlockIndex: 0,
            start: new ToolUseStart({ toolUseId: 'tool1', name: 'get_weather' }),
          })
          yield new ModelContentBlockDeltaEvent({
            delta: new ToolUseInputDelta({ input: '{"location"' }),
            contentBlockIndex: 0,
          })
          yield new ModelContentBlockDeltaEvent({
            delta: new ToolUseInputDelta({ input: ': "Paris"}' }),
            contentBlockIndex: 0,
          })
          yield new ModelContentBlockStopEvent({ contentBlockIndex: 0 })
          yield new ModelMessageStopEvent({ stopReason: 'toolUse' })
          yield new ModelMetadataEvent({
            usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
          })
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
        })
      })
    })

    describe('when streaming reasoning content', () => {
      it('yields complete reasoning block', async () => {
        const provider = new TestModelProvider(async function* () {
          yield new ModelMessageStartEvent({ role: 'assistant' })
          yield new ModelContentBlockStartEvent({ contentBlockIndex: 0 })
          yield new ModelContentBlockDeltaEvent({
            delta: new ReasoningContentDelta({ text: 'Thinking about', signature: 'sig1' }),
            contentBlockIndex: 0,
          })
          yield new ModelContentBlockDeltaEvent({
            delta: new ReasoningContentDelta({ text: ' the problem' }),
            contentBlockIndex: 0,
          })
          yield new ModelContentBlockStopEvent({ contentBlockIndex: 0 })
          yield new ModelMessageStopEvent({ stopReason: 'endTurn' })
          yield new ModelMetadataEvent({
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          })
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const { items, result } = await collectGenerator(provider.streamAggregated(messages))

        expect(items).toContainEqual({
          type: 'reasoningBlock',
          text: 'Thinking about the problem',
          signature: 'sig1',
        })

        expect(result).toEqual({
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'reasoningBlock',
              text: 'Thinking about the problem',
              signature: 'sig1',
            },
          ],
        })
      })

      it('yields redacted content reasoning block', async () => {
        const provider = new TestModelProvider(async function* () {
          yield new ModelMessageStartEvent({ role: 'assistant' })
          yield new ModelContentBlockStartEvent({ contentBlockIndex: 0 })
          yield new ModelContentBlockDeltaEvent({
            delta: new ReasoningContentDelta({ redactedContent: new Uint8Array(0) }),
            contentBlockIndex: 0,
          })
          yield new ModelContentBlockStopEvent({ contentBlockIndex: 0 })
          yield new ModelMessageStopEvent({ stopReason: 'endTurn' })
          yield new ModelMetadataEvent({
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          })
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const { items, result } = await collectGenerator(provider.streamAggregated(messages))

        expect(items).toContainEqual({
          type: 'reasoningBlock',
          redactedContent: new Uint8Array(0),
        })

        expect(result).toEqual({
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'reasoningBlock',
              redactedContent: new Uint8Array(0),
            },
          ],
        })
      })

      it('omits signature if not present', async () => {
        const provider = new TestModelProvider(async function* () {
          yield new ModelMessageStartEvent({ role: 'assistant' })
          yield new ModelContentBlockStartEvent({ contentBlockIndex: 0 })
          yield new ModelContentBlockDeltaEvent({
            delta: new ReasoningContentDelta({ text: 'Thinking' }),
            contentBlockIndex: 0,
          })
          yield new ModelContentBlockStopEvent({ contentBlockIndex: 0 })
          yield new ModelMessageStopEvent({ stopReason: 'endTurn' })
          yield new ModelMetadataEvent({
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          })
        })

        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const { items, result } = await collectGenerator(provider.streamAggregated(messages))

        expect(items).toContainEqual({
          type: 'reasoningBlock',
          text: 'Thinking',
        })

        expect(result).toEqual({
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'reasoningBlock',
              text: 'Thinking',
            },
          ],
        })
      })
    })

    describe('when streaming mixed content blocks', () => {
      it('yields all blocks in correct order', async () => {
        const provider = new TestModelProvider(async function* () {
          yield new ModelMessageStartEvent({ role: 'assistant' })
          yield new ModelContentBlockStartEvent({ contentBlockIndex: 0 })
          yield new ModelContentBlockDeltaEvent({
            delta: new TextDelta({ text: 'Hello' }),
            contentBlockIndex: 0,
          })
          yield new ModelContentBlockStopEvent({ contentBlockIndex: 0 })
          yield new ModelContentBlockStartEvent({
            contentBlockIndex: 1,
            start: new ToolUseStart({ toolUseId: 'tool1', name: 'get_weather' }),
          })
          yield new ModelContentBlockDeltaEvent({
            delta: new ToolUseInputDelta({ input: '{"city": "Paris"}' }),
            contentBlockIndex: 1,
          })
          yield new ModelContentBlockStopEvent({ contentBlockIndex: 1 })
          yield new ModelContentBlockStartEvent({ contentBlockIndex: 2 })
          yield new ModelContentBlockDeltaEvent({
            delta: new ReasoningContentDelta({ text: 'Reasoning', signature: 'sig1' }),
            contentBlockIndex: 2,
          })
          yield new ModelContentBlockStopEvent({ contentBlockIndex: 2 })
          yield new ModelMessageStopEvent({ stopReason: 'endTurn' })
          yield new ModelMetadataEvent({
            usage: { inputTokens: 10, outputTokens: 15, totalTokens: 25 },
          })
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
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'textBlock', text: 'Hello' },
            { type: 'toolUseBlock', toolUseId: 'tool1', name: 'get_weather', input: { city: 'Paris' } },
            { type: 'reasoningBlock', text: 'Reasoning', signature: 'sig1' },
          ],
        })
      })
    })
  })
})
