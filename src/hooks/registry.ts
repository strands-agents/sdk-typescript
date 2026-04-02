import type { HookableEvent } from './events.js'
import type { HookCallback, HookableEventConstructor, HookCleanup } from './types.js'
import { InterruptError, Interrupt } from '../interrupt.js'

/**
 * Represents a registered callback entry.
 */
type CallbackEntry = {
  callback: HookCallback<HookableEvent>
}

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
   * @returns Cleanup function that removes the callback when invoked
   */
  addCallback<T extends HookableEvent>(eventType: HookableEventConstructor<T>, callback: HookCallback<T>): HookCleanup
}

/**
 * Implementation of the hook registry for managing hook callbacks.
 * Maintains mappings between event types and callback functions.
 */
export class HookRegistryImplementation implements HookRegistry {
  private readonly _callbacks: Map<HookableEventConstructor, CallbackEntry[]>

  constructor() {
    this._callbacks = new Map()
  }

  /**
   * Register a callback function for a specific event type.
   *
   * @param eventType - The event class constructor to register the callback for
   * @param callback - The callback function to invoke when the event occurs
   * @returns Cleanup function that removes the callback when invoked
   */
  addCallback<T extends HookableEvent>(eventType: HookableEventConstructor<T>, callback: HookCallback<T>): HookCleanup {
    const entry: CallbackEntry = { callback: callback as HookCallback<HookableEvent> }
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
   * Invoke all registered callbacks for the given event.
   * Awaits each callback, supporting both sync and async.
   *
   * InterruptErrors are collected across callbacks rather than immediately thrown,
   * allowing all hooks to register their interrupts. Non-interrupt errors propagate immediately.
   *
   * @param event - The event to invoke callbacks for
   * @returns The event after all callbacks have been invoked
   * @throws InterruptError with all collected interrupts after all callbacks complete
   */
  async invokeCallbacks<T extends HookableEvent>(event: T): Promise<T> {
    const callbacks = this.getCallbacksFor(event)
    const collectedInterrupts: Interrupt[] = []

    for (const callback of callbacks) {
      try {
        await callback(event)
      } catch (error) {
        if (error instanceof InterruptError) {
          collectedInterrupts.push(...error.interrupts)
        } else {
          throw error
        }
      }
    }

    if (collectedInterrupts.length > 0) {
      const seen = new Set<string>()
      for (const interrupt of collectedInterrupts) {
        if (seen.has(interrupt.name)) {
          throw new Error(`interrupt_name=<${interrupt.name}> | interrupt name used more than once`)
        }
        seen.add(interrupt.name)
      }
      throw new InterruptError(collectedInterrupts)
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
  private getCallbacksFor<T extends HookableEvent>(event: T): HookCallback<T>[] {
    const entries = this._callbacks.get(event.constructor as HookableEventConstructor<T>) ?? []
    const callbacks = entries.map((entry) => entry.callback)
    return (event._shouldReverseCallbacks() ? [...callbacks].reverse() : callbacks) as HookCallback<T>[]
  }
}
