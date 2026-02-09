/**
 * Multi-agent streaming event types.
 *
 * Provides event classes emitted during multi-agent execution to enable
 * real-time monitoring of node lifecycle, handoffs, and results.
 */

import type { Interrupt } from '../interrupt.js'
import type { NodeResult, MultiAgentResult } from './base.js'

/**
 * Event emitted when a node begins execution in multi-agent context.
 */
export class MultiAgentNodeStartEvent {
  readonly type = 'multiAgentNodeStartEvent' as const

  /**
   * Unique identifier for the node.
   */
  readonly nodeId: string

  /**
   * Type of node being executed ("agent" or "multiagent").
   */
  readonly nodeType: string

  constructor(data: { nodeId: string; nodeType: string }) {
    this.nodeId = data.nodeId
    this.nodeType = data.nodeType
  }
}

/**
 * Event emitted after node input is built, before the node executes.
 * Exposes the input (ContentBlock[] or string) passed to the node.
 */
export class MultiAgentNodeInputEvent {
  readonly type = 'multiAgentNodeInputEvent' as const

  /**
   * Unique identifier for the node.
   */
  readonly nodeId: string

  /**
   * Input passed to the node (ContentBlock[] or string).
   */
  readonly input: unknown

  constructor(data: { nodeId: string; input: unknown }) {
    this.nodeId = data.nodeId
    this.input = data.input
  }
}

/**
 * Event emitted when a node stops execution.
 * Provides the complete NodeResult with execution details, metrics, and status.
 */
export class MultiAgentNodeStopEvent {
  readonly type = 'multiAgentNodeStopEvent' as const

  /**
   * Unique identifier for the node.
   */
  readonly nodeId: string

  /**
   * Complete result from the node execution.
   */
  readonly nodeResult: NodeResult

  constructor(data: { nodeId: string; nodeResult: NodeResult }) {
    this.nodeId = data.nodeId
    this.nodeResult = data.nodeResult
  }
}

/**
 * Event emitted during node execution — forwards agent events with node context.
 * The event payload can be either an AgentStreamEvent or a nested MultiAgentStreamEvent.
 */
export class MultiAgentNodeStreamEvent {
  readonly type = 'multiAgentNodeStreamEvent' as const

  /**
   * Unique identifier for the node generating the event.
   */
  readonly nodeId: string

  /**
   * The original event from the underlying agent or multi-agent executor.
   */
  readonly event: unknown

  constructor(data: { nodeId: string; event: unknown }) {
    this.nodeId = data.nodeId
    this.event = data.event
  }
}

/**
 * Event emitted during node transitions in multi-agent systems.
 *
 * Supports both single handoffs (Swarm) and batch transitions (Graph).
 * For Swarm: Single node-to-node handoffs with a message.
 * For Graph: Batch transitions where multiple nodes complete and multiple nodes begin.
 */
export class MultiAgentHandoffEvent {
  readonly type = 'multiAgentHandoffEvent' as const

  /**
   * Node ID(s) completing execution.
   * Swarm: single-element list. Graph: multi-element list.
   */
  readonly fromNodeIds: string[]

  /**
   * Node ID(s) beginning execution.
   * Swarm: single-element list. Graph: multi-element list.
   */
  readonly toNodeIds: string[]

  /**
   * Optional message explaining the transition (typically used in Swarm).
   */
  readonly message?: string

  constructor(data: { fromNodeIds: string[]; toNodeIds: string[]; message?: string }) {
    this.fromNodeIds = data.fromNodeIds
    this.toNodeIds = data.toNodeIds
    if (data.message !== undefined) {
      this.message = data.message
    }
  }
}

/**
 * Event emitted when a user cancels node execution from a BeforeNodeCallEvent hook.
 */
export class MultiAgentNodeCancelEvent {
  readonly type = 'multiAgentNodeCancelEvent' as const

  /**
   * Unique identifier for the cancelled node.
   */
  readonly nodeId: string

  /**
   * The cancellation message.
   */
  readonly message: string

  constructor(data: { nodeId: string; message: string }) {
    this.nodeId = data.nodeId
    this.message = data.message
  }
}

/**
 * Event emitted when a node is interrupted for human input.
 */
export class MultiAgentNodeInterruptEvent {
  readonly type = 'multiAgentNodeInterruptEvent' as const

  /**
   * Unique identifier for the interrupted node.
   */
  readonly nodeId: string

  /**
   * Interrupts raised during node execution.
   */
  readonly interrupts: Interrupt[]

  constructor(data: { nodeId: string; interrupts: Interrupt[] }) {
    this.nodeId = data.nodeId
    this.interrupts = data.interrupts
  }
}

/**
 * Event emitted when multi-agent execution completes with the final result.
 */
export class MultiAgentResultEvent {
  readonly type = 'multiAgentResultEvent' as const

  /**
   * The final result from multi-agent execution.
   */
  readonly result: MultiAgentResult

  constructor(data: { result: MultiAgentResult }) {
    this.result = data.result
  }
}
