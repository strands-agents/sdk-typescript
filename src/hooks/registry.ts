import type { HookEvent } from './events.js'
import type { HookCallback, HookProvider, HookEventConstructor, HookCleanup } from './types.js'

/**
 * Represents a callback entry with its source provider.
 */
type CallbackEntry = {
  callback: HookCallback<HookEvent>
  source: HookProvider | undefined
}

/**
 * Interface for hook registry operations.
 * Enables registration of hook callbacks for event-driven extensibility.
 */
export interface HookRegistry {
  /**
   * Register a callback function for a specific event type.
   *
   * @param callback - The callback function to invoke when the event occurs
   * @param eventType - The event class constructor to register the callback for
   * @returns Cleanup function that removes the callback when invoked
   */
  addCallback<T extends HookEvent>(callback: HookCallback<T>, eventType: HookEventConstructor<T>): HookCleanup

  /**
   * Register all callbacks from a hook provider.
   *
   * @param provider - The hook provider to register
   */
  addHook(provider: HookProvider): void

  /**
   * Remove all callbacks registered by a hook provider.
   *
   * @param provider - The hook provider to remove
   */
  removeHook(provider: HookProvider): void
}

/**
 * Implementation of the hook registry for managing hook callbacks.
 * Maintains mappings between event types and callback functions.
 */
export class HookRegistryImplementation implements HookRegistry {
  private readonly _callbacks: Map<HookEventConstructor, CallbackEntry[]>
  private _currentProvider: HookProvider | undefined

  constructor() {
    this._callbacks = new Map()
    this._currentProvider = undefined
  }

  /**
   * Register a callback function for a specific event type.
   *
   * @param callback - The callback function to invoke when the event occurs
   * @param eventType - The event class constructor to register the callback for
   * @returns Cleanup function that removes the callback when invoked
   */
  addCallback<T extends HookEvent>(callback: HookCallback<T>, eventType: HookEventConstructor<T>): HookCleanup {
    const entry: CallbackEntry = { callback: callback as HookCallback<HookEvent>, source: this._currentProvider }
    const callbacks = this._callbacks.get(eventType) ?? []
    callbacks.push(entry)
    this._callbacks.set(eventType, callbacks)

    return () => {
      const callbacks = this._callbacks.get(eventType)
      if (!callbacks) return
      const index = callbacks.indexOf(entry)
      if (index !== -1) {
        callbacks.splice(index, 1)
      }
    }
  }

  /**
   * Register all callbacks from a hook provider.
   *
   * @param provider - The hook provider to register
   */
  addHook(provider: HookProvider): void {
    // We want to be able to remove all hooks from a given provider so that things implemented via hooks (like
    // conversation-managers or printers) can be changed dynamically on the agent. To allow removing hooks, we
    // need to track where a given callback came from - we could force callers to pass in the source when calling
    // addCallback but that's a poor dev-x, so we do it ourselves here.

    this._currentProvider = provider
    try {
      provider.registerCallbacks(this)
    } finally {
      this._currentProvider = undefined
    }
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
   * Remove all callbacks registered by a hook provider.
   *
   * @param provider - The hook provider to remove
   */
  removeHook(provider: HookProvider): void {
    for (const [eventType, callbacks] of this._callbacks.entries()) {
      const filtered = callbacks.filter((entry) => entry.source !== provider)
      if (filtered.length === 0) {
        this._callbacks.delete(eventType)
      } else if (filtered.length !== callbacks.length) {
        this._callbacks.set(eventType, filtered)
      }
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
    const entries = this._callbacks.get(event.constructor as HookEventConstructor<T>) ?? []
    const callbacks = entries.map((entry) => entry.callback)
    return (event._shouldReverseCallbacks() ? [...callbacks].reverse() : callbacks) as HookCallback<T>[]
  }
}
