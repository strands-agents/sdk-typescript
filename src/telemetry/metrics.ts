/**
 * OpenTelemetry metrics integration for Strands Agents.
 *
 * Provides a singleton MetricsClient that records counters and histograms
 * for agent event loop cycles and tool executions. Uses `\@opentelemetry/api`
 * as an optional dependency — when not installed, all recording operations
 * are silent no-ops.
 */

import type { Usage, Metrics } from '../models/streaming.js'

import * as constants from './metrics-constants.js'

/**
 * Minimal Counter interface matching the OTel API.
 */
interface Counter {
  add(value: number, attributes?: Record<string, string>): void
}

/**
 * Minimal Histogram interface matching the OTel API.
 */
interface Histogram {
  record(value: number, attributes?: Record<string, string>): void
}

/**
 * No-op counter for when OTel is not available.
 */
class NoOpCounter implements Counter {
  add(): void {}
}

/**
 * No-op histogram for when OTel is not available.
 */
class NoOpHistogram implements Histogram {
  record(): void {}
}

const NO_OP_COUNTER = new NoOpCounter()
const NO_OP_HISTOGRAM = new NoOpHistogram()

/**
 * Resolved OTel metrics module shape.
 */
interface OTelMetricsModule {
  metrics: {
    getMeterProvider(): {
      getMeter(name: string): OTelMeter
    }
  }
}

/**
 * Minimal Meter interface.
 */
interface OTelMeter {
  createCounter(name: string, options?: { unit?: string; description?: string }): Counter
  createHistogram(name: string, options?: { unit?: string; description?: string }): Histogram
}

/**
 * Singleton client that records OpenTelemetry metrics for agent operations.
 *
 * When `\@opentelemetry/api` is installed and a MeterProvider is configured,
 * creates real counters and histograms. When not available, all operations
 * are silent no-ops.
 */
export class MetricsClient {
  private static _instance: MetricsClient | undefined

  private _initialized = false

  // Counters
  eventLoopCycleCount: Counter = NO_OP_COUNTER
  eventLoopStartCycle: Counter = NO_OP_COUNTER
  eventLoopEndCycle: Counter = NO_OP_COUNTER
  toolCallCount: Counter = NO_OP_COUNTER
  toolSuccessCount: Counter = NO_OP_COUNTER
  toolErrorCount: Counter = NO_OP_COUNTER

  // Histograms
  eventLoopLatency: Histogram = NO_OP_HISTOGRAM
  toolDuration: Histogram = NO_OP_HISTOGRAM
  eventLoopCycleDuration: Histogram = NO_OP_HISTOGRAM
  eventLoopInputTokens: Histogram = NO_OP_HISTOGRAM
  eventLoopOutputTokens: Histogram = NO_OP_HISTOGRAM
  eventLoopCacheReadInputTokens: Histogram = NO_OP_HISTOGRAM
  eventLoopCacheWriteInputTokens: Histogram = NO_OP_HISTOGRAM
  modelTimeToFirstToken: Histogram = NO_OP_HISTOGRAM

  /**
   * Returns the singleton MetricsClient instance.
   *
   * @returns The global MetricsClient
   */
  static getInstance(): MetricsClient {
    if (!MetricsClient._instance) {
      MetricsClient._instance = new MetricsClient()
    }
    return MetricsClient._instance
  }

  /**
   * Resets the singleton instance (for testing).
   */
  static resetInstance(): void {
    MetricsClient._instance = undefined
  }

  /**
   * Initializes the metrics client by attempting to load `\@opentelemetry/api`.
   * Safe to call multiple times — only the first call performs the import.
   */
  async initialize(): Promise<void> {
    if (this._initialized) {
      return
    }
    this._initialized = true

    try {
      const otel = (await import('@opentelemetry/api')) as unknown as OTelMetricsModule
      const meter = otel.metrics.getMeterProvider().getMeter('strands-agents')
      this._createInstruments(meter)
    } catch {
      // @opentelemetry/api is not installed — remain in no-op mode
    }
  }

  /**
   * Records metrics for a completed event loop cycle.
   *
   * @param params - Cycle metrics parameters
   */
  recordCycleMetrics(params: { usage: Usage; metrics: Metrics; attributes?: Record<string, string> }): void {
    const { usage, metrics, attributes } = params

    this.eventLoopInputTokens.record(usage.inputTokens, attributes)
    this.eventLoopOutputTokens.record(usage.outputTokens, attributes)

    if (usage.cacheReadInputTokens !== undefined) {
      this.eventLoopCacheReadInputTokens.record(usage.cacheReadInputTokens, attributes)
    }
    if (usage.cacheWriteInputTokens !== undefined) {
      this.eventLoopCacheWriteInputTokens.record(usage.cacheWriteInputTokens, attributes)
    }

    this.eventLoopLatency.record(metrics.latencyMs, attributes)
    if (metrics.timeToFirstByteMs !== undefined) {
      this.modelTimeToFirstToken.record(metrics.timeToFirstByteMs, attributes)
    }
  }

  /**
   * Records metrics for a tool call execution.
   *
   * @param params - Tool metrics parameters
   */
  recordToolMetrics(params: {
    toolName: string
    duration: number
    success: boolean
    attributes?: Record<string, string>
  }): void {
    const attrs = { tool_name: params.toolName, ...params.attributes }
    this.toolCallCount.add(1, attrs)
    this.toolDuration.record(params.duration, attrs)

    if (params.success) {
      this.toolSuccessCount.add(1, attrs)
    } else {
      this.toolErrorCount.add(1, attrs)
    }
  }

  /**
   * Creates OTel instruments from a meter.
   */
  private _createInstruments(meter: OTelMeter): void {
    this.eventLoopCycleCount = meter.createCounter(constants.STRANDS_EVENT_LOOP_CYCLE_COUNT, { unit: 'Count' })
    this.eventLoopStartCycle = meter.createCounter(constants.STRANDS_EVENT_LOOP_START_CYCLE, { unit: 'Count' })
    this.eventLoopEndCycle = meter.createCounter(constants.STRANDS_EVENT_LOOP_END_CYCLE, { unit: 'Count' })
    this.toolCallCount = meter.createCounter(constants.STRANDS_TOOL_CALL_COUNT, { unit: 'Count' })
    this.toolSuccessCount = meter.createCounter(constants.STRANDS_TOOL_SUCCESS_COUNT, { unit: 'Count' })
    this.toolErrorCount = meter.createCounter(constants.STRANDS_TOOL_ERROR_COUNT, { unit: 'Count' })

    this.eventLoopLatency = meter.createHistogram(constants.STRANDS_EVENT_LOOP_LATENCY, { unit: 'ms' })
    this.toolDuration = meter.createHistogram(constants.STRANDS_TOOL_DURATION, { unit: 's' })
    this.eventLoopCycleDuration = meter.createHistogram(constants.STRANDS_EVENT_LOOP_CYCLE_DURATION, { unit: 's' })
    this.eventLoopInputTokens = meter.createHistogram(constants.STRANDS_EVENT_LOOP_INPUT_TOKENS, { unit: 'token' })
    this.eventLoopOutputTokens = meter.createHistogram(constants.STRANDS_EVENT_LOOP_OUTPUT_TOKENS, { unit: 'token' })
    this.eventLoopCacheReadInputTokens = meter.createHistogram(constants.STRANDS_EVENT_LOOP_CACHE_READ_INPUT_TOKENS, {
      unit: 'token',
    })
    this.eventLoopCacheWriteInputTokens = meter.createHistogram(constants.STRANDS_EVENT_LOOP_CACHE_WRITE_INPUT_TOKENS, {
      unit: 'token',
    })
    this.modelTimeToFirstToken = meter.createHistogram(constants.STRANDS_MODEL_TIME_TO_FIRST_TOKEN, { unit: 'ms' })
  }
}
