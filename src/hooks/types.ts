import type { HookEvent } from './events.js'
import type { Agent } from '../agent/agent.js'

/**
 * Type for a constructor function that creates HookEvent instances.
 */
export type HookEventConstructor<T extends HookEvent = HookEvent> = new (data: { agent: Agent }) => T

/**
 * Type for callback functions that handle hook events.
 * Callbacks can be synchronous or asynchronous.
 *
 * @example
 * ```typescript
 * const callback: HookCallback<BeforeInvocationEvent> = (event) => {
 *   console.log('Agent invocation started')
 * }
 * ```
 */
export type HookCallback<T extends HookEvent> = (event: T) => void | Promise<void>

/**
 * Represents a single hook registration binding an event type to a callback.
 */
export interface HookRegistration<T extends HookEvent = HookEvent> {
  event: HookEventConstructor<T>
  callback: HookCallback<T>
}

/**
 * Protocol for objects that provide hook callbacks to an agent.
 * Enables composable extension of agent functionality.
 *
 * @example
 * ```typescript
 * class MyHooks implements HookProvider {
 *   getHooks(): HookRegistration[] {
 *     return [
 *       { event: BeforeInvocationEvent, callback: this.onStart },
 *       { event: AfterInvocationEvent, callback: this.onEnd }
 *     ]
 *   }
 *
 *   private onStart = (event: BeforeInvocationEvent): void => {
 *     console.log('Agent started')
 *   }
 *
 *   private onEnd = (event: AfterInvocationEvent): void => {
 *     console.log('Agent completed')
 *   }
 * }
 * ```
 */
export interface HookProvider {
  /**
   * Get all hook registrations provided by this provider.
   *
   * @returns Array of hook registrations
   */
  getHooks(): HookRegistration[]
}
