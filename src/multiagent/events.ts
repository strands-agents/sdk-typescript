import type { AgentStreamEvent } from '../types/agent.js'
import type { NodeType } from './types.js'

/**
 * Wraps an inner streaming event from a node with the node's identity.
 * Emitted during node execution to propagate agent-level or nested
 * multi-agent events up to the orchestration layer.
 */
export class MultiAgentNodeStreamEvent {
  readonly type = 'multiAgentNodeStreamEvent' as const
  readonly nodeId: string
  readonly nodeType: NodeType
  readonly event: AgentStreamEvent | Exclude<MultiAgentStreamEvent, MultiAgentNodeStreamEvent>

  constructor(data: {
    nodeId: string
    nodeType: NodeType
    event: AgentStreamEvent | Exclude<MultiAgentStreamEvent, MultiAgentNodeStreamEvent>
  }) {
    this.nodeId = data.nodeId
    this.nodeType = data.nodeType
    this.event = data.event
  }
}

/**
 * Union of all multi-agent streaming events.
 */
export type MultiAgentStreamEvent = MultiAgentNodeStreamEvent
