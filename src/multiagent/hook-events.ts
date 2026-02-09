/**
 * Multi-agent hook event types.
 *
 * Hook events emitted at specific points in multi-agent orchestration lifecycle.
 * Supports interrupt system for human-in-the-loop workflows.
 */

import { v5 as uuidv5 } from 'uuid'
import { HookEvent } from '../hooks/events.js'
import { Interrupt, InterruptException, type InterruptState, UUID_NAMESPACE_OID } from '../interrupt.js'
import type { MultiAgentBase } from './base.js'

/**
 * Event triggered when multi-agent orchestrator is initialized.
 * Fired once after construction, before any execution begins.
 */
export class MultiAgentInitializedEvent extends HookEvent {
  readonly type = 'multiAgentInitializedEvent' as const

  /**
   * The multi-agent orchestrator instance.
   */
  readonly source: MultiAgentBase

  constructor(data: { source: MultiAgentBase }) {
    super()
    this.source = data.source
  }
}

/**
 * Event triggered before orchestrator execution starts.
 */
export class BeforeMultiAgentInvocationEvent extends HookEvent {
  readonly type = 'beforeMultiAgentInvocationEvent' as const

  /**
   * The multi-agent orchestrator instance.
   */
  readonly source: MultiAgentBase

  /**
   * Opaque invocation context passed to stream()/invoke() options.
   */
  readonly invocationState: Record<string, unknown> | undefined

  constructor(data: { source: MultiAgentBase; invocationState?: Record<string, unknown> }) {
    super()
    this.source = data.source
    this.invocationState = data.invocationState
  }
}

/**
 * Event triggered after orchestrator execution completes.
 * Uses reverse callback ordering for proper cleanup semantics.
 */
export class AfterMultiAgentInvocationEvent extends HookEvent {
  readonly type = 'afterMultiAgentInvocationEvent' as const

  /**
   * The multi-agent orchestrator instance.
   */
  readonly source: MultiAgentBase

  /**
   * Opaque invocation context passed to stream()/invoke() options.
   */
  readonly invocationState: Record<string, unknown> | undefined

  constructor(data: { source: MultiAgentBase; invocationState?: Record<string, unknown> }) {
    super()
    this.source = data.source
    this.invocationState = data.invocationState
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}

/**
 * Event triggered before individual node execution starts.
 *
 * Supports the interrupt system for human-in-the-loop workflows.
 * Hook callbacks can call `event.interrupt(name, reason)` to pause
 * multi-agent execution and request human input.
 *
 * Supports node cancellation via `cancelNode`.
 */
export class BeforeNodeCallEvent extends HookEvent {
  readonly type = 'beforeNodeCallEvent' as const

  /**
   * The multi-agent orchestrator instance.
   */
  readonly source: MultiAgentBase

  /**
   * ID of the node about to execute.
   */
  readonly nodeId: string

  /**
   * When set by a hook callback, cancels the node execution.
   * If set to a string, that string is used as the cancellation message.
   * If set to true, a default cancellation message is used.
   */
  cancelNode: string | boolean

  /**
   * Opaque invocation context passed to stream()/invoke() options.
   */
  readonly invocationState: Record<string, unknown> | undefined

  constructor(data: { source: MultiAgentBase; nodeId: string; invocationState?: Record<string, unknown> }) {
    super()
    this.source = data.source
    this.nodeId = data.nodeId
    this.cancelNode = false
    this.invocationState = data.invocationState
  }

  /**
   * Trigger an interrupt to pause multi-agent execution for human input.
   *
   * On first call, creates an Interrupt and throws InterruptException to pause execution.
   * On resume (when the interrupt already has a response), returns the human's response
   * so the callback can use it to make decisions.
   *
   * @param name - User-defined name for the interrupt. Must be unique across hook callbacks.
   * @param reason - Reason for raising the interrupt
   * @param response - Preemptive response if available
   * @returns The human's response when resuming from an interrupt state
   * @throws InterruptException when human input is required
   */
  interrupt(name: string, reason?: unknown, response?: unknown): unknown {
    const sourceWithState = this.source as unknown as { _interruptState?: InterruptState }
    if (sourceWithState._interruptState === undefined) {
      throw new Error('interrupt() requires a MultiAgentBase instance with interrupt state')
    }

    const interruptState = sourceWithState._interruptState
    const nodeIdHash = uuidv5(this.nodeId, UUID_NAMESPACE_OID)
    const callIdHash = uuidv5(name, UUID_NAMESPACE_OID)
    const id = `v1:before_node_call:${nodeIdHash}:${callIdHash}`

    let interrupt = interruptState.interrupts.get(id)
    if (interrupt === undefined) {
      interrupt = new Interrupt({ id, name, reason: reason ?? null, response: response ?? null })
      interruptState.interrupts.set(id, interrupt)
    }

    if (interrupt.response !== null) {
      return interrupt.response
    }

    throw new InterruptException(interrupt)
  }
}

/**
 * Event triggered after individual node execution completes.
 * Uses reverse callback ordering for proper cleanup semantics.
 */
export class AfterNodeCallEvent extends HookEvent {
  readonly type = 'afterNodeCallEvent' as const

  /**
   * The multi-agent orchestrator instance.
   */
  readonly source: MultiAgentBase

  /**
   * ID of the node that just completed execution.
   */
  readonly nodeId: string

  /**
   * Opaque invocation context passed to stream()/invoke() options.
   */
  readonly invocationState: Record<string, unknown> | undefined

  constructor(data: { source: MultiAgentBase; nodeId: string; invocationState?: Record<string, unknown> }) {
    super()
    this.source = data.source
    this.nodeId = data.nodeId
    this.invocationState = data.invocationState
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}
