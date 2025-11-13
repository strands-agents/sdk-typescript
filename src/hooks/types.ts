import type { HookEvent } from './events.js'
import type { HookRegistry } from './registry.js'

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
 * Protocol for objects that provide hook callbacks to an agent.
 * Enables composable extension of agent functionality.
 *
 * @example
 * ```typescript
 * class MyHooks implements HookProvider {
 *   registerHooks(registry: HookRegistry): void {
 *     registry.addCallback(BeforeInvocationEvent, this.onStart)
 *     registry.addCallback(AfterInvocationEvent, this.onEnd)
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
   * Register callback functions for specific event types.
   *
   * @param registry - The hook registry to register callbacks with
   */
  registerHooks(registry: HookRegistry): void
}
