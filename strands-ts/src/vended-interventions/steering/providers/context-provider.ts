/**
 * Steering context provider interface.
 *
 * Providers track agent activity and supply context data to steering handlers
 * for evaluation decisions.
 */

import type {
  AfterModelCallEvent,
  AfterToolCallEvent,
  BeforeInvocationEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
} from '../../../hooks/events.js'
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
 * A passive observer that accumulates data from intervention lifecycle events.
 *
 * The owning {@link SteeringHandler} feeds each event to its providers before
 * running its own decision logic. Implement only the lifecycle methods you need;
 * unimplemented methods are skipped.
 *
 * Providers expose accumulated state through the `context` getter, which the
 * handler reads when making steering decisions.
 *
 * @example
 * ```typescript
 * class CostTracker implements SteeringContextProvider {
 *   readonly name = 'costTracker'
 *   private _toolCalls = 0
 *
 *   afterToolCall(_event: AfterToolCallEvent): void {
 *     this._toolCalls += 1
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

  beforeInvocation?(event: BeforeInvocationEvent): void | Promise<void>
  beforeToolCall?(event: BeforeToolCallEvent): void | Promise<void>
  afterToolCall?(event: AfterToolCallEvent): void | Promise<void>
  beforeModelCall?(event: BeforeModelCallEvent): void | Promise<void>
  afterModelCall?(event: AfterModelCallEvent): void | Promise<void>
}
