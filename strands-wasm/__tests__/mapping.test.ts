import { describe, it, expect } from 'vitest'
import {
  mapUsage,
  mapMetrics,
  mapStopReasonTag,
  mapStopReason,
  mapEvent,
  parseInput,
  parseSaveLatestStrategy,
} from '../../entry'

describe('mapUsage', () => {
  it.each([null, undefined])('returns undefined for %s input', (input) => {
    expect(mapUsage(input)).toBeUndefined()
  })

  it('maps all fields correctly', () => {
    expect(mapUsage({ inputTokens: 10, outputTokens: 20, totalTokens: 30 })).toStrictEqual({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      cacheReadInputTokens: undefined,
      cacheWriteInputTokens: undefined,
    })
  })

  it('computes totalTokens when missing', () => {
    expect(mapUsage({ inputTokens: 5, outputTokens: 3 })).toStrictEqual({
      inputTokens: 5,
      outputTokens: 3,
      totalTokens: 8,
      cacheReadInputTokens: undefined,
      cacheWriteInputTokens: undefined,
    })
  })

  it('includes cache fields when present', () => {
    expect(
      mapUsage({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cacheReadInputTokens: 5,
        cacheWriteInputTokens: 2,
      })
    ).toStrictEqual({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      cacheReadInputTokens: 5,
      cacheWriteInputTokens: 2,
    })
  })
})

describe('mapMetrics', () => {
  it.each([null, undefined])('returns undefined for %s input', (input) => {
    expect(mapMetrics(input)).toBeUndefined()
  })

  it('maps latencyMs', () => {
    expect(mapMetrics({ latencyMs: 150 })).toStrictEqual({ latencyMs: 150 })
  })

  it('defaults latencyMs to 0 when field is absent', () => {
    expect(mapMetrics({})).toStrictEqual({ latencyMs: 0 })
  })

  it('defaults latencyMs to 0 when field is explicitly undefined', () => {
    expect(mapMetrics({ latencyMs: undefined })).toStrictEqual({ latencyMs: 0 })
  })
})

describe('mapStopReasonTag', () => {
  const witStopReasons: string[] = [
    'end-turn',
    'tool-use',
    'max-tokens',
    'error',
    'content-filtered',
    'guardrail-intervened',
    'stop-sequence',
    'model-context-window-exceeded',
    'cancelled',
  ]

  it.each([
    ['endTurn', 'end-turn'],
    ['toolUse', 'tool-use'],
    ['maxTokens', 'max-tokens'],
    ['contentFiltered', 'content-filtered'],
    ['guardrailIntervened', 'guardrail-intervened'],
    ['stopSequence', 'stop-sequence'],
    ['modelContextWindowExceeded', 'model-context-window-exceeded'],
    ['cancelled', 'cancelled'],
  ])("maps '%s' to '%s'", (input, expected) => {
    expect(mapStopReasonTag(input as any)).toBe(expected)
  })

  it("maps unknown reason to 'error'", () => {
    expect(mapStopReasonTag('unknownReason' as any)).toBe('error')
  })

  it('covers every WIT StopReason variant except error', () => {
    const mappedOutputs = [
      'end-turn',
      'tool-use',
      'max-tokens',
      'content-filtered',
      'guardrail-intervened',
      'stop-sequence',
      'model-context-window-exceeded',
      'cancelled',
    ]
    const nonErrorVariants = witStopReasons.filter((r) => r !== 'error')
    expect(mappedOutputs.sort()).toStrictEqual(nonErrorVariants.sort())
  })
})

describe('mapStopReason', () => {
  it('maps reason with no agent result', () => {
    expect(mapStopReason('endTurn')).toStrictEqual({
      reason: 'end-turn',
      usage: undefined,
      metrics: undefined,
    })
  })

  it('maps reason with usage and metrics', () => {
    expect(
      mapStopReason('toolUse', {
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        metrics: { latencyMs: 100 },
      })
    ).toStrictEqual({
      reason: 'tool-use',
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        cacheReadInputTokens: undefined,
        cacheWriteInputTokens: undefined,
      },
      metrics: { latencyMs: 100 },
    })
  })
})

describe('mapEvent', () => {
  describe('leaf events', () => {
    it('maps text delta', () => {
      expect(
        mapEvent({ type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: 'hello' } } as any)
      ).toStrictEqual({ tag: 'text-delta', val: 'hello' })
    })

    it('maps toolUseBlock', () => {
      expect(mapEvent({ type: 'toolUseBlock', name: 'calc', toolUseId: 'tu-1', input: { x: 1 } } as any)).toStrictEqual(
        {
          tag: 'tool-use',
          val: { name: 'calc', toolUseId: 'tu-1', input: '{"x":1}' },
        }
      )
    })

    it('maps modelContentBlockStartEvent with tool_use contentBlock', () => {
      expect(
        mapEvent({
          type: 'modelContentBlockStartEvent',
          contentBlock: { type: 'tool_use', name: 'calc', id: 'tu-5', input: { x: 1 } },
        } as any)
      ).toStrictEqual({
        tag: 'tool-use',
        val: { name: 'calc', toolUseId: 'tu-5', input: '{"x":1}' },
      })
    })

    it('maps toolResultBlock', () => {
      expect(
        mapEvent({
          type: 'toolResultBlock',
          toolUseId: 'tu-1',
          status: 'success',
          content: [{ text: 'ok' }],
        } as any)
      ).toStrictEqual({
        tag: 'tool-result',
        val: { toolUseId: 'tu-1', status: 'success', content: '[{"text":"ok"}]' },
      })
    })

    it('maps toolStreamEvent', () => {
      expect(mapEvent({ type: 'toolStreamEvent', data: { value: 42 } } as any)).toStrictEqual({
        tag: 'tool-result',
        val: { toolUseId: '', status: 'success', content: '{"data":{"value":42}}' },
      })
    })

    it('maps modelMetadataEvent', () => {
      expect(
        mapEvent({
          type: 'modelMetadataEvent',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          metrics: { latencyMs: 50 },
        } as any)
      ).toStrictEqual({
        tag: 'metadata',
        val: {
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            cacheReadInputTokens: undefined,
            cacheWriteInputTokens: undefined,
          },
          metrics: { latencyMs: 50 },
        },
      })
    })

    it('maps interrupt event', () => {
      const event = { interrupt: { reason: 'user' } }
      expect(mapEvent(event as any)).toStrictEqual({ tag: 'interrupt', val: JSON.stringify(event) })
    })

    it('returns null for unrecognized event type', () => {
      expect(mapEvent({ type: 'unknownEvent' } as any)).toBeNull()
    })

    it('returns null for non-text delta', () => {
      expect(mapEvent({ type: 'modelContentBlockDeltaEvent', delta: { type: 'toolUseInputDelta' } } as any)).toBeNull()
    })
  })

  describe('wrapper events', () => {
    it('unwraps modelStreamUpdateEvent', () => {
      expect(
        mapEvent({
          type: 'modelStreamUpdateEvent',
          event: { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: 'wrapped' } },
        } as any)
      ).toStrictEqual({ tag: 'text-delta', val: 'wrapped' })
    })

    it('unwraps contentBlockEvent wrapping toolUseBlock', () => {
      expect(
        mapEvent({
          type: 'contentBlockEvent',
          contentBlock: { type: 'toolUseBlock', name: 'tool1', toolUseId: 'tu-2', input: {} },
        } as any)
      ).toStrictEqual({
        tag: 'tool-use',
        val: { name: 'tool1', toolUseId: 'tu-2', input: '{}' },
      })
    })

    it('unwraps toolResultEvent', () => {
      expect(
        mapEvent({
          type: 'toolResultEvent',
          result: { type: 'toolResultBlock', toolUseId: 'tu-3', status: 'error', content: [] },
        } as any)
      ).toStrictEqual({
        tag: 'tool-result',
        val: { toolUseId: 'tu-3', status: 'error', content: '[]' },
      })
    })

    it('returns null for event without type property', () => {
      expect(mapEvent({ someField: 'value' } as any)).toBeNull()
    })
  })
})

describe('parseInput', () => {
  it('returns parsed array for JSON array input', () => {
    expect(parseInput('[{"type":"text","text":"hi"}]')).toStrictEqual([{ type: 'text', text: 'hi' }])
  })

  it('returns string for plain text', () => {
    expect(parseInput('hello world')).toBe('hello world')
  })

  it('returns original string for JSON object (non-array)', () => {
    expect(parseInput('{"key":"value"}')).toBe('{"key":"value"}')
  })

  it('returns empty string for empty input', () => {
    expect(parseInput('')).toBe('')
  })

  it('returns original string for malformed JSON', () => {
    expect(parseInput('{bad json')).toBe('{bad json')
  })
})

describe('parseSaveLatestStrategy', () => {
  it.each(['message', 'invocation', 'trigger'] as const)("accepts valid strategy '%s'", (strategy) => {
    expect(parseSaveLatestStrategy(strategy)).toBe(strategy)
  })

  it('returns undefined for unknown strategy', () => {
    expect(parseSaveLatestStrategy('unknown')).toBeUndefined()
  })

  it('returns undefined for undefined input', () => {
    expect(parseSaveLatestStrategy(undefined)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(parseSaveLatestStrategy('')).toBeUndefined()
  })
})
