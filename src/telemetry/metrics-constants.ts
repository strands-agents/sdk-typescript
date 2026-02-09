/**
 * OpenTelemetry metric name constants for Strands Agents.
 *
 * Defines counter and histogram metric names used by the MetricsClient
 * for recording agent, event loop, and tool execution metrics.
 */

// Counters
export const STRANDS_EVENT_LOOP_CYCLE_COUNT = 'strands.event_loop.cycle_count'
export const STRANDS_EVENT_LOOP_START_CYCLE = 'strands.event_loop.start_cycle'
export const STRANDS_EVENT_LOOP_END_CYCLE = 'strands.event_loop.end_cycle'
export const STRANDS_TOOL_CALL_COUNT = 'strands.tool.call_count'
export const STRANDS_TOOL_SUCCESS_COUNT = 'strands.tool.success_count'
export const STRANDS_TOOL_ERROR_COUNT = 'strands.tool.error_count'

// Histograms
export const STRANDS_EVENT_LOOP_LATENCY = 'strands.event_loop.latency'
export const STRANDS_TOOL_DURATION = 'strands.tool.duration'
export const STRANDS_EVENT_LOOP_CYCLE_DURATION = 'strands.event_loop.cycle_duration'
export const STRANDS_EVENT_LOOP_INPUT_TOKENS = 'strands.event_loop.input.tokens'
export const STRANDS_EVENT_LOOP_OUTPUT_TOKENS = 'strands.event_loop.output.tokens'
export const STRANDS_EVENT_LOOP_CACHE_READ_INPUT_TOKENS = 'strands.event_loop.cache_read.input.tokens'
export const STRANDS_EVENT_LOOP_CACHE_WRITE_INPUT_TOKENS = 'strands.event_loop.cache_write.input.tokens'
export const STRANDS_MODEL_TIME_TO_FIRST_TOKEN = 'strands.model.time_to_first_token'
