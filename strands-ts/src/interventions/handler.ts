import type {
  BeforeInvocationEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
} from '../hooks/events.js'
import type { LocalAgent } from '../types/agent.js'
import type { Proceed, Deny, Guide, Interrupt, Transform } from './actions.js'

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
 *       return deny('User not authorized for this tool')
 *     }
 *     return proceed()
 *   }
 * }
 * ```
 */
export abstract class InterventionHandler {
  abstract readonly name: string

  /** What to do when this handler throws. Defaults to 'throw'. */
  readonly onError: OnError = 'throw'

  /** Called once during agent initialization. Use to register context-gathering hooks. */
  initAgent(_agent: LocalAgent): void | Promise<void> {}

  beforeInvocation(
    _event: BeforeInvocationEvent
  ): (Proceed | Deny | Guide | Transform) | Promise<Proceed | Deny | Guide | Transform> {
    return { type: 'proceed' }
  }

  beforeToolCall(
    _event: BeforeToolCallEvent
  ): (Proceed | Deny | Guide | Interrupt | Transform) | Promise<Proceed | Deny | Guide | Interrupt | Transform> {
    return { type: 'proceed' }
  }

  afterToolCall(_event: AfterToolCallEvent): (Proceed | Transform) | Promise<Proceed | Transform> {
    return { type: 'proceed' }
  }

  beforeModelCall(
    _event: BeforeModelCallEvent
  ): (Proceed | Deny | Guide | Transform) | Promise<Proceed | Deny | Guide | Transform> {
    return { type: 'proceed' }
  }

  afterModelCall(_event: AfterModelCallEvent): (Proceed | Guide | Transform) | Promise<Proceed | Guide | Transform> {
    return { type: 'proceed' }
  }
}
