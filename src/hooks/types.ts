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
 * Function that removes a previously registered hook callback.
 * Safe to call multiple times (idempotent).
 * No-op if the callback is no longer registered.
 */
export type HookCleanup = () => void
