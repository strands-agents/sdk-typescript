import type { AgentData } from '../types/agent.js'

/**
 * Base class for all hook events.
 * Hook events are emitted at specific points in the agent lifecycle.
 */
export abstract class HookEvent {
  /**
   * @internal
   * Check if callbacks should be reversed for this event.
   * Used by HookRegistry for callback ordering.
   */
  _shouldReverseCallbacks(): boolean {
    return false
  }
}

/**
 * Event triggered at the beginning of a new agent request.
 * Fired before any model inference or tool execution occurs.
 */
export class BeforeInvocationEvent extends HookEvent {
  readonly type = 'beforeInvocationEvent' as const
  readonly agent: AgentData

  constructor(data: { agent: AgentData }) {
    super()
    this.agent = data.agent
  }
}

/**
 * Event triggered at the end of an agent request.
 * Fired after all processing completes, regardless of success or error.
 * Uses reverse callback ordering for proper cleanup semantics.
 */
export class AfterInvocationEvent extends HookEvent {
  readonly type = 'afterInvocationEvent' as const
  readonly agent: AgentData

  constructor(data: { agent: AgentData }) {
    super()
    this.agent = data.agent
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}
