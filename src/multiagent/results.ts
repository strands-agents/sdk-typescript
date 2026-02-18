import type { ContentBlock } from '../types/messages.js'
import { Status } from './status.js'

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
