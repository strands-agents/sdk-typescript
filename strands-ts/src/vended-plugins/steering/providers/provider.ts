/**
 * Steering context provider interface.
 *
 * Providers track agent activity and supply context data to steering handlers
 * for evaluation decisions.
 */

import type { Plugin } from '../../../plugins/plugin.js'
import type { JSONValue } from '../../../types/json.js'

/**
 * Context data returned by a SteeringProvider.
 * The type field identifies which provider produced the data.
 */
export interface SteeringContextData {
  /** Discriminator identifying the context provider. */
  readonly type: string
  /** Additional context fields. */
  [key: string]: JSONValue
}

/**
 * A component that provides context data for steering evaluation.
 *
 * Providers register hooks via initAgent to observe agent activity,
 * and expose accumulated data through the context getter.
 *
 * @example
 * ```typescript
 * class CostTracker implements SteeringProvider {
 *   readonly name = 'costTracker'
 *   private _totalTokens = 0
 *
 *   initAgent(agent: LocalAgent): void {
 *     agent.addHook(AfterModelCallEvent, (event) => {
 *       this._totalTokens += getTokenCount(event)
 *     })
 *   }
 *
 *   get context(): SteeringContextData {
 *     return { type: 'costTracker', totalTokens: this._totalTokens }
 *   }
 * }
 * ```
 */
export interface SteeringProvider extends Pick<Plugin, 'initAgent' | 'name'> {
  /**
   * Return the current context snapshot for steering evaluation.
   */
  get context(): SteeringContextData
}
