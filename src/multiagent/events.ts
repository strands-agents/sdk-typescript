import { HookableEvent, StreamEvent } from '../hooks/events.js'
import type { AgentStreamEvent } from '../types/agent.js'
import type { MultiAgentResult, MultiAgentState, NodeResult } from './state.js'
import type { MultiAgent } from './multiagent.js'
import type { NodeType } from './nodes.js'

/**
 * Event triggered when a multi-agent orchestrator has finished initialization.
 */
export class MultiAgentInitializedEvent extends HookableEvent {
  readonly type = 'multiAgentInitializedEvent' as const
  readonly orchestrator: MultiAgent

  constructor(data: { orchestrator: MultiAgent }) {
    super()
    this.orchestrator = data.orchestrator
  }
}

/**
 * Event triggered before orchestrator execution starts.
 */
export class BeforeMultiAgentInvocationEvent extends HookableEvent {
  readonly type = 'beforeMultiAgentInvocationEvent' as const
  readonly orchestrator: MultiAgent
  readonly state: MultiAgentState

  constructor(data: { orchestrator: MultiAgent; state: MultiAgentState }) {
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
  readonly orchestrator: MultiAgent
  readonly state: MultiAgentState

  constructor(data: { orchestrator: MultiAgent; state: MultiAgentState }) {
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
  readonly orchestrator: MultiAgent
  readonly state: MultiAgentState
  readonly nodeId: string

  /**
   * Set by hook callbacks to cancel node execution.
   * When set to `true`, a default cancel message is used.
   * When set to a string, that string is used as the cancel message.
   */
  cancel: boolean | string = false

  constructor(data: { orchestrator: MultiAgent; state: MultiAgentState; nodeId: string }) {
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
  readonly orchestrator: MultiAgent
  readonly state: MultiAgentState
  readonly nodeId: string
  readonly error?: Error

  constructor(data: { orchestrator: MultiAgent; state: MultiAgentState; nodeId: string; error?: Error }) {
    super()
    this.orchestrator = data.orchestrator
    this.state = data.state
    this.nodeId = data.nodeId
    if (data.error !== undefined) {
      this.error = data.error
    }
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}

/**
 * Tagged inner event from a node, discriminated by {@link source}.
 *
 * Use `inner.source` to determine the event origin, then `inner.event`
 * to access the underlying event and switch on its `type`.
 *
 * Sources:
 * - `'agent'` — the node wraps an {@link Agent} instance. The event is an
 *   {@link AgentStreamEvent} and can be narrowed via `event.type`.
 * - `'multiAgent'` — the node wraps a nested orchestrator (e.g. {@link Graph}
 *   or {@link Swarm}). The event is a {@link MultiAgentStreamEvent} (excluding
 *   {@link NodeStreamUpdateEvent}, which passes through directly).
 * - `'custom'` — the node wraps an {@link InvokableAgent} that is not an
 *   {@link Agent} instance (e.g. {@link A2AAgent} or a third-party implementation).
 *   The event is a {@link StreamEvent} with no further type narrowing available.
 */
export type NodeStreamUpdateInnerEvent =
  | { readonly source: 'agent'; readonly event: AgentStreamEvent }
  | { readonly source: 'multiAgent'; readonly event: Exclude<MultiAgentStreamEvent, NodeStreamUpdateEvent> }
  | { readonly source: 'custom'; readonly event: StreamEvent }

/**
 * Wraps an inner streaming event from a node with the node's identity.
 * Emitted during node execution to propagate agent-level or nested
 * multi-agent events up to the orchestration layer.
 */
export class NodeStreamUpdateEvent extends HookableEvent {
  readonly type = 'nodeStreamUpdateEvent' as const
  readonly nodeId: string
  readonly nodeType: NodeType
  readonly state: MultiAgentState
  readonly inner: NodeStreamUpdateInnerEvent

  constructor(data: { nodeId: string; nodeType: NodeType; state: MultiAgentState; inner: NodeStreamUpdateInnerEvent }) {
    super()
    this.nodeId = data.nodeId
    this.nodeType = data.nodeType
    this.state = data.state
    this.inner = data.inner
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
  readonly state: MultiAgentState
  readonly result: NodeResult

  constructor(data: { nodeId: string; nodeType: NodeType; state: MultiAgentState; result: NodeResult }) {
    super()
    this.nodeId = data.nodeId
    this.nodeType = data.nodeType
    this.state = data.state
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
  readonly state: MultiAgentState

  constructor(data: { source: string; targets: string[]; state: MultiAgentState }) {
    super()
    this.source = data.source
    this.targets = data.targets
    this.state = data.state
  }
}

/**
 * Event triggered when a node is cancelled via {@link BeforeNodeCallEvent.cancel}.
 */
export class NodeCancelEvent extends HookableEvent {
  readonly type = 'nodeCancelEvent' as const
  readonly nodeId: string
  readonly state: MultiAgentState
  readonly message: string

  constructor(data: { nodeId: string; state: MultiAgentState; message: string }) {
    super()
    this.nodeId = data.nodeId
    this.state = data.state
    this.message = data.message
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
  | NodeCancelEvent
  | MultiAgentHandoffEvent
  | MultiAgentResultEvent
