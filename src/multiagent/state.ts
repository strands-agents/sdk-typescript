import { StateStore } from '../state-store.js'
import { type ContentBlock, contentBlockFromData } from '../types/messages.js'
import type { Usage } from '../models/streaming.js'
import { accumulateUsage, createEmptyUsage } from '../models/streaming.js'
import type { z } from 'zod'
import type { JSONValue } from '../types/json.js'
import { normalizeError } from '../errors.js'
import { loadStateFromJSONSymbol, stateToJSONSymbol, type StateSerializable } from '../types/serializable.js'

/**
 * Execution lifecycle status shared across all multi-agent patterns.
 */
export const Status = {
  /** Execution has not yet started. */
  PENDING: 'PENDING',
  /** Execution is currently in progress. */
  EXECUTING: 'EXECUTING',
  /** Execution finished successfully. */
  COMPLETED: 'COMPLETED',
  /** Execution encountered an error. */
  FAILED: 'FAILED',
  /** Execution was cancelled before or during processing. */
  CANCELLED: 'CANCELLED',
} as const

/**
 * Union of all valid status values.
 */
export type Status = (typeof Status)[keyof typeof Status]

/**
 * Subset of {@link Status} representing terminal outcomes.
 */
export type ResultStatus = typeof Status.COMPLETED | typeof Status.FAILED | typeof Status.CANCELLED

/**
 * Result of executing a single node.
 */
export class NodeResult {
  readonly type = 'nodeResult' as const
  readonly nodeId: string
  readonly status: ResultStatus
  /** Execution time in milliseconds. */
  readonly duration: number
  readonly content: ContentBlock[]
  readonly error?: Error
  /** Validated structured output, if a schema was provided. */
  readonly structuredOutput?: z.output<z.ZodType>
  /** Token usage from the node execution. */
  readonly usage?: Usage

  constructor(data: {
    nodeId: string
    status: ResultStatus
    duration: number
    content?: ContentBlock[]
    error?: Error
    structuredOutput?: z.output<z.ZodType>
    usage?: Usage
  }) {
    this.nodeId = data.nodeId
    this.status = data.status
    this.duration = data.duration
    this.content = data.content ?? []
    if ('error' in data) this.error = data.error
    if ('structuredOutput' in data) this.structuredOutput = data.structuredOutput
    if ('usage' in data) this.usage = data.usage
  }

  /** Serializes this result to a JSON-compatible value. */
  toJSON(): JSONValue {
    return {
      nodeId: this.nodeId,
      status: this.status,
      duration: this.duration,
      content: this.content.map((block) => block.toJSON()),
      ...(this.error && { error: this.error.message }),
      ...(this.structuredOutput !== undefined && { structuredOutput: this.structuredOutput as JSONValue }),
      ...(this.usage && { usage: { ...this.usage } }),
    } as JSONValue
  }

  /** Creates a NodeResult from a previously serialized JSON value. */
  static fromJSON(data: JSONValue): NodeResult {
    const json = data as Record<string, JSONValue>
    return new NodeResult({
      nodeId: json.nodeId as string,
      status: json.status as ResultStatus,
      duration: json.duration as number,
      content: (json.content as JSONValue[]).map((c) => contentBlockFromData(c as never)),
      ...(json.error && { error: normalizeError(json.error) }),
      ...(json.structuredOutput !== undefined && { structuredOutput: json.structuredOutput }),
      ...(json.usage && { usage: json.usage as unknown as Usage }),
    })
  }
}

/**
 * Partial result returned by {@link Node.handle} implementations.
 *
 * Contains implementer-controlled fields that are merged with
 * framework-managed defaults (nodeId, status, duration, content) to
 * produce the final {@link NodeResult}.
 */
export type NodeResultUpdate = Partial<Omit<NodeResult, 'type'>>

/**
 * Execution state of a single node within a multi-agent orchestration.
 */
export class NodeState implements StateSerializable {
  readonly type = 'nodeState' as const
  status: Status
  /** Whether this node is a terminal node — one where an execution path ended. */
  terminus: boolean
  /** Node execution start time in milliseconds since epoch. */
  startTime: number
  readonly results: NodeResult[]

  constructor() {
    this.status = Status.PENDING
    this.terminus = false
    this.startTime = Date.now()
    this.results = []
  }

  /** Content from the most recent result, or empty array if none. */
  get content(): readonly ContentBlock[] {
    const last = this.results[this.results.length - 1]
    return last?.content ?? []
  }

  /** Returns the serialized state as a JSON value. */
  [stateToJSONSymbol](): JSONValue {
    return {
      status: this.status,
      terminus: this.terminus,
      startTime: this.startTime,
      results: this.results.map((res) => res.toJSON()),
    } as JSONValue
  }

  /** Loads state from a previously serialized JSON value. */
  [loadStateFromJSONSymbol](json: JSONValue): void {
    const data = json as Record<string, JSONValue>
    this.status = data.status as Status
    this.terminus = data.terminus as boolean
    this.startTime = data.startTime as number
    this.results.length = 0
    for (const entry of data.results as JSONValue[]) {
      this.results.push(NodeResult.fromJSON(entry))
    }
  }
}

/**
 * Aggregate result from a multi-agent execution.
 */
export class MultiAgentResult {
  readonly type = 'multiAgentResult' as const
  readonly status: ResultStatus
  readonly results: NodeResult[]
  /** Combined content from terminus nodes, in completion order. */
  readonly content: ContentBlock[]
  readonly duration: number
  readonly error?: Error
  /** Aggregated token usage across all node results. */
  readonly usage: Usage

  constructor(data: {
    status?: ResultStatus
    results: NodeResult[]
    content?: ContentBlock[]
    duration: number
    error?: Error
  }) {
    this.status = data.status ?? this._resolveStatus(data.results)
    this.results = data.results
    this.content = data.content ?? []
    this.duration = data.duration
    if ('error' in data) this.error = data.error
    this.usage = this._aggregateNodeUsage(data.results)
  }

  /** Serializes this result to a JSON-compatible value. */
  toJSON(): JSONValue {
    return {
      status: this.status,
      results: this.results.map((result) => result.toJSON()),
      content: this.content.map((block) => block.toJSON()),
      duration: this.duration,
      ...(this.error && { error: this.error.message }),
    } as JSONValue
  }

  /** Creates a MultiAgentResult from a previously serialized JSON value. */
  static fromJSON(data: JSONValue): MultiAgentResult {
    const json = data as Record<string, JSONValue>
    return new MultiAgentResult({
      status: json.status as ResultStatus,
      results: (json.results as JSONValue[]).map(NodeResult.fromJSON),
      content: (json.content as JSONValue[]).map((c) => contentBlockFromData(c as never)),
      duration: json.duration as number,
      ...(json.error && { error: normalizeError(json.error) }),
    })
  }

  /** Derives the aggregate status from individual node results. */
  private _resolveStatus(results: NodeResult[]): ResultStatus {
    if (results.some((result) => result.status === Status.FAILED)) return Status.FAILED
    if (results.some((result) => result.status === Status.CANCELLED)) return Status.CANCELLED
    return Status.COMPLETED
  }

  /** Sums token usage across all node results. */
  private _aggregateNodeUsage(results: NodeResult[]): Usage {
    const usage = createEmptyUsage()
    for (const result of results) {
      if (!result.usage) continue
      accumulateUsage(usage, result.usage)
    }
    return usage
  }
}

/**
 * Per-execution state for multi-agent orchestration, created fresh each invocation.
 */
export class MultiAgentState implements StateSerializable {
  /** Execution start time in milliseconds since epoch. */
  readonly startTime: number
  /** Number of node executions started so far. */
  steps: number
  /** All node results in completion order. */
  readonly results: NodeResult[]
  /** App-level key-value state accessible from hooks, edge handlers, and custom nodes. */
  readonly app: StateStore
  private readonly _nodes: Map<string, NodeState>

  constructor(data?: { nodeIds?: string[] }) {
    this.startTime = Date.now()
    this.steps = 0
    this.results = []
    this.app = new StateStore()
    this._nodes = new Map()
    for (const id of data?.nodeIds ?? []) {
      this._nodes.set(id, new NodeState())
    }
  }

  /**
   * Get the state of a specific node by ID.
   *
   * @param id - The node identifier
   * @returns The node's state, or undefined if the node is not tracked
   */
  node(id: string): NodeState | undefined {
    return this._nodes.get(id)
  }

  /**
   * All tracked node states.
   */
  get nodes(): ReadonlyMap<string, NodeState> {
    return this._nodes
  }

  /** Returns the serialized state as a JSON value. */
  [stateToJSONSymbol](): JSONValue {
    const nodes: Record<string, JSONValue> = {}
    for (const [id, nodeState] of this._nodes) {
      nodes[id] = nodeState[stateToJSONSymbol]()
    }
    return {
      startTime: this.startTime,
      steps: this.steps,
      results: this.results.map((result) => result.toJSON()),
      app: this.app[stateToJSONSymbol](),
      nodes,
    } as JSONValue
  }

  /** Loads state from a previously serialized JSON value. */
  [loadStateFromJSONSymbol](json: JSONValue): void {
    const data = json as Record<string, JSONValue>
    // Bypass readonly for deserialization — startTime is set once at construction
    // and must be restored to the original value from the snapshot.
    ;(this as { startTime: number }).startTime = data.startTime as number
    this.steps = data.steps as number
    this.results.length = 0
    for (const entry of data.results as JSONValue[]) {
      this.results.push(NodeResult.fromJSON(entry))
    }
    this.app[loadStateFromJSONSymbol](data.app as JSONValue)
    this._nodes.clear()
    const nodes = data.nodes as Record<string, JSONValue> | undefined
    if (nodes) {
      for (const [id, nodeData] of Object.entries(nodes)) {
        const nodeState = new NodeState()
        nodeState[loadStateFromJSONSymbol](nodeData)
        this._nodes.set(id, nodeState)
      }
    }
  }
}
