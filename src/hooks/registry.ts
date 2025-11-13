import type { HookEvent } from './events.js'
import type { HookCallback, HookProvider } from './types.js'
import type { Agent } from '../agent/agent.js'

/**
 * Type for a constructor function that creates HookEvent instances.
 */
type HookEventConstructor<T extends HookEvent = HookEvent> = new (data: { agent: Agent }) => T

/**
 * Registry for managing hook callbacks associated with event types.
 * Maintains mappings between event types and callback functions.
 */
export class HookRegistry {
  private readonly _callbacks: Map<HookEventConstructor, HookCallback<HookEvent>[]>

  constructor() {
    this._callbacks = new Map()
  }

  /**
   * Register a callback function for a specific event type.
   *
   * @param eventType - The event class constructor to register the callback for
   * @param callback - The callback function to invoke when the event occurs
   */
  addCallback<T extends HookEvent>(eventType: HookEventConstructor<T>, callback: HookCallback<T>): void {
    const callbacks = this._callbacks.get(eventType) ?? []
    callbacks.push(callback as HookCallback<HookEvent>)
    this._callbacks.set(eventType, callbacks)
  }

  /**
   * Register all callbacks from a hook provider.
   *
   * @param provider - The hook provider to register
   */
  addHook(provider: HookProvider): void {
    provider.registerHooks(this)
  }

  /**
   * Invoke all registered callbacks for the given event.
   * Awaits each callback, supporting both sync and async.
   *
   * @param event - The event to invoke callbacks for
   * @returns The event after all callbacks have been invoked
   */
  async invokeCallbacks<T extends HookEvent>(event: T): Promise<T> {
    const callbacks = this.getCallbacksFor(event)
    for (const callback of callbacks) {
      await callback(event)
    }
    return event
  }

  /**
   * Check if any callbacks are registered.
   *
   * @returns True if any callbacks are registered, false otherwise
   */
  hasCallbacks(): boolean {
    for (const callbacks of this._callbacks.values()) {
      if (callbacks.length > 0) {
        return true
      }
    }
    return false
  }

  /**
   * Get callbacks for a specific event with proper ordering.
   * Returns callbacks in reverse order if event.shouldReverseCallbacks is true.
   *
   * @param event - The event to get callbacks for
   * @returns Array of callbacks for the event
   */
  getCallbacksFor<T extends HookEvent>(event: T): HookCallback<T>[] {
    const callbacks = this._callbacks.get(event.constructor as HookEventConstructor<T>) ?? []
    return (event.shouldReverseCallbacks ? [...callbacks].reverse() : callbacks) as HookCallback<T>[]
  }
}
