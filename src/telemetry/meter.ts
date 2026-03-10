/**
 * Agent loop metrics tracking.
 *
 * The {@link Meter} accumulates local metrics during agent invocation and
 * provides them as a read-only {@link AgentMetrics} snapshot via the
 * {@link Meter.metrics} getter for inclusion in {@link AgentResult}.
 */

import type { Usage, Metrics, ModelMetadataEventData } from '../models/streaming.js'
import type { ToolUse } from '../tools/types.js'
import type { JSONSerializable } from '../types/json.js'

/**
 * Per-tool execution metrics.
 */
export interface ToolMetricsData {
  /**
   * Total number of calls to this tool.
   */
  callCount: number

  /**
   * Number of successful calls.
   */
  successCount: number

  /**
   * Number of failed calls.
   */
  errorCount: number

  /**
   * Total execution time in milliseconds.
   */
  totalTime: number
}

/**
 * Per-cycle usage tracking.
 */
export interface AgentLoopMetricsData {
  /**
   * Unique identifier for this cycle.
   */
  cycleId: string

  /**
   * Duration of this cycle in milliseconds.
   */
  duration: number

  /**
   * Token usage for this cycle.
   */
  usage: Usage
}

/**
 * Per-invocation metrics tracking.
 */
export interface InvocationMetricsData {
  /**
   * Cycle metrics for this invocation.
   */
  cycles: AgentLoopMetricsData[]

  /**
   * Accumulated token usage for this invocation.
   */
  usage: Usage
}

/**
 * JSON-serializable representation of AgentMetrics.
 */
export interface AgentMetricsData {
  /**
   * Number of agent loop cycles executed.
   */
  cycleCount: number

  /**
   * Per-tool execution metrics keyed by tool name.
   */
  toolMetrics: Record<string, ToolMetricsData>

  /**
   * Per-invocation metrics.
   */
  agentInvocations: InvocationMetricsData[]

  /**
   * Accumulated token usage across all model invocations.
   */
  accumulatedUsage: Usage

  /**
   * Accumulated performance metrics across all model invocations.
   */
  accumulatedMetrics: Metrics
}

/**
 * Options for recording tool usage.
 */
interface ToolUsageOptions {
  /**
   * The tool that was used.
   */
  tool: ToolUse

  /**
   * Execution duration in milliseconds.
   */
  duration: number

  /**
   * Whether the tool call succeeded.
   */
  success: boolean
}

/**
 * Read-only snapshot of aggregated agent metrics.
 *
 * Returned by {@link Meter.metrics} and stored on {@link AgentResult}.
 * Provides access to cycle counts, tool usage, token consumption,
 * and per-invocation breakdowns. Supports serialization via {@link toJSON}.
 *
 * @example
 * ```typescript
 * const result = await agent.invoke('Hello')
 * console.log(result.metrics.cycleCount)
 * console.log(result.metrics.accumulatedUsage)
 * console.log(result.metrics.toolMetrics)
 * console.log(JSON.stringify(result.metrics))
 * ```
 */
export class AgentMetrics implements JSONSerializable<AgentMetricsData> {
  /**
   * Number of agent loop cycles executed.
   */
  readonly cycleCount: number

  /**
   * Per-tool execution metrics keyed by tool name.
   */
  readonly toolMetrics: Record<string, ToolMetricsData>

  /**
   * Per-invocation metrics.
   */
  readonly agentInvocations: InvocationMetricsData[]

  /**
   * Accumulated token usage across all model invocations.
   */
  readonly accumulatedUsage: Usage

  /**
   * Accumulated performance metrics across all model invocations.
   */
  readonly accumulatedMetrics: Metrics

  constructor(data?: Partial<AgentMetricsData>) {
    this.cycleCount = data?.cycleCount ?? 0
    this.toolMetrics = data?.toolMetrics ?? {}
    this.agentInvocations = data?.agentInvocations ?? []
    this.accumulatedUsage = data?.accumulatedUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    this.accumulatedMetrics = data?.accumulatedMetrics ?? { latencyMs: 0 }
  }

  /**
   * The most recent agent invocation, or undefined if none exist.
   */
  get latestAgentInvocation(): InvocationMetricsData | undefined {
    return this.agentInvocations.length > 0 ? this.agentInvocations[this.agentInvocations.length - 1] : undefined
  }

  /**
   * Duration of each cycle in milliseconds, derived from per-cycle data.
   */
  get cycleDurations(): number[] {
    return this.agentInvocations.flatMap((inv) => inv.cycles.map((c) => c.duration))
  }

  /**
   * Total duration of all cycles in milliseconds.
   */
  get totalDuration(): number {
    return this.cycleDurations.reduce((sum, d) => sum + d, 0)
  }

  /**
   * Average cycle time in milliseconds.
   */
  get averageCycleTime(): number {
    return this.cycleCount > 0 ? this.totalDuration / this.cycleCount : 0
  }

  /**
   * Per-tool execution statistics with computed averages and rates.
   */
  get toolUsage(): Record<string, ToolMetricsData & { averageTime: number; successRate: number }> {
    const usage: Record<string, ToolMetricsData & { averageTime: number; successRate: number }> = {}
    for (const [toolName, toolEntry] of Object.entries(this.toolMetrics)) {
      usage[toolName] = {
        ...toolEntry,
        averageTime: toolEntry.callCount > 0 ? toolEntry.totalTime / toolEntry.callCount : 0,
        successRate: toolEntry.callCount > 0 ? toolEntry.successCount / toolEntry.callCount : 0,
      }
    }
    return usage
  }

  /**
   * Returns a JSON-serializable representation of all collected metrics.
   * Called automatically by JSON.stringify().
   *
   * @returns A plain object suitable for round-trip serialization
   */
  toJSON(): AgentMetricsData {
    return {
      cycleCount: this.cycleCount,
      toolMetrics: this.toolMetrics,
      agentInvocations: this.agentInvocations,
      accumulatedUsage: this.accumulatedUsage,
      accumulatedMetrics: this.accumulatedMetrics,
    }
  }
}

/**
 * Accumulates local metrics during agent invocation.
 *
 * Tracks cycle counts, token usage, tool execution stats, and model latency.
 * Use the {@link metrics} getter to obtain a read-only {@link AgentMetrics}
 * snapshot for inclusion in {@link AgentResult}.
 *
 */
export class Meter {
  /**
   * Number of agent loop cycles executed.
   */
  private _cycleCount: number = 0

  /**
   * Per-tool execution metrics keyed by tool name.
   */
  private readonly _toolMetrics: Record<string, ToolMetricsData> = {}

  /**
   * Per-invocation metrics.
   */
  private readonly _agentInvocations: InvocationMetricsData[] = []

  /**
   * Accumulated token usage across all model invocations.
   */
  private readonly _accumulatedUsage: Usage = Meter._createEmptyUsage()

  /**
   * Accumulated performance metrics across all model invocations.
   */
  private readonly _accumulatedMetrics: Metrics = { latencyMs: 0 }

  /**
   * Begin tracking a new agent invocation.
   * Creates a new InvocationMetricsData entry for per-invocation metrics.
   */
  startNewInvocation(): void {
    this._agentInvocations.push({
      cycles: [],
      usage: Meter._createEmptyUsage(),
    })
  }

  /**
   * Start a new agent loop cycle.
   *
   * @returns The cycle id and start time
   */
  startCycle(): { cycleId: string; startTime: number } {
    this._cycleCount++

    const cycleId = `cycle-${this._cycleCount}`
    const startTime = Date.now()

    const latestInvocation = this._latestAgentInvocation
    if (latestInvocation) {
      latestInvocation.cycles.push({
        cycleId: cycleId,
        duration: 0,
        usage: Meter._createEmptyUsage(),
      })
    }

    return { cycleId, startTime }
  }

  /**
   * End the current agent loop cycle and record its duration.
   *
   * @param startTime - The timestamp when the cycle started (milliseconds since epoch)
   */
  endCycle(startTime: number): void {
    const latestInvocation = this._latestAgentInvocation
    if (latestInvocation) {
      const cycles = latestInvocation.cycles
      if (cycles.length > 0) {
        cycles[cycles.length - 1]!.duration = Date.now() - startTime
      }
    }
  }

  /**
   * Record metrics for a completed tool invocation.
   *
   * @param options - Tool usage recording options
   */
  endToolCall(options: ToolUsageOptions): void {
    const { tool, duration, success } = options
    const toolName = tool.name

    if (!this._toolMetrics[toolName]) {
      this._toolMetrics[toolName] = { callCount: 0, successCount: 0, errorCount: 0, totalTime: 0 }
    }

    const toolEntry = this._toolMetrics[toolName]!
    toolEntry.callCount++
    toolEntry.totalTime += duration

    if (success) {
      toolEntry.successCount++
    } else {
      toolEntry.errorCount++
    }
  }

  /**
   * Update loop-level metrics from a model response.
   *
   * Call this after each model invocation within a cycle to
   * accumulate usage and latency.
   *
   * @param metadata - The metadata event from a model invocation, or undefined if unavailable
   */
  updateCycle(metadata?: ModelMetadataEventData): void {
    if (metadata) {
      this._updateFromMetadata(metadata)
    }
  }

  /**
   * Read-only snapshot of the accumulated metrics.
   * Returns an AgentMetrics instance suitable for inclusion in AgentResult.
   */
  get metrics(): AgentMetrics {
    return new AgentMetrics({
      cycleCount: this._cycleCount,
      toolMetrics: this._toolMetrics,
      agentInvocations: this._agentInvocations,
      accumulatedUsage: this._accumulatedUsage,
      accumulatedMetrics: this._accumulatedMetrics,
    })
  }

  /**
   * The most recent agent invocation, or undefined if none exist.
   */
  private get _latestAgentInvocation(): InvocationMetricsData | undefined {
    return this._agentInvocations.length > 0 ? this._agentInvocations[this._agentInvocations.length - 1] : undefined
  }

  /**
   * Update accumulated usage and metrics from a model metadata event.
   *
   * @param metadata - The metadata event from a model invocation
   */
  private _updateFromMetadata(metadata: ModelMetadataEventData): void {
    if (metadata.usage) {
      this._updateUsage(metadata.usage)
    }
    if (metadata.metrics) {
      this._accumulatedMetrics.latencyMs += metadata.metrics.latencyMs
    }
  }

  /**
   * Update the accumulated token usage with new usage data.
   *
   * @param usage - The usage data to accumulate
   */
  private _updateUsage(usage: Usage): void {
    Meter._accumulateUsage(this._accumulatedUsage, usage)

    const latestInvocation = this._latestAgentInvocation
    if (latestInvocation) {
      Meter._accumulateUsage(latestInvocation.usage, usage)

      const cycles = latestInvocation.cycles
      if (cycles.length > 0) {
        Meter._accumulateUsage(cycles[cycles.length - 1]!.usage, usage)
      }
    }
  }

  /**
   * Creates an empty Usage object with all counters set to zero.
   *
   * @returns A Usage object with zeroed counters
   */
  private static _createEmptyUsage(): Usage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    }
  }

  /**
   * Accumulates token usage from a source into a target Usage object.
   *
   * @param target - The Usage object to accumulate into (mutated in place)
   * @param source - The Usage object to accumulate from
   */
  private static _accumulateUsage(target: Usage, source: Usage): void {
    target.inputTokens += source.inputTokens
    target.outputTokens += source.outputTokens
    target.totalTokens += source.totalTokens
    if (source.cacheReadInputTokens !== undefined) {
      target.cacheReadInputTokens = (target.cacheReadInputTokens ?? 0) + source.cacheReadInputTokens
    }
    if (source.cacheWriteInputTokens !== undefined) {
      target.cacheWriteInputTokens = (target.cacheWriteInputTokens ?? 0) + source.cacheWriteInputTokens
    }
  }
}
