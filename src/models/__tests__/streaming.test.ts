import { describe, it, expect } from 'vitest'
import type { Role, StopReason } from '../../types/messages'
import type { JSONValue } from '../../types/json'
import {
  ModelMessageStartEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStopEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
  ToolUseStart,
  TextDelta,
  ToolUseInputDelta,
  ReasoningContentDelta,
  type ModelStreamEvent,
  type Usage,
  type Metrics,
} from '../streaming'

describe('ModelMessageStartEvent', () => {
  describe('constructor', () => {
    it('creates instance with valid data', () => {
      const role: Role = 'assistant'
      const event = new ModelMessageStartEvent({ role })

      expect(event.type).toBe('modelMessageStartEvent')
      expect(event.role).toBe('assistant')
    })
  })

  describe('type discrimination', () => {
    it('can be used in discriminated union', () => {
      const event: ModelStreamEvent = new ModelMessageStartEvent({ role: 'assistant' })

      if (event.type === 'modelMessageStartEvent') {
        expect(event.role).toBe('assistant')
      } else {
        throw new Error('Type discrimination failed')
      }
    })
  })
})

describe('ModelContentBlockStartEvent', () => {
  describe('constructor', () => {
    it('creates instance with contentBlockIndex only', () => {
      const event = new ModelContentBlockStartEvent({ contentBlockIndex: 0 })

      expect(event.type).toBe('modelContentBlockStartEvent')
      expect(event.contentBlockIndex).toBe(0)
      expect(event.start).toBeUndefined()
    })

    it('creates instance with start info', () => {
      const start = new ToolUseStart({ name: 'calculator', toolUseId: 'tool_123' })
      const event = new ModelContentBlockStartEvent({ contentBlockIndex: 0, start })

      expect(event.type).toBe('modelContentBlockStartEvent')
      expect(event.contentBlockIndex).toBe(0)
      expect(event.start).toBe(start)
    })

    it('creates instance without optional fields', () => {
      const event = new ModelContentBlockStartEvent({})

      expect(event.type).toBe('modelContentBlockStartEvent')
      expect(event.contentBlockIndex).toBeUndefined()
      expect(event.start).toBeUndefined()
    })
  })
})

describe('ModelContentBlockDeltaEvent', () => {
  describe('constructor', () => {
    it('creates instance with TextDelta', () => {
      const delta = new TextDelta({ text: 'hello' })
      const event = new ModelContentBlockDeltaEvent({ delta, contentBlockIndex: 0 })

      expect(event.type).toBe('modelContentBlockDeltaEvent')
      expect(event.delta).toBe(delta)
      expect(event.contentBlockIndex).toBe(0)
    })

    it('creates instance with ToolUseInputDelta', () => {
      const delta = new ToolUseInputDelta({ input: '{"key":' })
      const event = new ModelContentBlockDeltaEvent({ delta, contentBlockIndex: 1 })

      expect(event.type).toBe('modelContentBlockDeltaEvent')
      expect(event.delta).toBe(delta)
      expect(event.contentBlockIndex).toBe(1)
    })

    it('creates instance with ReasoningContentDelta', () => {
      const delta = new ReasoningContentDelta({ text: 'thinking...' })
      const event = new ModelContentBlockDeltaEvent({ delta })

      expect(event.type).toBe('modelContentBlockDeltaEvent')
      expect(event.delta).toBe(delta)
      expect(event.contentBlockIndex).toBeUndefined()
    })
  })
})

describe('ModelContentBlockStopEvent', () => {
  describe('constructor', () => {
    it('creates instance with contentBlockIndex', () => {
      const event = new ModelContentBlockStopEvent({ contentBlockIndex: 0 })

      expect(event.type).toBe('modelContentBlockStopEvent')
      expect(event.contentBlockIndex).toBe(0)
    })

    it('creates instance without contentBlockIndex', () => {
      const event = new ModelContentBlockStopEvent({})

      expect(event.type).toBe('modelContentBlockStopEvent')
      expect(event.contentBlockIndex).toBeUndefined()
    })
  })
})

describe('ModelMessageStopEvent', () => {
  describe('constructor', () => {
    it('creates instance with stopReason', () => {
      const stopReason: StopReason = 'endTurn'
      const event = new ModelMessageStopEvent({ stopReason })

      expect(event.type).toBe('modelMessageStopEvent')
      expect(event.stopReason).toBe('endTurn')
      expect(event.additionalModelResponseFields).toBeUndefined()
    })

    it('creates instance with additionalModelResponseFields', () => {
      const additionalModelResponseFields: JSONValue = { key: 'value' }
      const event = new ModelMessageStopEvent({ additionalModelResponseFields })

      expect(event.type).toBe('modelMessageStopEvent')
      expect(event.stopReason).toBeUndefined()
      expect(event.additionalModelResponseFields).toEqual({ key: 'value' })
    })

    it('creates instance with both fields', () => {
      const stopReason: StopReason = 'maxTokens'
      const additionalModelResponseFields: JSONValue = { key: 'value' }
      const event = new ModelMessageStopEvent({ stopReason, additionalModelResponseFields })

      expect(event.type).toBe('modelMessageStopEvent')
      expect(event.stopReason).toBe('maxTokens')
      expect(event.additionalModelResponseFields).toEqual({ key: 'value' })
    })

    it('creates instance with no optional fields', () => {
      const event = new ModelMessageStopEvent({})

      expect(event.type).toBe('modelMessageStopEvent')
      expect(event.stopReason).toBeUndefined()
      expect(event.additionalModelResponseFields).toBeUndefined()
    })
  })
})

describe('ModelMetadataEvent', () => {
  describe('constructor', () => {
    it('creates instance with usage', () => {
      const usage: Usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
      const event = new ModelMetadataEvent({ usage })

      expect(event.type).toBe('modelMetadataEvent')
      expect(event.usage).toEqual(usage)
      expect(event.metrics).toBeUndefined()
      expect(event.trace).toBeUndefined()
    })

    it('creates instance with metrics', () => {
      const metrics: Metrics = { latencyMs: 500 }
      const event = new ModelMetadataEvent({ metrics })

      expect(event.type).toBe('modelMetadataEvent')
      expect(event.usage).toBeUndefined()
      expect(event.metrics).toEqual(metrics)
      expect(event.trace).toBeUndefined()
    })

    it('creates instance with trace', () => {
      const trace = { traceId: 'abc123' }
      const event = new ModelMetadataEvent({ trace })

      expect(event.type).toBe('modelMetadataEvent')
      expect(event.usage).toBeUndefined()
      expect(event.metrics).toBeUndefined()
      expect(event.trace).toEqual(trace)
    })

    it('creates instance with all fields', () => {
      const usage: Usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
      const metrics: Metrics = { latencyMs: 500 }
      const trace = { traceId: 'abc123' }
      const event = new ModelMetadataEvent({ usage, metrics, trace })

      expect(event.type).toBe('modelMetadataEvent')
      expect(event.usage).toEqual(usage)
      expect(event.metrics).toEqual(metrics)
      expect(event.trace).toEqual(trace)
    })

    it('creates instance with no fields', () => {
      const event = new ModelMetadataEvent({})

      expect(event.type).toBe('modelMetadataEvent')
      expect(event.usage).toBeUndefined()
      expect(event.metrics).toBeUndefined()
      expect(event.trace).toBeUndefined()
    })
  })
})

describe('ToolUseStart', () => {
  describe('constructor', () => {
    it('creates instance with valid data', () => {
      const start = new ToolUseStart({ name: 'calculator', toolUseId: 'tool_123' })

      expect(start.type).toBe('toolUseStart')
      expect(start.name).toBe('calculator')
      expect(start.toolUseId).toBe('tool_123')
    })
  })
})

describe('TextDelta', () => {
  describe('constructor', () => {
    it('creates instance with valid data', () => {
      const delta = new TextDelta({ text: 'Hello world' })

      expect(delta.type).toBe('textDelta')
      expect(delta.text).toBe('Hello world')
    })
  })
})

describe('ToolUseInputDelta', () => {
  describe('constructor', () => {
    it('creates instance with valid data', () => {
      const delta = new ToolUseInputDelta({ input: '{"operation":"add"' })

      expect(delta.type).toBe('toolUseInputDelta')
      expect(delta.input).toBe('{"operation":"add"')
    })
  })
})

describe('ReasoningContentDelta', () => {
  describe('constructor', () => {
    it('creates instance with text only', () => {
      const delta = new ReasoningContentDelta({ text: 'analyzing...' })

      expect(delta.type).toBe('reasoningContentDelta')
      expect(delta.text).toBe('analyzing...')
      expect(delta.signature).toBeUndefined()
      expect(delta.redactedContent).toBeUndefined()
    })

    it('creates instance with signature only', () => {
      const delta = new ReasoningContentDelta({ signature: 'sig_data' })

      expect(delta.type).toBe('reasoningContentDelta')
      expect(delta.text).toBeUndefined()
      expect(delta.signature).toBe('sig_data')
      expect(delta.redactedContent).toBeUndefined()
    })

    it('creates instance with redactedContent only', () => {
      const redactedContent = new Uint8Array([1, 2, 3])
      const delta = new ReasoningContentDelta({ redactedContent })

      expect(delta.type).toBe('reasoningContentDelta')
      expect(delta.text).toBeUndefined()
      expect(delta.signature).toBeUndefined()
      expect(delta.redactedContent).toBe(redactedContent)
    })

    it('creates instance with all fields', () => {
      const redactedContent = new Uint8Array([1, 2, 3])
      const delta = new ReasoningContentDelta({
        text: 'analyzing...',
        signature: 'sig_data',
        redactedContent,
      })

      expect(delta.type).toBe('reasoningContentDelta')
      expect(delta.text).toBe('analyzing...')
      expect(delta.signature).toBe('sig_data')
      expect(delta.redactedContent).toBe(redactedContent)
    })

    it('creates instance with no fields', () => {
      const delta = new ReasoningContentDelta({})

      expect(delta.type).toBe('reasoningContentDelta')
      expect(delta.text).toBeUndefined()
      expect(delta.signature).toBeUndefined()
      expect(delta.redactedContent).toBeUndefined()
    })
  })
})

describe('Type discrimination', () => {
  it('correctly discriminates ModelMessageStartEvent', () => {
    const event: ModelStreamEvent = new ModelMessageStartEvent({ role: 'assistant' })

    switch (event.type) {
      case 'modelMessageStartEvent':
        expect(event.role).toBe('assistant')
        break
      default:
        throw new Error('Wrong type discrimination')
    }
  })

  it('correctly discriminates ModelContentBlockDeltaEvent with TextDelta', () => {
    const delta = new TextDelta({ text: 'hello' })
    const event: ModelStreamEvent = new ModelContentBlockDeltaEvent({ delta })

    switch (event.type) {
      case 'modelContentBlockDeltaEvent':
        switch (event.delta.type) {
          case 'textDelta':
            expect(event.delta.text).toBe('hello')
            break
          default:
            throw new Error('Wrong delta type discrimination')
        }
        break
      default:
        throw new Error('Wrong event type discrimination')
    }
  })

  it('correctly discriminates ModelMessageStopEvent', () => {
    const event: ModelStreamEvent = new ModelMessageStopEvent({ stopReason: 'endTurn' })

    switch (event.type) {
      case 'modelMessageStopEvent':
        expect(event.stopReason).toBe('endTurn')
        break
      default:
        throw new Error('Wrong type discrimination')
    }
  })
})
