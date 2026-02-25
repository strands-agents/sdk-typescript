import { StreamEvent } from '../hooks/events.js'
import type { AgentStreamEvent } from '../types/agent.js'
import type { MultiAgentResult, NodeResult } from './state.js'
import type { NodeType } from './nodes.js'

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
 * Event triggered when a node finishes execution.
 * Wraps the {@link NodeResult} for the completed node.
 */
export class NodeResultEvent extends StreamEvent {
  readonly type = 'nodeResultEvent' as const
  readonly nodeId: string
  readonly nodeType: NodeType
  readonly result: NodeResult

  constructor(data: { nodeId: string; nodeType: NodeType; result: NodeResult }) {
    super()
    this.nodeId = data.nodeId
    this.nodeType = data.nodeType
    this.result = data.result
  }
}

/**
 * Event triggered when execution transitions between nodes.
 */
export class MultiAgentHandoffEvent extends StreamEvent {
  readonly type = 'multiAgentHandoffEvent' as const
  readonly source: string
  readonly targets: string[]

  constructor(data: { source: string; targets: string[] }) {
    super()
    this.source = data.source
    this.targets = data.targets
  }
}

/**
 * Event triggered as the final event in the multi-agent stream.
 * Wraps the {@link MultiAgentResult} containing the aggregate outcome.
 */
export class MultiAgentResultEvent extends StreamEvent {
  readonly type = 'multiAgentResultEvent' as const
  readonly result: MultiAgentResult

  constructor(data: { result: MultiAgentResult }) {
    super()
    this.result = data.result
  }
}

/**
 * Union of all multi-agent streaming events.
 */
export type MultiAgentStreamEvent =
  | NodeStreamUpdateEvent
  | NodeResultEvent
  | MultiAgentHandoffEvent
  | MultiAgentResultEvent
