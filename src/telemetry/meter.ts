/**
 * Agent loop metrics tracking.
 *
 * Provides local metrics accumulation for cycle counts, token usage,
 * tool execution stats, and model latency.
 */

import type { Usage, Metrics, ModelMetadataEventData } from '../models/streaming.js'
import type { ToolUse } from '../tools/types.js'

/**
 * Creates an empty Usage object with all counters set to zero.
 *
 * @returns A Usage object with zeroed counters
 */
function createEmptyUsage(): Usage {
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
function accumulateUsage(target: Usage, source: Usage): void {
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
   * Total execution time in seconds.
   */
  totalTime: number
}

/**
 * Per-tool summary with computed statistics.
 */
export interface ToolUsageSummary extends ToolMetricsData {
  /**
   * Average execution time per call in seconds.
   */
  averageTime: number

  /**
   * Ratio of successful calls to total calls.
   */
  successRate: number
}

/**
 * Per-cycle usage tracking.
 */
export interface AgentLoopMetric {
  /**
   * Unique identifier for this cycle.
   */
  agentLoopCycleId: string

  /**
   * Token usage for this cycle.
   */
  usage: Usage
}

/**
 * Per-invocation metrics tracking.
 */
export interface AgentInvocation {
  /**
   * Cycle metrics for this invocation.
   */
  cycles: AgentLoopMetric[]

  /**
   * Accumulated token usage for this invocation.
   */
  usage: Usage
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
 * Summary of all collected metrics.
 */
export interface AgentLoopMetricsSummary {
  /**
   * Total number of agent loop cycles.
   */
  totalCycles: number

  /**
   * Total duration of all cycles in seconds.
   */
  totalDuration: number

  /**
   * Average cycle time in seconds.
   */
  averageCycleTime: number

  /**
   * Per-tool execution statistics.
   */
  toolUsage: Record<string, ToolUsageSummary>

  /**
   * Accumulated token usage across all invocations.
   */
  accumulatedUsage: Usage

  /**
   * Accumulated model latency metrics across all invocations.
   */
  accumulatedMetrics: Metrics

  /**
   * Per-invocation metrics.
   */
  agentInvocations: AgentInvocation[]
}

/**
 * Aggregated metrics for an agent's loop execution.
 *
 * Tracks cycle counts, tool usage, execution durations, and token consumption
 * across all model invocations.
 *
 * @example
 * ```typescript
 * const result = await agent.invoke('Hello')
 * console.log(result.metrics.cycleCount)
 * console.log(result.metrics.accumulatedUsage)
 * console.log(result.metrics.toolMetrics)
 * console.log(result.metrics.getSummary())
 * ```
 */
export class AgentMetrics {
  /**
   * Number of agent loop cycles executed.
   */
  private _cycleCount: number = 0

  /**
   * Per-tool execution metrics keyed by tool name.
   */
  readonly toolMetrics: Record<string, ToolMetricsData> = {}

  /**
   * Duration of each cycle in seconds.
   */
  readonly cycleDurations: number[] = []

  /**
   * Per-invocation metrics.
   */
  readonly agentInvocations: AgentInvocation[] = []

  /**
   * Accumulated token usage across all model invocations.
   */
  readonly accumulatedUsage: Usage = createEmptyUsage()

  /**
   * Accumulated performance metrics across all model invocations.
   */
  readonly accumulatedMetrics: Metrics = { latencyMs: 0 }

  /**
   * Number of agent loop cycles executed.
   */
  get cycleCount(): number {
    return this._cycleCount
  }

  /**
   * The most recent agent invocation, or undefined if none exist.
   */
  get latestAgentInvocation(): AgentInvocation | undefined {
    return this.agentInvocations.length > 0 ? this.agentInvocations[this.agentInvocations.length - 1] : undefined
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

    const latestInvocation = this.latestAgentInvocation
    if (latestInvocation) {
      latestInvocation.cycles.push({
        agentLoopCycleId: cycleId,
        usage: createEmptyUsage(),
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
    const endTime = Date.now()
    const duration = endTime - startTime

    this.cycleDurations.push(duration)
  }

  /**
   * Record metrics for a tool invocation.
   *
   * @param options - Tool usage recording options
   */
  addToolUsage(options: ToolUsageOptions): void {
    const { tool, duration, success } = options
    const toolName = tool.name

    // Update local tool metrics
    if (!this.toolMetrics[toolName]) {
      this.toolMetrics[toolName] = { callCount: 0, successCount: 0, errorCount: 0, totalTime: 0 }
    }

    const toolEntry = this.toolMetrics[toolName]!
    toolEntry.callCount++
    toolEntry.totalTime += duration

    if (success) {
      toolEntry.successCount++
    } else {
      toolEntry.errorCount++
    }
  }

  /**
   * Update the accumulated token usage with new usage data.
   *
   * @param usage - The usage data to accumulate
   */
  updateUsage(usage: Usage): void {
    accumulateUsage(this.accumulatedUsage, usage)

    const latestInvocation = this.latestAgentInvocation
    if (latestInvocation) {
      accumulateUsage(latestInvocation.usage, usage)

      const cycles = latestInvocation.cycles
      if (cycles.length > 0) {
        accumulateUsage(cycles[cycles.length - 1]!.usage, usage)
      }
    }
  }

  /**
   * Update accumulated usage and metrics from a model metadata event.
   *
   * @param metadata - The metadata event from a model invocation
   */
  updateFromMetadata(metadata: ModelMetadataEventData): void {
    if (metadata.usage) {
      this.updateUsage(metadata.usage)
    }
    if (metadata.metrics) {
      this.accumulatedMetrics.latencyMs += metadata.metrics.latencyMs
    }
  }

  /**
   * Begin tracking a new agent invocation.
   * Creates a new AgentInvocation entry for per-invocation metrics.
   */
  startNewInvocation(): void {
    this.agentInvocations.push({
      cycles: [],
      usage: createEmptyUsage(),
    })
  }

  /**
   * Generate a comprehensive summary of all collected metrics.
   *
   * @returns A dictionary containing summarized metrics data
   */
  getSummary(): AgentLoopMetricsSummary {
    const totalDuration = this.cycleDurations.reduce((sum, d) => sum + d, 0)

    const toolUsage: AgentLoopMetricsSummary['toolUsage'] = {}
    for (const [toolName, toolEntry] of Object.entries(this.toolMetrics)) {
      toolUsage[toolName] = {
        ...toolEntry,
        averageTime: toolEntry.callCount > 0 ? toolEntry.totalTime / toolEntry.callCount : 0,
        successRate: toolEntry.callCount > 0 ? toolEntry.successCount / toolEntry.callCount : 0,
      }
    }

    return {
      totalCycles: this._cycleCount,
      totalDuration,
      averageCycleTime: this._cycleCount > 0 ? totalDuration / this._cycleCount : 0,
      toolUsage,
      accumulatedUsage: this.accumulatedUsage,
      accumulatedMetrics: this.accumulatedMetrics,
      agentInvocations: this.agentInvocations,
    }
  }
}
