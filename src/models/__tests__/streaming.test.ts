import { describe, it, expect } from 'vitest'
import type { StopReason } from '@/types/messages'
import type {
  Usage,
  Metrics,
  MessageStartEvent,
  ContentBlockStart,
  ContentBlockStartEvent,
  ContentBlockDelta,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  MessageStopEvent,
  MetadataEvent,
  ModelProviderStreamEvent,
} from '@/models/streaming'

describe('streaming event types', () => {
  describe('StopReason type', () => {
    it('accepts "content_filtered"', () => {
      const reason: StopReason = 'content_filtered'
      expect(reason).toBe('content_filtered')
    })

    it('accepts "end_turn"', () => {
      const reason: StopReason = 'end_turn'
      expect(reason).toBe('end_turn')
    })

    it('accepts "guardrail_intervened"', () => {
      const reason: StopReason = 'guardrail_intervened'
      expect(reason).toBe('guardrail_intervened')
    })

    it('accepts "max_tokens"', () => {
      const reason: StopReason = 'max_tokens'
      expect(reason).toBe('max_tokens')
    })

    it('accepts "stop_sequence"', () => {
      const reason: StopReason = 'stop_sequence'
      expect(reason).toBe('stop_sequence')
    })

    it('accepts "tool_use"', () => {
      const reason: StopReason = 'tool_use'
      expect(reason).toBe('tool_use')
    })
  })

  describe('Usage interface', () => {
    it('accepts valid usage with required fields', () => {
      const usage: Usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      }
      expect(usage.totalTokens).toBe(150)
    })

    it('accepts usage with cache read tokens', () => {
      const usage: Usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadInputTokens: 30,
      }
      expect(usage.cacheReadInputTokens).toBe(30)
    })

    it('accepts usage with cache write tokens', () => {
      const usage: Usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheWriteInputTokens: 20,
      }
      expect(usage.cacheWriteInputTokens).toBe(20)
    })

    it('accepts usage with all fields', () => {
      const usage: Usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadInputTokens: 30,
        cacheWriteInputTokens: 20,
      }
      expect(usage.cacheReadInputTokens).toBe(30)
      expect(usage.cacheWriteInputTokens).toBe(20)
    })
  })

  describe('Metrics interface', () => {
    it('accepts valid metrics', () => {
      const metrics: Metrics = {
        latencyMs: 250,
      }
      expect(metrics.latencyMs).toBe(250)
    })
  })

  describe('MessageStartEvent interface', () => {
    it('accepts message start with user role', () => {
      const event: MessageStartEvent = {
        type: 'messageStart',
        role: 'user',
      }
      expect(event.role).toBe('user')
    })

    it('accepts message start with assistant role', () => {
      const event: MessageStartEvent = {
        type: 'messageStart',
        role: 'assistant',
      }
      expect(event.role).toBe('assistant')
    })
  })

  describe('ContentBlockStart type', () => {
    it('accepts content block start with toolUse', () => {
      const start: ContentBlockStart = {
        type: 'tool_use',
        name: 'calculator',
        toolUseId: 'calc-123',
      }
      if (start.type === 'tool_use') {
        expect(start.name).toBe('calculator')
      }
    })

    it('accepts content block start with text type', () => {
      const start: ContentBlockStart = {
        type: 'text',
      }
      expect(start.type).toBe('text')
    })

    it('accepts content block start with reasoning type', () => {
      const start: ContentBlockStart = {
        type: 'reasoning',
      }
      expect(start.type).toBe('reasoning')
    })
  })

  describe('ContentBlockStartEvent interface', () => {
    it('accepts event with content block index and start', () => {
      const event: ContentBlockStartEvent = {
        type: 'contentBlockStart',
        contentBlockIndex: 0,
        start: {
          type: 'tool_use',
          name: 'search',
          toolUseId: 'search-456',
        },
      }
      expect(event.contentBlockIndex).toBe(0)
      if (event.start && event.start.type === 'tool_use') {
        expect(event.start.name).toBe('search')
      }
    })

    it('accepts event with only contentBlockIndex', () => {
      const event: ContentBlockStartEvent = {
        type: 'contentBlockStart',
        contentBlockIndex: 1,
      }
      expect(event.contentBlockIndex).toBe(1)
    })

    it('accepts event with only start', () => {
      const event: ContentBlockStartEvent = {
        type: 'contentBlockStart',
        start: { type: 'tool_use', name: 'tool', toolUseId: 'id' },
      }
      expect(event.start).toBeDefined()
    })

    it('accepts empty event', () => {
      const event: ContentBlockStartEvent = {
        type: 'contentBlockStart',
      }
      expect(event).toBeDefined()
    })
  })

  describe('ContentBlockDelta type', () => {
    it('accepts delta with text', () => {
      const delta: ContentBlockDelta = {
        type: 'text',
        text: 'Hello',
      }
      if (delta.type === 'text') {
        expect(delta.text).toBe('Hello')
      }
    })

    it('accepts delta with toolUse input', () => {
      const delta: ContentBlockDelta = {
        type: 'tool_use',
        input: '{"query": "test"}',
      }
      if (delta.type === 'tool_use') {
        expect(delta.input).toBe('{"query": "test"}')
      }
    })

    it('accepts delta with reasoning content text', () => {
      const delta: ContentBlockDelta = {
        type: 'reasoning',
        text: 'Thinking...',
      }
      if (delta.type === 'reasoning') {
        expect(delta.text).toBe('Thinking...')
      }
    })

    it('accepts delta with reasoning content signature', () => {
      const delta: ContentBlockDelta = {
        type: 'reasoning',
        signature: 'sig-789',
      }
      if (delta.type === 'reasoning') {
        expect(delta.signature).toBe('sig-789')
      }
    })

    it('accepts delta with reasoning content both fields', () => {
      const delta: ContentBlockDelta = {
        type: 'reasoning',
        text: 'Reasoning',
        signature: 'sig-123',
      }
      if (delta.type === 'reasoning') {
        expect(delta.text).toBe('Reasoning')
        expect(delta.signature).toBe('sig-123')
      }
    })
  })

  describe('ContentBlockDeltaEvent interface', () => {
    it('accepts event with contentBlockIndex and delta', () => {
      const event: ContentBlockDeltaEvent = {
        type: 'contentBlockDelta',
        contentBlockIndex: 0,
        delta: {
          type: 'text',
          text: 'streaming text',
        },
      }
      expect(event.contentBlockIndex).toBe(0)
      if (event.delta.type === 'text') {
        expect(event.delta.text).toBe('streaming text')
      }
    })

    it('accepts event with only delta', () => {
      const event: ContentBlockDeltaEvent = {
        type: 'contentBlockDelta',
        delta: { type: 'text', text: 'more text' },
      }
      if (event.delta.type === 'text') {
        expect(event.delta.text).toBe('more text')
      }
    })
  })

  describe('ContentBlockStopEvent interface', () => {
    it('accepts event with contentBlockIndex', () => {
      const event: ContentBlockStopEvent = {
        type: 'contentBlockStop',
        contentBlockIndex: 2,
      }
      expect(event.contentBlockIndex).toBe(2)
    })

    it('accepts empty event', () => {
      const event: ContentBlockStopEvent = {
        type: 'contentBlockStop',
      }
      expect(event).toBeDefined()
    })
  })

  describe('MessageStopEvent interface', () => {
    it('accepts event with stopReason', () => {
      const event: MessageStopEvent = {
        type: 'messageStop',
        stopReason: 'end_turn',
      }
      expect(event.stopReason).toBe('end_turn')
    })

    it('accepts event with additionalModelResponseFields', () => {
      const event: MessageStopEvent = {
        type: 'messageStop',
        additionalModelResponseFields: { customField: 'value' },
      }
      expect(event.additionalModelResponseFields).toBeDefined()
    })

    it('accepts event with all fields', () => {
      const event: MessageStopEvent = {
        type: 'messageStop',
        stopReason: 'tool_use',
        additionalModelResponseFields: { trace: 'xyz' },
      }
      expect(event.stopReason).toBe('tool_use')
      expect(event.additionalModelResponseFields).toBeDefined()
    })

    it('accepts empty event', () => {
      const event: MessageStopEvent = {
        type: 'messageStop',
      }
      expect(event).toBeDefined()
    })
  })

  describe('MetadataEvent interface', () => {
    it('accepts event with usage', () => {
      const event: MetadataEvent = {
        type: 'metadata',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
      }
      expect(event.usage?.totalTokens).toBe(30)
    })

    it('accepts event with metrics', () => {
      const event: MetadataEvent = {
        type: 'metadata',
        metrics: {
          latencyMs: 150,
        },
      }
      expect(event.metrics?.latencyMs).toBe(150)
    })

    it('accepts event with trace', () => {
      const event: MetadataEvent = {
        type: 'metadata',
        trace: { traceId: 'trace-123' },
      }
      expect(event.trace).toBeDefined()
    })

    it('accepts event with all fields', () => {
      const event: MetadataEvent = {
        type: 'metadata',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
        metrics: {
          latencyMs: 200,
        },
        trace: { traceId: 'abc' },
      }
      expect(event.usage).toBeDefined()
      expect(event.metrics).toBeDefined()
      expect(event.trace).toBeDefined()
    })

    it('accepts empty event', () => {
      const event: MetadataEvent = {
        type: 'metadata',
      }
      expect(event).toBeDefined()
    })
  })

  describe('ModelProviderStreamEvent union type', () => {
    it('accepts messageStart event', () => {
      const event: ModelProviderStreamEvent = {
        type: 'messageStart',
        role: 'assistant',
      }
      expect(event.type).toBe('messageStart')
      if (event.type === 'messageStart') {
        expect(event.role).toBe('assistant')
      }
    })

    it('accepts contentBlockStart event', () => {
      const event: ModelProviderStreamEvent = {
        type: 'contentBlockStart',
        contentBlockIndex: 0,
        start: { type: 'tool_use', name: 'tool', toolUseId: 'id' },
      }
      expect(event.type).toBe('contentBlockStart')
    })

    it('accepts contentBlockDelta event', () => {
      const event: ModelProviderStreamEvent = {
        type: 'contentBlockDelta',
        contentBlockIndex: 0,
        delta: { type: 'text', text: 'chunk' },
      }
      expect(event.type).toBe('contentBlockDelta')
    })

    it('accepts contentBlockStop event', () => {
      const event: ModelProviderStreamEvent = {
        type: 'contentBlockStop',
        contentBlockIndex: 0,
      }
      expect(event.type).toBe('contentBlockStop')
    })

    it('accepts messageStop event', () => {
      const event: ModelProviderStreamEvent = {
        type: 'messageStop',
        stopReason: 'end_turn',
      }
      expect(event.type).toBe('messageStop')
      if (event.type === 'messageStop') {
        expect(event.stopReason).toBe('end_turn')
      }
    })

    it('accepts metadata event', () => {
      const event: ModelProviderStreamEvent = {
        type: 'metadata',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      }
      expect(event.type).toBe('metadata')
      if (event.type === 'metadata') {
        expect(event.usage?.totalTokens).toBe(30)
      }
    })
  })
})
