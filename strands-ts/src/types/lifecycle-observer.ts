import type { LocalAgent } from './agent.js'

/**
 * Implementors are given the agent at registration time so they can subscribe
 * to hook events of their choice via {@link LocalAgent.addHook}. This is the
 * extension point for components that need to observe arbitrary lifecycle
 * events.
 */
export interface LifecycleObserver {
  /** Stable identifier for this observer. Used for logging and duplicate detection. */
  readonly name: string

  /**
   * Called once when the observer is registered with an agent. Implementations
   * typically subscribe to one or more events via `agent.addHook`.
   */
  observeAgent(agent: LocalAgent): void | Promise<void>
}

/** Type guard for {@link LifecycleObserver}. */
export function isLifecycleObserver(value: unknown): value is LifecycleObserver {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LifecycleObserver).name === 'string' &&
    typeof (value as LifecycleObserver).observeAgent === 'function'
  )
}
