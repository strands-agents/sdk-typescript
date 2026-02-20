import type { ContentBlock } from '../types/messages.js'

/**
 * Base state class shared across multi-agent patterns.
 */
export class MultiAgentState {}

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
 * Result of executing a single node.
 */
export class NodeResult {
  readonly type = 'nodeResult' as const
  readonly nodeId: string
  readonly status: Status
  readonly duration: number
  readonly content: ContentBlock[]
  readonly error?: Error

  constructor(data: { nodeId: string; status: Status; duration: number; content?: ContentBlock[]; error?: Error }) {
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
