import type { HookableEvent } from './events.js'

/**
 * Type for a constructor function that creates HookableEvent instances.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HookableEventConstructor<T extends HookableEvent = HookableEvent> = new (...args: any[]) => T

/**
 * Type for callback functions that handle hookable events.
 * Callbacks can be synchronous or asynchronous.
 *
 * @example
 * ```typescript
 * const callback: HookCallback<BeforeInvocationEvent> = (event) => {
 *   console.log('Agent invocation started')
 * }
 * ```
 */
export type HookCallback<T extends HookableEvent> = (event: T) => void | Promise<void>

/**
 * Options for registering a hook callback.
 */
export interface HookCallbackOptions {
  order?: number
}

/**
 * Function that removes a previously registered hook callback.
 * Safe to call multiple times (idempotent).
 * No-op if the callback is no longer registered.
 */
export type HookCleanup = () => void

/**
 * Named constants for hook execution order.
 * Lower values run first.
 *
 * @example
 * ```typescript
 * agent.addHook(BeforeToolCallEvent, callback, { order: HookOrder.FIRST })
 * ```
 */
export const HookOrder = {
  FIRST: -100,
  DEFAULT: 0,
  LAST: 100,
} as const
