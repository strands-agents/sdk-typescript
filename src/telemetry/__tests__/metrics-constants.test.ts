import { describe, it, expect } from 'vitest'
import {
  STRANDS_EVENT_LOOP_CYCLE_COUNT,
  STRANDS_EVENT_LOOP_START_CYCLE,
  STRANDS_EVENT_LOOP_END_CYCLE,
  STRANDS_TOOL_CALL_COUNT,
  STRANDS_TOOL_SUCCESS_COUNT,
  STRANDS_TOOL_ERROR_COUNT,
  STRANDS_EVENT_LOOP_LATENCY,
  STRANDS_TOOL_DURATION,
  STRANDS_EVENT_LOOP_CYCLE_DURATION,
  STRANDS_EVENT_LOOP_INPUT_TOKENS,
  STRANDS_EVENT_LOOP_OUTPUT_TOKENS,
  STRANDS_EVENT_LOOP_CACHE_READ_INPUT_TOKENS,
  STRANDS_EVENT_LOOP_CACHE_WRITE_INPUT_TOKENS,
  STRANDS_MODEL_TIME_TO_FIRST_TOKEN,
} from '../metrics-constants.js'

describe('metrics constants', () => {
  it('defines all expected counter metrics', () => {
    expect(STRANDS_EVENT_LOOP_CYCLE_COUNT).toBe('strands.event_loop.cycle_count')
    expect(STRANDS_EVENT_LOOP_START_CYCLE).toBe('strands.event_loop.start_cycle')
    expect(STRANDS_EVENT_LOOP_END_CYCLE).toBe('strands.event_loop.end_cycle')
    expect(STRANDS_TOOL_CALL_COUNT).toBe('strands.tool.call_count')
    expect(STRANDS_TOOL_SUCCESS_COUNT).toBe('strands.tool.success_count')
    expect(STRANDS_TOOL_ERROR_COUNT).toBe('strands.tool.error_count')
  })

  it('defines all expected histogram metrics', () => {
    expect(STRANDS_EVENT_LOOP_LATENCY).toBe('strands.event_loop.latency')
    expect(STRANDS_TOOL_DURATION).toBe('strands.tool.duration')
    expect(STRANDS_EVENT_LOOP_CYCLE_DURATION).toBe('strands.event_loop.cycle_duration')
    expect(STRANDS_EVENT_LOOP_INPUT_TOKENS).toBe('strands.event_loop.input.tokens')
    expect(STRANDS_EVENT_LOOP_OUTPUT_TOKENS).toBe('strands.event_loop.output.tokens')
    expect(STRANDS_EVENT_LOOP_CACHE_READ_INPUT_TOKENS).toBe('strands.event_loop.cache_read.input.tokens')
    expect(STRANDS_EVENT_LOOP_CACHE_WRITE_INPUT_TOKENS).toBe('strands.event_loop.cache_write.input.tokens')
    expect(STRANDS_MODEL_TIME_TO_FIRST_TOKEN).toBe('strands.model.time_to_first_token')
  })

  it('uses strands namespace prefix for all metrics', () => {
    const allConstants = [
      STRANDS_EVENT_LOOP_CYCLE_COUNT,
      STRANDS_EVENT_LOOP_START_CYCLE,
      STRANDS_EVENT_LOOP_END_CYCLE,
      STRANDS_TOOL_CALL_COUNT,
      STRANDS_TOOL_SUCCESS_COUNT,
      STRANDS_TOOL_ERROR_COUNT,
      STRANDS_EVENT_LOOP_LATENCY,
      STRANDS_TOOL_DURATION,
      STRANDS_EVENT_LOOP_CYCLE_DURATION,
      STRANDS_EVENT_LOOP_INPUT_TOKENS,
      STRANDS_EVENT_LOOP_OUTPUT_TOKENS,
      STRANDS_EVENT_LOOP_CACHE_READ_INPUT_TOKENS,
      STRANDS_EVENT_LOOP_CACHE_WRITE_INPUT_TOKENS,
      STRANDS_MODEL_TIME_TO_FIRST_TOKEN,
    ]
    for (const constant of allConstants) {
      expect(constant).toMatch(/^strands\./)
    }
  })
})
