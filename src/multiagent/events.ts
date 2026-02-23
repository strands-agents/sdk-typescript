import { StreamEvent } from '../hooks/events.js'
import type { AgentStreamEvent } from '../types/agent.js'
import type { NodeType } from './types.js'

/**
 * Wraps an inner streaming event from a node with the node's identity.
 * Emitted during node execution to propagate agent-level or nested
 * multi-agent events up to the orchestration layer.
 */
export class NodeStreamUpdateEvent extends StreamEvent {
  readonly type = 'nodeStreamUpdateEvent' as const
  readonly nodeId: string
  readonly nodeType: NodeType
  readonly event: AgentStreamEvent | Exclude<MultiAgentStreamEvent, NodeStreamUpdateEvent>

  constructor(data: {
    nodeId: string
    nodeType: NodeType
    event: AgentStreamEvent | Exclude<MultiAgentStreamEvent, NodeStreamUpdateEvent>
  }) {
    super()
    this.nodeId = data.nodeId
    this.nodeType = data.nodeType
    this.event = data.event
  }
}

/**
 * Union of all multi-agent streaming events.
 */
export type MultiAgentStreamEvent = NodeStreamUpdateEvent
