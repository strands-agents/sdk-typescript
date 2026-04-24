import type { BeforeToolCallEvent, AfterModelCallEvent } from '../hooks/events.js'
import type { InterventionAction } from './actions.js'

/**
 * What to do when a handler throws during evaluation.
 *
 * - `'throw'` — rethrow the error (default, safest: a broken policy check blocks execution)
 * - `'proceed'` — log the error and continue as if the handler returned Proceed
 * - `'deny'` — log the error and treat it as a Deny (fail-closed)
 */
export type OnError = 'throw' | 'proceed' | 'deny'

/**
 * Base class for intervention handlers.
 *
 * Handlers override the lifecycle methods they care about. Default implementations
 * return Proceed. The framework detects which methods are overridden and only
 * registers hook callbacks for those.
 *
 * @example
 * ```typescript
 * class CedarAuth extends InterventionHandler {
 *   readonly name = 'cedar-auth'
 *
 *   override beforeToolCall(event: BeforeToolCallEvent): InterventionAction {
 *     if (!this.isAuthorized(event)) {
 *       return { type: 'deny', reason: 'User not authorized for this tool' }
 *     }
 *     return { type: 'proceed' }
 *   }
 * }
 * ```
 */
export abstract class InterventionHandler {
  abstract readonly name: string

  /** What to do when this handler throws. Defaults to 'throw'. */
  readonly onError: OnError = 'throw'

  beforeToolCall(_event: BeforeToolCallEvent): InterventionAction | Promise<InterventionAction> {
    return { type: 'proceed' }
  }

  afterModelCall(_event: AfterModelCallEvent): InterventionAction | Promise<InterventionAction> {
    return { type: 'proceed' }
  }
}
