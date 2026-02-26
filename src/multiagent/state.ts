import type { ContentBlock } from '../types/messages.js'

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

  constructor(data: {
    nodeId: string
    status: ResultStatus
    duration: number
    content?: ContentBlock[]
    error?: Error
  }) {
    this.nodeId = data.nodeId
    this.status = data.status
    this.duration = data.duration
    this.content = data.content ?? []
    if (data.error) this.error = data.error
  }
}

/**
 * Partial result returned by {@link Node.handle} implementations.
 *
 * Contains implementer-controlled fields that are merged with
 * framework-managed defaults (nodeId, status, duration) to
 * produce the final {@link NodeResult}.
 */
export type NodeResultUpdate = Partial<Omit<NodeResult, 'type'>>

/**
 * Execution state of a single node within a multi-agent orchestration.
 */
export class NodeState {
  readonly type = 'nodeState' as const
  status: Status
  /** Marks this node as the last one executed in an execution path. */
  terminus: boolean
  readonly results: NodeResult[]

  constructor() {
    this.status = Status.PENDING
    this.terminus = false
    this.results = []
  }

  /** Content from the most recent result, or empty array if none. */
  get content(): readonly ContentBlock[] {
    const last = this.results[this.results.length - 1]
    return last?.content ?? []
  }
}

/**
 * Aggregate result from a multi-agent execution.
 */
export class MultiAgentResult {
  readonly type = 'multiAgentResult' as const
  readonly status: ResultStatus
  readonly results: NodeResult[]
  /** Combined content from all terminal nodes, in completion order. */
  readonly content: ContentBlock[]
  readonly duration: number
  readonly error?: Error

  constructor(data: {
    status?: ResultStatus
    results: NodeResult[]
    content: ContentBlock[]
    duration: number
    error?: Error
  }) {
    this.status = data.status ?? this._resolveStatus(data.results)
    this.results = data.results
    this.content = data.content
    this.duration = data.duration
    if (data.error) this.error = data.error
  }

  /** Derives the aggregate status from individual node results. */
  private _resolveStatus(results: NodeResult[]): ResultStatus {
    if (results.some((r) => r.status === Status.FAILED)) return Status.FAILED
    if (results.some((r) => r.status === Status.CANCELLED)) return Status.CANCELLED
    return Status.COMPLETED
  }
}

/**
 * Shared state for multi-agent orchestration patterns.
 *
 * Provides per-node state tracking via a `nodes` map.
 */
export class MultiAgentState {
  /** Execution start time in milliseconds since epoch. */
  readonly startTime: number
  /** Number of node executions started so far. */
  steps: number
  /** All node results in completion order. */
  readonly results: NodeResult[]
  private readonly _nodes: Map<string, NodeState>

  constructor(data?: { nodeIds?: string[] }) {
    this.startTime = Date.now()
    this.steps = 0
    this.results = []
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
}
