import { HookableEvent } from '../hooks/events.js'
import type { AgentStreamEvent } from '../types/agent.js'
import type { MultiAgentResult, MultiAgentState, NodeResult } from './state.js'
import type { MultiAgentBase } from './base.js'
import type { NodeType } from './nodes.js'

/**
 * Event triggered when a multi-agent orchestrator has finished initialization.
 */
export class MultiAgentInitializedEvent extends HookableEvent {
  readonly type = 'multiAgentInitializedEvent' as const
  readonly orchestrator: MultiAgentBase

  constructor(data: { orchestrator: MultiAgentBase }) {
    super()
    this.orchestrator = data.orchestrator
  }
}

/**
 * Event triggered before orchestrator execution starts.
 */
export class BeforeMultiAgentInvocationEvent extends HookableEvent {
  readonly type = 'beforeMultiAgentInvocationEvent' as const
  readonly orchestrator: MultiAgentBase
  readonly state: MultiAgentState

  constructor(data: { orchestrator: MultiAgentBase; state: MultiAgentState }) {
    super()
    this.orchestrator = data.orchestrator
    this.state = data.state
  }
}

/**
 * Event triggered after orchestrator execution completes.
 */
export class AfterMultiAgentInvocationEvent extends HookableEvent {
  readonly type = 'afterMultiAgentInvocationEvent' as const
  readonly orchestrator: MultiAgentBase
  readonly state: MultiAgentState

  constructor(data: { orchestrator: MultiAgentBase; state: MultiAgentState }) {
    super()
    this.orchestrator = data.orchestrator
    this.state = data.state
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}

/**
 * Event triggered before a node begins execution.
 * Hook callbacks can set {@link cancel} to prevent the node from executing.
 */
export class BeforeNodeCallEvent extends HookableEvent {
  readonly type = 'beforeNodeCallEvent' as const
  readonly orchestrator: MultiAgentBase
  readonly state: MultiAgentState
  readonly nodeId: string

  /**
   * Set by hook callbacks to cancel node execution.
   * When set to `true`, a default cancel message is used.
   * When set to a string, that string is used as the cancel message.
   */
  cancel: boolean | string = false

  constructor(data: { orchestrator: MultiAgentBase; state: MultiAgentState; nodeId: string }) {
    super()
    this.orchestrator = data.orchestrator
    this.state = data.state
    this.nodeId = data.nodeId
  }
}

/**
 * Event triggered after a node completes execution.
 */
export class AfterNodeCallEvent extends HookableEvent {
  readonly type = 'afterNodeCallEvent' as const
  readonly orchestrator: MultiAgentBase
  readonly state: MultiAgentState
  readonly nodeId: string

  constructor(data: { orchestrator: MultiAgentBase; state: MultiAgentState; nodeId: string }) {
    super()
    this.orchestrator = data.orchestrator
    this.state = data.state
    this.nodeId = data.nodeId
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}

/**
 * Wraps an inner streaming event from a node with the node's identity.
 * Emitted during node execution to propagate agent-level or nested
 * multi-agent events up to the orchestration layer.
 */
export class NodeStreamUpdateEvent extends HookableEvent {
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
export class NodeResultEvent extends HookableEvent {
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
export class MultiAgentHandoffEvent extends HookableEvent {
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
export class MultiAgentResultEvent extends HookableEvent {
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
  | BeforeMultiAgentInvocationEvent
  | AfterMultiAgentInvocationEvent
  | BeforeNodeCallEvent
  | AfterNodeCallEvent
  | NodeStreamUpdateEvent
  | NodeResultEvent
  | MultiAgentHandoffEvent
  | MultiAgentResultEvent
