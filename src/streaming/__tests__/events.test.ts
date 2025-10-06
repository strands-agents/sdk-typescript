import { describe, it, expect } from 'vitest'
import type {
  StopReason,
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
  StreamEvent,
} from '@/streaming/events'

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
        role: 'user',
      }
      expect(event.role).toBe('user')
    })

    it('accepts message start with assistant role', () => {
      const event: MessageStartEvent = {
        role: 'assistant',
      }
      expect(event.role).toBe('assistant')
    })
  })

  describe('ContentBlockStart interface', () => {
    it('accepts content block start with toolUse', () => {
      const start: ContentBlockStart = {
        toolUse: {
          name: 'calculator',
          toolUseId: 'calc-123',
        },
      }
      expect(start.toolUse?.name).toBe('calculator')
    })

    it('accepts empty content block start', () => {
      const start: ContentBlockStart = {}
      expect(start).toBeDefined()
    })
  })

  describe('ContentBlockStartEvent interface', () => {
    it('accepts event with content block index and start', () => {
      const event: ContentBlockStartEvent = {
        contentBlockIndex: 0,
        start: {
          toolUse: {
            name: 'search',
            toolUseId: 'search-456',
          },
        },
      }
      expect(event.contentBlockIndex).toBe(0)
      expect(event.start?.toolUse?.name).toBe('search')
    })

    it('accepts event with only contentBlockIndex', () => {
      const event: ContentBlockStartEvent = {
        contentBlockIndex: 1,
      }
      expect(event.contentBlockIndex).toBe(1)
    })

    it('accepts event with only start', () => {
      const event: ContentBlockStartEvent = {
        start: { toolUse: { name: 'tool', toolUseId: 'id' } },
      }
      expect(event.start).toBeDefined()
    })

    it('accepts empty event', () => {
      const event: ContentBlockStartEvent = {}
      expect(event).toBeDefined()
    })
  })

  describe('ContentBlockDelta interface', () => {
    it('accepts delta with text', () => {
      const delta: ContentBlockDelta = {
        text: 'Hello',
      }
      expect(delta.text).toBe('Hello')
    })

    it('accepts delta with toolUse input', () => {
      const delta: ContentBlockDelta = {
        toolUse: {
          input: '{"query": "test"}',
        },
      }
      expect(delta.toolUse?.input).toBe('{"query": "test"}')
    })

    it('accepts delta with reasoning content text', () => {
      const delta: ContentBlockDelta = {
        reasoningContent: {
          text: 'Thinking...',
        },
      }
      expect(delta.reasoningContent?.text).toBe('Thinking...')
    })

    it('accepts delta with reasoning content signature', () => {
      const delta: ContentBlockDelta = {
        reasoningContent: {
          signature: 'sig-789',
        },
      }
      expect(delta.reasoningContent?.signature).toBe('sig-789')
    })

    it('accepts delta with multiple fields', () => {
      const delta: ContentBlockDelta = {
        text: 'Response',
        reasoningContent: {
          text: 'Reasoning',
        },
      }
      expect(delta.text).toBe('Response')
      expect(delta.reasoningContent?.text).toBe('Reasoning')
    })

    it('accepts empty delta', () => {
      const delta: ContentBlockDelta = {}
      expect(delta).toBeDefined()
    })
  })

  describe('ContentBlockDeltaEvent interface', () => {
    it('accepts event with contentBlockIndex and delta', () => {
      const event: ContentBlockDeltaEvent = {
        contentBlockIndex: 0,
        delta: {
          text: 'streaming text',
        },
      }
      expect(event.contentBlockIndex).toBe(0)
      expect(event.delta.text).toBe('streaming text')
    })

    it('accepts event with only delta', () => {
      const event: ContentBlockDeltaEvent = {
        delta: { text: 'more text' },
      }
      expect(event.delta.text).toBe('more text')
    })
  })

  describe('ContentBlockStopEvent interface', () => {
    it('accepts event with contentBlockIndex', () => {
      const event: ContentBlockStopEvent = {
        contentBlockIndex: 2,
      }
      expect(event.contentBlockIndex).toBe(2)
    })

    it('accepts empty event', () => {
      const event: ContentBlockStopEvent = {}
      expect(event).toBeDefined()
    })
  })

  describe('MessageStopEvent interface', () => {
    it('accepts event with stopReason', () => {
      const event: MessageStopEvent = {
        stopReason: 'end_turn',
      }
      expect(event.stopReason).toBe('end_turn')
    })

    it('accepts event with additionalModelResponseFields', () => {
      const event: MessageStopEvent = {
        additionalModelResponseFields: { customField: 'value' },
      }
      expect(event.additionalModelResponseFields).toBeDefined()
    })

    it('accepts event with all fields', () => {
      const event: MessageStopEvent = {
        stopReason: 'tool_use',
        additionalModelResponseFields: { trace: 'xyz' },
      }
      expect(event.stopReason).toBe('tool_use')
      expect(event.additionalModelResponseFields).toBeDefined()
    })

    it('accepts empty event', () => {
      const event: MessageStopEvent = {}
      expect(event).toBeDefined()
    })
  })

  describe('MetadataEvent interface', () => {
    it('accepts event with usage', () => {
      const event: MetadataEvent = {
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
        metrics: {
          latencyMs: 150,
        },
      }
      expect(event.metrics?.latencyMs).toBe(150)
    })

    it('accepts event with trace', () => {
      const event: MetadataEvent = {
        trace: { traceId: 'trace-123' },
      }
      expect(event.trace).toBeDefined()
    })

    it('accepts event with all fields', () => {
      const event: MetadataEvent = {
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
      const event: MetadataEvent = {}
      expect(event).toBeDefined()
    })
  })

  describe('StreamEvent union type', () => {
    it('accepts messageStart event', () => {
      const event: StreamEvent = {
        messageStart: { role: 'assistant' },
      }
      expect(event.messageStart).toBeDefined()
    })

    it('accepts contentBlockStart event', () => {
      const event: StreamEvent = {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { name: 'tool', toolUseId: 'id' } },
        },
      }
      expect(event.contentBlockStart).toBeDefined()
    })

    it('accepts contentBlockDelta event', () => {
      const event: StreamEvent = {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: 'chunk' },
        },
      }
      expect(event.contentBlockDelta).toBeDefined()
    })

    it('accepts contentBlockStop event', () => {
      const event: StreamEvent = {
        contentBlockStop: { contentBlockIndex: 0 },
      }
      expect(event.contentBlockStop).toBeDefined()
    })

    it('accepts messageStop event', () => {
      const event: StreamEvent = {
        messageStop: { stopReason: 'end_turn' },
      }
      expect(event.messageStop).toBeDefined()
    })

    it('accepts metadata event', () => {
      const event: StreamEvent = {
        metadata: {
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        },
      }
      expect(event.metadata).toBeDefined()
    })
  })
})
