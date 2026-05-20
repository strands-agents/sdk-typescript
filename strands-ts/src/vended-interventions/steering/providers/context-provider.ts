/**
 * Steering context provider interface.
 *
 * Providers track agent activity and supply context data to steering handlers
 * for evaluation decisions.
 */

import type { LocalAgent } from '../../../types/agent.js'
import type { JSONValue } from '../../../types/json.js'

/**
 * Context data returned by a SteeringContextProvider.
 * The type field identifies which provider produced the data.
 */
export interface SteeringContextData {
  /** Discriminator identifying the context provider. */
  readonly type: string
  /** Additional context fields. */
  [key: string]: JSONValue
}

/**
 * Passive observer that accumulates data from agent hook events and exposes a
 * snapshot via `context`.
 *
 * Providers self-subscribe to whichever {@link HookableEvent}s they need by
 * implementing {@link registerHooks}. The owning {@link SteeringHandler} forwards
 * its `registerHooks` call to its providers, so subscriptions are wired at the
 * same time the handler attaches to an agent.
 *
 * @example
 * ```typescript
 * class CostTracker implements SteeringContextProvider {
 *   readonly name = 'costTracker'
 *   private _toolCalls = 0
 *
 *   registerHooks(agent: LocalAgent): void {
 *     agent.addHook(AfterToolCallEvent, () => {
 *       this._toolCalls += 1
 *     })
 *   }
 *
 *   get context(): SteeringContextData {
 *     return { type: 'costTracker', toolCalls: this._toolCalls }
 *   }
 * }
 * ```
 */
export interface SteeringContextProvider {
  /** Identifier for this provider instance. */
  readonly name: string

  /** Return the current context snapshot for steering evaluation. */
  get context(): SteeringContextData

  /**
   * Subscribe to hook events. Called once by the owning {@link SteeringHandler}
   * when the handler is registered with an agent.
   */
  registerHooks?(agent: LocalAgent): void
}
