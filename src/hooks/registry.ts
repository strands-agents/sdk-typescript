import type { HookEvent } from './events.js'
import type { HookCallback, HookProvider, HookEventConstructor } from './types.js'

/**
 * Interface for hook registry operations.
 * Enables registration of hook callbacks for event-driven extensibility.
 */
export interface HookRegistry {
  /**
   * Register a callback function for a specific event type.
   *
   * @param eventType - The event class constructor to register the callback for
   * @param callback - The callback function to invoke when the event occurs
   */
  addCallback<T extends HookEvent>(eventType: HookEventConstructor<T>, callback: HookCallback<T>): void

  /**
   * Register all callbacks from a hook provider.
   *
   * @param provider - The hook provider to register
   */
  addHook(provider: HookProvider): void
}

/**
 * Implementation of the hook registry for managing hook callbacks.
 * Maintains mappings between event types and callback functions.
 */
export class HookRegistryImplementation implements HookRegistry {
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
    provider.registerCallbacks(this)
  }

  /**
   * Register all callbacks from multiple hook providers.
   *
   * @param providers - Array of hook providers to register
   */
  addAllHooks(providers: HookProvider[]): void {
    for (const provider of providers) {
      this.addHook(provider)
    }
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
   * Get callbacks for a specific event with proper ordering.
   * Returns callbacks in reverse order if event should reverse callbacks.
   *
   * @param event - The event to get callbacks for
   * @returns Array of callbacks for the event
   */
  private getCallbacksFor<T extends HookEvent>(event: T): HookCallback<T>[] {
    const callbacks = this._callbacks.get(event.constructor as HookEventConstructor<T>) ?? []
    return (event._shouldReverseCallbacks() ? [...callbacks].reverse() : callbacks) as HookCallback<T>[]
  }
}
