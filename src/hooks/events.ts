import type { Agent } from '../agent/agent.js'

/**
 * Base class for all hook events.
 * Hook events are emitted at specific points in the agent lifecycle.
 */
export abstract class HookEvent {
  /**
   * The agent instance that triggered this event.
   */
  readonly agent: Agent

  /**
   * Whether callbacks for this event should be invoked in reverse order.
   * Returns true for cleanup/teardown events (e.g., AfterInvocationEvent).
   */
  get shouldReverseCallbacks(): boolean {
    return false
  }

  constructor(data: { agent: Agent }) {
    this.agent = data.agent
  }
}

/**
 * Event triggered at the beginning of a new agent request.
 * Fired before any model inference or tool execution occurs.
 */
export class BeforeInvocationEvent extends HookEvent {
  readonly type = 'beforeInvocationEvent' as const
}

/**
 * Event triggered at the end of an agent request.
 * Fired after all processing completes, regardless of success or error.
 * Uses reverse callback ordering for proper cleanup semantics.
 */
export class AfterInvocationEvent extends HookEvent {
  readonly type = 'afterInvocationEvent' as const

  override get shouldReverseCallbacks(): boolean {
    return true
  }
}
