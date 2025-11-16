import type { Usage } from '../models/streaming.js'

/**
 * Comprehensive metrics collected during agent execution.
 * Includes event loop cycles, model invocations, tool executions, and execution traces.
 */
export interface Metrics {
  /**
   * Event loop cycle metrics.
   */
  eventLoop: EventLoopMetrics

  /**
   * Model invocation metrics.
   */
  model: ModelMetrics

  /**
   * Tool execution metrics grouped by tool name.
   */
  tools: ToolMetrics

  /**
   * Execution trace tree for debugging.
   */
  traces: Trace[]
}

/**
 * Metrics for agent event loop cycles.
 * Tracks the number of cycles and their durations.
 */
export interface EventLoopMetrics {
  /**
   * Total number of event loop cycles executed.
   */
  cycleCount: number

  /**
   * Total duration across all cycles in milliseconds.
   */
  totalDurationMs: number

  /**
   * Duration of each individual cycle in milliseconds.
   */
  cycleDurationsMs: number[]
}

/**
 * Aggregated metrics for model invocations.
 * Includes both totals and per-invocation details.
 */
export interface ModelMetrics {
  /**
   * Total number of model invocations.
   */
  invocationCount: number

  /**
   * Total latency across all invocations in milliseconds.
   */
  totalLatencyMs: number

  /**
   * Aggregated token usage across all invocations.
   */
  aggregatedUsage: Usage

  /**
   * Detailed metrics for each model invocation.
   */
  invocations: ModelInvocationMetrics[]
}

/**
 * Metrics for a single model invocation.
 * Captures latency, token usage, and time to first byte.
 */
export interface ModelInvocationMetrics {
  /**
   * Latency for this invocation in milliseconds.
   */
  latencyMs: number

  /**
   * Token usage for this invocation.
   */
  usage: Usage

  /**
   * Time to first byte in milliseconds.
   */
  timeToFirstByteMs?: number
}

/**
 * Tool execution metrics grouped by tool name.
 * Each key is a tool name, and the value contains that tool's execution statistics.
 */
export interface ToolMetrics {
  [toolName: string]: ToolExecutionMetrics
}

/**
 * Execution statistics for a single tool.
 * Tracks call counts, success/error rates, and timing information.
 */
export interface ToolExecutionMetrics {
  /**
   * Total number of times this tool was called.
   */
  callCount: number

  /**
   * Number of successful executions.
   */
  successCount: number

  /**
   * Number of failed executions.
   */
  errorCount: number

  /**
   * Total duration across all calls in milliseconds.
   */
  totalDurationMs: number

  /**
   * Average duration per call in milliseconds.
   */
  averageDurationMs: number
}

/**
 * Execution trace node representing a step in the agent execution.
 * Forms a tree structure with parent-child relationships.
 */
export interface Trace {
  /**
   * Unique identifier for this trace node.
   */
  id: string

  /**
   * Human-readable name for this trace (e.g., "Cycle 1", "toolName").
   */
  name: string

  /**
   * Start time in milliseconds from performance.now().
   */
  startTime: number

  /**
   * End time in milliseconds from performance.now().
   */
  endTime?: number

  /**
   * Duration in milliseconds.
   */
  durationMs?: number

  /**
   * Parent trace ID for building trace tree.
   */
  parentId?: string

  /**
   * Child trace nodes.
   */
  children: Trace[]

  /**
   * Additional metadata for this trace.
   */
  metadata?: Record<string, unknown>
}
