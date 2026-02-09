/**
 * Multi-agent base infrastructure.
 *
 * Provides the foundational types and abstract class for multi-agent patterns (Swarm, Graph).
 * Includes execution status tracking, node results, and accumulated metrics.
 */

import { Interrupt } from '../interrupt.js'
import type { Metrics, Usage } from '../models/streaming.js'
import type { AgentResultMetrics } from '../types/agent.js'
import { AgentResult } from '../types/agent.js'
import type { ContentBlockData, StopReason } from '../types/messages.js'
import { Message, contentBlockFromData } from '../types/messages.js'
import type { MultiAgentInput, MultiAgentInvokeOptions, MultiAgentStreamEvent } from './types.js'

/**
 * Execution status for multi-agent orchestration and individual nodes.
 */
export enum Status {
  PENDING = 'pending',
  EXECUTING = 'executing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  INTERRUPTED = 'interrupted',
}

/**
 * Serialized agent result for session persistence.
 */
interface SerializedAgentResult {
  type: 'agentResult'
  stopReason: StopReason
  lastMessage: Record<string, unknown>
  metrics: AgentResultMetrics | undefined
  interrupts: Array<{ id: string; name: string; reason: unknown; response: unknown }>
}

/**
 * Serialized node result for session persistence.
 */
interface SerializedNodeResult {
  result: SerializedAgentResult | SerializedMultiAgentResult | { type: 'exception'; message: string }
  executionTime: number
  status: string
  accumulatedUsage: Usage
  accumulatedMetrics: Metrics
  executionCount: number
  interrupts: Array<{ id: string; name: string; reason: unknown; response: unknown }>
}

/**
 * Serialized multi-agent result for session persistence.
 */
interface SerializedMultiAgentResult {
  type: 'multiAgentResult'
  status: string
  results: Record<string, SerializedNodeResult>
  accumulatedUsage: Usage
  accumulatedMetrics: Metrics
  executionCount: number
  executionTime: number
  interrupts: Array<{ id: string; name: string; reason: unknown; response: unknown }>
}

/**
 * Creates a default Usage object with zero values.
 *
 * @returns Fresh Usage instance
 */
function createDefaultUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}

/**
 * Creates a default Metrics object with zero values.
 *
 * @returns Fresh Metrics instance
 */
function createDefaultMetrics(): Metrics {
  return { latencyMs: 0 }
}

/**
 * Unified result from node execution.
 * Handles both Agent results, nested MultiAgentResult, and Errors.
 */
export class NodeResult {
  /**
   * Core result data — an AgentResult, nested MultiAgentResult, or Error.
   */
  readonly result: AgentResult | MultiAgentResult | Error

  /**
   * Execution time in milliseconds.
   */
  readonly executionTime: number

  /**
   * Current execution status of this node.
   */
  readonly status: Status

  /**
   * Accumulated token usage from this node and all children.
   */
  readonly accumulatedUsage: Usage

  /**
   * Accumulated performance metrics from this node and all children.
   */
  readonly accumulatedMetrics: Metrics

  /**
   * Number of times this node has been executed.
   */
  readonly executionCount: number

  /**
   * Interrupts that occurred during node execution.
   */
  readonly interrupts: Interrupt[]

  constructor(data: {
    result: AgentResult | MultiAgentResult | Error
    executionTime?: number
    status?: Status
    accumulatedUsage?: Usage
    accumulatedMetrics?: Metrics
    executionCount?: number
    interrupts?: Interrupt[]
  }) {
    this.result = data.result
    this.executionTime = data.executionTime ?? 0
    this.status = data.status ?? Status.PENDING
    this.accumulatedUsage = data.accumulatedUsage ?? createDefaultUsage()
    this.accumulatedMetrics = data.accumulatedMetrics ?? createDefaultMetrics()
    this.executionCount = data.executionCount ?? 0
    this.interrupts = data.interrupts ?? []
  }

  /**
   * Get all AgentResult objects from this node, flattened if nested.
   *
   * @returns Array of AgentResult instances
   */
  getAgentResults(): AgentResult[] {
    if (this.result instanceof Error) {
      return []
    }

    if (this.result instanceof MultiAgentResult) {
      const flattened: AgentResult[] = []
      for (const nestedNodeResult of Object.values(this.result.results)) {
        flattened.push(...nestedNodeResult.getAgentResults())
      }
      return flattened
    }

    // AgentResult — identified by having `type === 'agentResult'`
    return [this.result]
  }

  /**
   * Convert to a JSON-serializable object for session persistence.
   *
   * @returns Serialized representation
   */
  toDict(): SerializedNodeResult {
    let resultData: SerializedNodeResult['result']

    if (this.result instanceof Error) {
      resultData = { type: 'exception', message: this.result.message }
    } else if (this.result instanceof MultiAgentResult) {
      resultData = this.result.toDict()
    } else {
      // AgentResult
      resultData = serializeAgentResult(this.result)
    }

    return {
      result: resultData,
      executionTime: this.executionTime,
      status: this.status,
      accumulatedUsage: { ...this.accumulatedUsage },
      accumulatedMetrics: { ...this.accumulatedMetrics },
      executionCount: this.executionCount,
      interrupts: this.interrupts.map((i) => i.toDict()),
    }
  }

  /**
   * Rehydrate a NodeResult from persisted JSON.
   *
   * @param data - Serialized node result data
   * @returns New NodeResult instance
   */
  static fromDict(data: SerializedNodeResult): NodeResult {
    let result: AgentResult | MultiAgentResult | Error
    const raw = data.result

    if (raw.type === 'exception') {
      result = new Error((raw as { type: 'exception'; message: string }).message)
    } else if (raw.type === 'multiAgentResult') {
      result = MultiAgentResult.fromDict(raw as SerializedMultiAgentResult)
    } else if (raw.type === 'agentResult') {
      result = deserializeAgentResult(raw as SerializedAgentResult)
    } else {
      throw new TypeError(`NodeResult.fromDict: unsupported result type: ${(raw as Record<string, unknown>).type}`)
    }

    const interrupts = (data.interrupts ?? []).map((d) => Interrupt.fromDict(d))

    return new NodeResult({
      result,
      executionTime: data.executionTime ?? 0,
      status: (data.status as Status) ?? Status.PENDING,
      accumulatedUsage: data.accumulatedUsage ?? createDefaultUsage(),
      accumulatedMetrics: data.accumulatedMetrics ?? createDefaultMetrics(),
      executionCount: data.executionCount ?? 0,
      interrupts,
    })
  }
}

/**
 * Result from multi-agent execution with accumulated metrics.
 */
export class MultiAgentResult {
  /**
   * Overall execution status of the multi-agent orchestration.
   */
  readonly status: Status

  /**
   * Results from each node, keyed by node ID.
   */
  readonly results: Record<string, NodeResult>

  /**
   * Accumulated token usage across all nodes.
   */
  readonly accumulatedUsage: Usage

  /**
   * Accumulated performance metrics across all nodes.
   */
  readonly accumulatedMetrics: Metrics

  /**
   * Total number of node executions.
   */
  readonly executionCount: number

  /**
   * Total execution time in milliseconds.
   */
  readonly executionTime: number

  /**
   * Interrupts that occurred during multi-agent execution.
   */
  readonly interrupts: Interrupt[]

  constructor(data?: {
    status?: Status
    results?: Record<string, NodeResult>
    accumulatedUsage?: Usage
    accumulatedMetrics?: Metrics
    executionCount?: number
    executionTime?: number
    interrupts?: Interrupt[]
  }) {
    this.status = data?.status ?? Status.PENDING
    this.results = data?.results ?? {}
    this.accumulatedUsage = data?.accumulatedUsage ?? createDefaultUsage()
    this.accumulatedMetrics = data?.accumulatedMetrics ?? createDefaultMetrics()
    this.executionCount = data?.executionCount ?? 0
    this.executionTime = data?.executionTime ?? 0
    this.interrupts = data?.interrupts ?? []
  }

  /**
   * Convert to a JSON-serializable object for session persistence.
   *
   * @returns Serialized representation
   */
  toDict(): SerializedMultiAgentResult {
    return {
      type: 'multiAgentResult',
      status: this.status,
      results: Object.fromEntries(Object.entries(this.results).map(([k, v]) => [k, v.toDict()])),
      accumulatedUsage: { ...this.accumulatedUsage },
      accumulatedMetrics: { ...this.accumulatedMetrics },
      executionCount: this.executionCount,
      executionTime: this.executionTime,
      interrupts: this.interrupts.map((i) => i.toDict()),
    }
  }

  /**
   * Rehydrate a MultiAgentResult from persisted JSON.
   *
   * @param data - Serialized multi-agent result data
   * @returns New MultiAgentResult instance
   */
  static fromDict(data: SerializedMultiAgentResult): MultiAgentResult {
    if (data.type !== 'multiAgentResult') {
      throw new TypeError(`MultiAgentResult.fromDict: unexpected type ${data.type}`)
    }

    const results: Record<string, NodeResult> = {}
    for (const [nodeId, nodeData] of Object.entries(data.results ?? {})) {
      results[nodeId] = NodeResult.fromDict(nodeData)
    }

    const interrupts = (data.interrupts ?? []).map((d) => Interrupt.fromDict(d))

    return new MultiAgentResult({
      status: (data.status as Status) ?? Status.PENDING,
      results,
      accumulatedUsage: data.accumulatedUsage ?? createDefaultUsage(),
      accumulatedMetrics: data.accumulatedMetrics ?? createDefaultMetrics(),
      executionCount: data.executionCount ?? 0,
      executionTime: data.executionTime ?? 0,
      interrupts,
    })
  }
}

/**
 * Abstract base class for multi-agent orchestration patterns.
 *
 * Provides the common interface for Swarm and Graph patterns, including
 * streaming execution, state serialization, and hook integration.
 */
export abstract class MultiAgentBase {
  /**
   * Unique identifier for this multi-agent orchestrator.
   */
  abstract readonly id: string

  /**
   * Stream events during multi-agent execution.
   *
   * @param task - The task to execute
   * @param options - Optional invocation options (e.g. invocationState passed to hooks and nodes)
   * @returns Async generator yielding streaming events and returning the final result
   */
  abstract stream(
    task: MultiAgentInput,
    options?: MultiAgentInvokeOptions
  ): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult>

  /**
   * Invoke the multi-agent orchestrator and return the final result.
   *
   * Consumes the stream() generator and returns only the final MultiAgentResult.
   *
   * @param task - The task to execute
   * @param options - Optional invocation options (e.g. invocationState passed to hooks and nodes)
   * @returns The final multi-agent result
   */
  async invoke(task: MultiAgentInput, options?: MultiAgentInvokeOptions): Promise<MultiAgentResult> {
    const gen = this.stream(task, options)
    let next = await gen.next()
    while (!next.done) {
      next = await gen.next()
    }
    return next.value
  }

  /**
   * Serialize the current orchestrator state for session persistence.
   *
   * @returns JSON-serializable state snapshot
   */
  abstract serializeState(): Record<string, unknown>

  /**
   * Restore orchestrator state from a session dict.
   *
   * @param payload - Previously serialized state data
   */
  abstract deserializeState(payload: Record<string, unknown>): void
}

/**
 * Serialize an AgentResult to a JSON-compatible object.
 *
 * @param agentResult - The AgentResult to serialize
 * @returns Serialized representation
 */
function serializeAgentResult(agentResult: AgentResult): SerializedAgentResult {
  return {
    type: 'agentResult',
    stopReason: agentResult.stopReason,
    lastMessage: {
      role: agentResult.lastMessage.role,
      content: agentResult.lastMessage.content.map((block) => {
        // Serialize content blocks to plain objects
        const obj: Record<string, unknown> = { type: block.type }
        for (const [key, value] of Object.entries(block)) {
          if (key !== 'type') {
            obj[key] = value
          }
        }
        return obj
      }),
    },
    metrics: agentResult.metrics,
    interrupts: agentResult.interrupts.map((i) => i.toDict()),
  }
}

/**
 * Deserialize an AgentResult from a JSON object.
 *
 * @param data - Serialized agent result data
 * @returns Reconstructed AgentResult
 */
function deserializeAgentResult(data: SerializedAgentResult): AgentResult {
  const messageData = data.lastMessage as { role: string; content: Array<Record<string, unknown>> }
  const content = (messageData.content ?? []).map((blockData) =>
    contentBlockFromData(blockData as unknown as ContentBlockData)
  )
  const lastMessage = new Message({ role: messageData.role as 'user' | 'assistant', content })

  const interrupts = (data.interrupts ?? []).map((d) => Interrupt.fromDict(d))

  const resultData: {
    stopReason: StopReason
    lastMessage: Message
    metrics?: AgentResultMetrics
    interrupts?: Interrupt[]
  } = {
    stopReason: data.stopReason,
    lastMessage,
    interrupts,
  }

  if (data.metrics !== undefined) {
    resultData.metrics = data.metrics
  }

  return new AgentResult(resultData)
}
