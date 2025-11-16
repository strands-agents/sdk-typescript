import type {
  Metrics,
  EventLoopMetrics,
  ModelMetrics,
  ToolMetrics,
  Trace,
  ModelInvocationMetrics,
} from '../types/metrics.js'
import type { Usage } from '../models/streaming.js'

/**
 * OpenTelemetry types (imported as 'any' to make them optional dependencies)
 */
interface MeterProvider {
  getMeter(name: string): Meter
}

interface Meter {
  createCounter(name: string): Counter
  createHistogram(name: string): Histogram
}

interface Counter {
  add(value: number, attributes?: Record<string, string>): void
}

interface Histogram {
  record(value: number, attributes?: Record<string, string>): void
}

interface OTelInstruments {
  eventLoopCycleCount: Counter
  eventLoopCycleDuration: Histogram
  modelInvocationCount: Counter
  modelLatency: Histogram
  modelInputTokens: Histogram
  modelOutputTokens: Histogram
  modelCacheReadTokens: Histogram
  modelCacheWriteTokens: Histogram
  toolCallCount: Counter
  toolSuccessCount: Counter
  toolErrorCount: Counter
  toolDuration: Histogram
}

/**
 * Collects and aggregates metrics during agent execution.
 * Optionally emits metrics to OpenTelemetry in real-time.
 */
export class MetricsCollector {
  private _eventLoopMetrics: EventLoopMetrics
  private _modelMetrics: ModelMetrics
  private _toolMetrics: ToolMetrics
  private _traces: Trace[]

  private _otelMeter?: Meter
  private _otelInstruments?: OTelInstruments

  /**
   * Creates a new MetricsCollector instance.
   *
   * @param otelMeterProvider - Optional OpenTelemetry MeterProvider for real-time metric emission
   */
  constructor(otelMeterProvider?: MeterProvider) {
    this._eventLoopMetrics = {
      cycleCount: 0,
      totalDurationMs: 0,
      cycleDurationsMs: [],
    }

    this._modelMetrics = {
      invocationCount: 0,
      totalLatencyMs: 0,
      aggregatedUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      invocations: [],
    }

    this._toolMetrics = {}
    this._traces = []

    if (otelMeterProvider) {
      this._otelMeter = otelMeterProvider.getMeter('strands-agents-sdk')
      this._initializeOTelInstruments()
    }
  }

  /**
   * Initializes OpenTelemetry instruments for real-time metric emission.
   */
  private _initializeOTelInstruments(): void {
    if (!this._otelMeter) {
      return
    }

    this._otelInstruments = {
      eventLoopCycleCount: this._otelMeter.createCounter('strands.event_loop.cycle.count'),
      eventLoopCycleDuration: this._otelMeter.createHistogram('strands.event_loop.cycle.duration'),
      modelInvocationCount: this._otelMeter.createCounter('strands.model.invocation.count'),
      modelLatency: this._otelMeter.createHistogram('strands.model.latency'),
      modelInputTokens: this._otelMeter.createHistogram('strands.model.input_tokens'),
      modelOutputTokens: this._otelMeter.createHistogram('strands.model.output_tokens'),
      modelCacheReadTokens: this._otelMeter.createHistogram('strands.model.cache_read_tokens'),
      modelCacheWriteTokens: this._otelMeter.createHistogram('strands.model.cache_write_tokens'),
      toolCallCount: this._otelMeter.createCounter('strands.tool.call.count'),
      toolSuccessCount: this._otelMeter.createCounter('strands.tool.success.count'),
      toolErrorCount: this._otelMeter.createCounter('strands.tool.error.count'),
      toolDuration: this._otelMeter.createHistogram('strands.tool.duration'),
    }
  }

  /**
   * Starts a new event loop cycle and creates a trace for it.
   *
   * @returns Object containing start time and trace node
   */
  startCycle(): { startTime: number; trace: Trace } {
    const startTime = performance.now()
    const trace: Trace = {
      id: crypto.randomUUID(),
      name: `Cycle ${this._eventLoopMetrics.cycleCount + 1}`,
      startTime,
      children: [],
    }
    this._traces.push(trace)

    // Emit to OTel in real-time
    this._otelInstruments?.eventLoopCycleCount.add(1)

    return { startTime, trace }
  }

  /**
   * Ends an event loop cycle and records its duration.
   *
   * @param startTime - Start time from startCycle()
   * @param trace - Trace node from startCycle()
   */
  endCycle(startTime: number, trace: Trace): void {
    const endTime = globalThis.performance.now()
    const durationMs = endTime - startTime

    trace.endTime = endTime
    trace.durationMs = durationMs

    this._eventLoopMetrics.cycleCount++
    this._eventLoopMetrics.totalDurationMs += durationMs
    this._eventLoopMetrics.cycleDurationsMs.push(durationMs)

    // Emit to OTel in real-time
    this._otelInstruments?.eventLoopCycleDuration.record(durationMs)
  }

  /**
   * Records a model invocation with its latency and token usage.
   *
   * @param latency - Latency in milliseconds
   * @param usage - Token usage statistics
   * @param timeToFirstByte - Optional time to first byte in milliseconds
   */
  recordModelInvocation(latency: number, usage: Usage, timeToFirstByte?: number): void {
    // Store per-invocation metrics
    const invocation: ModelInvocationMetrics = {
      latencyMs: latency,
      usage: { ...usage },
    }
    if (timeToFirstByte !== undefined) {
      invocation.timeToFirstByteMs = timeToFirstByte
    }
    this._modelMetrics.invocations.push(invocation)

    // Update aggregated metrics
    this._modelMetrics.invocationCount++
    this._modelMetrics.totalLatencyMs += latency
    this._modelMetrics.aggregatedUsage.inputTokens += usage.inputTokens
    this._modelMetrics.aggregatedUsage.outputTokens += usage.outputTokens
    this._modelMetrics.aggregatedUsage.totalTokens += usage.totalTokens

    if (usage.cacheReadInputTokens) {
      this._modelMetrics.aggregatedUsage.cacheReadInputTokens =
        (this._modelMetrics.aggregatedUsage.cacheReadInputTokens || 0) + usage.cacheReadInputTokens
    }
    if (usage.cacheWriteInputTokens) {
      this._modelMetrics.aggregatedUsage.cacheWriteInputTokens =
        (this._modelMetrics.aggregatedUsage.cacheWriteInputTokens || 0) + usage.cacheWriteInputTokens
    }

    // Emit to OTel in real-time
    if (this._otelInstruments) {
      this._otelInstruments.modelInvocationCount.add(1)
      this._otelInstruments.modelLatency.record(latency)
      this._otelInstruments.modelInputTokens.record(usage.inputTokens)
      this._otelInstruments.modelOutputTokens.record(usage.outputTokens)
      if (usage.cacheReadInputTokens) {
        this._otelInstruments.modelCacheReadTokens.record(usage.cacheReadInputTokens)
      }
      if (usage.cacheWriteInputTokens) {
        this._otelInstruments.modelCacheWriteTokens.record(usage.cacheWriteInputTokens)
      }
    }
  }

  /**
   * Starts tracking a tool execution and creates a trace for it.
   *
   * @param toolName - Name of the tool being executed
   * @param parentTrace - Parent trace node (typically a cycle trace)
   * @returns Object containing start time and trace node
   */
  startToolExecution(toolName: string, parentTrace: Trace): { startTime: number; trace: Trace } {
    const startTime = globalThis.performance.now()
    const trace: Trace = {
      id: globalThis.crypto.randomUUID(),
      name: toolName,
      startTime,
      parentId: parentTrace.id,
      children: [],
      metadata: { toolName },
    }
    parentTrace.children.push(trace)
    return { startTime, trace }
  }

  /**
   * Ends tool execution and records its duration and success status.
   *
   * @param toolName - Name of the tool that was executed
   * @param startTime - Start time from startToolExecution()
   * @param success - Whether the tool execution succeeded
   * @param trace - Trace node from startToolExecution()
   */
  endToolExecution(toolName: string, startTime: number, success: boolean, trace: Trace): void {
    const endTime = globalThis.performance.now()
    const durationMs = endTime - startTime

    trace.endTime = endTime
    trace.durationMs = durationMs
    trace.metadata = { ...trace.metadata, success }

    // Initialize or update tool metrics
    if (!this._toolMetrics[toolName]) {
      this._toolMetrics[toolName] = {
        callCount: 0,
        successCount: 0,
        errorCount: 0,
        totalDurationMs: 0,
        averageDurationMs: 0,
      }
    }

    const toolMetric = this._toolMetrics[toolName]
    toolMetric.callCount++
    toolMetric.totalDurationMs += durationMs
    toolMetric.averageDurationMs = toolMetric.totalDurationMs / toolMetric.callCount

    if (success) {
      toolMetric.successCount++
    } else {
      toolMetric.errorCount++
    }

    // Emit to OTel in real-time
    if (this._otelInstruments) {
      const attributes = { tool_name: toolName }
      this._otelInstruments.toolCallCount.add(1, attributes)
      this._otelInstruments.toolDuration.record(durationMs, attributes)
      if (success) {
        this._otelInstruments.toolSuccessCount.add(1, attributes)
      } else {
        this._otelInstruments.toolErrorCount.add(1, attributes)
      }
    }
  }

  /**
   * Returns a deep copy of all collected metrics.
   *
   * @returns Complete metrics snapshot
   */
  getMetrics(): Metrics {
    return {
      eventLoop: {
        cycleCount: this._eventLoopMetrics.cycleCount,
        totalDurationMs: this._eventLoopMetrics.totalDurationMs,
        cycleDurationsMs: [...this._eventLoopMetrics.cycleDurationsMs],
      },
      model: {
        invocationCount: this._modelMetrics.invocationCount,
        totalLatencyMs: this._modelMetrics.totalLatencyMs,
        aggregatedUsage: { ...this._modelMetrics.aggregatedUsage },
        invocations: this._modelMetrics.invocations.map((inv) => {
          const invCopy: ModelInvocationMetrics = {
            latencyMs: inv.latencyMs,
            usage: { ...inv.usage },
          }
          if (inv.timeToFirstByteMs !== undefined) {
            invCopy.timeToFirstByteMs = inv.timeToFirstByteMs
          }
          return invCopy
        }),
      },
      tools: Object.keys(this._toolMetrics).reduce(
        (acc, toolName) => {
          const tm = this._toolMetrics[toolName]
          if (tm) {
            acc[toolName] = {
              callCount: tm.callCount,
              successCount: tm.successCount,
              errorCount: tm.errorCount,
              totalDurationMs: tm.totalDurationMs,
              averageDurationMs: tm.averageDurationMs,
            }
          }
          return acc
        },
        {} as ToolMetrics
      ),
      traces: this._traces.map((t) => this._cloneTrace(t)),
    }
  }

  /**
   * Creates a deep copy of a trace node and its children.
   *
   * @param trace - Trace node to clone
   * @returns Deep copy of the trace
   */
  private _cloneTrace(trace: Trace): Trace {
    const cloned: Trace = {
      id: trace.id,
      name: trace.name,
      startTime: trace.startTime,
      children: trace.children.map((c) => this._cloneTrace(c)),
    }
    if (trace.endTime !== undefined) {
      cloned.endTime = trace.endTime
    }
    if (trace.durationMs !== undefined) {
      cloned.durationMs = trace.durationMs
    }
    if (trace.parentId !== undefined) {
      cloned.parentId = trace.parentId
    }
    if (trace.metadata !== undefined) {
      cloned.metadata = { ...trace.metadata }
    }
    return cloned
  }
}
