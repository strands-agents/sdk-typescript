/**
 * Steering context system for contextual guidance.
 *
 * Provides protocols for context callbacks and providers that populate
 * steering context data used by handlers to make guidance decisions.
 *
 * @experimental This API is experimental and may change in future releases.
 */

import type { JSONValue } from '../../../types/json.js'
import type { HookEvent } from '../../../hooks/events.js'
import type { HookEventConstructor } from '../../../hooks/types.js'

/**
 * Container for steering context data.
 *
 * Stores JSON-serializable key-value pairs that steering handlers use
 * to make guidance decisions. Each handler maintains its own isolated context.
 *
 * @experimental This API is experimental and may change in future releases.
 */
export class SteeringContext {
  private _data: Record<string, JSONValue> = {}

  /**
   * Gets a value from the context by key.
   *
   * @param key - The key to retrieve
   * @returns The value, or undefined if not found
   */
  get(key: string): JSONValue | undefined {
    return this._data[key]
  }

  /**
   * Sets a value in the context.
   *
   * @param key - The key to store the value under
   * @param value - The JSON-serializable value to store
   */
  set(key: string, value: JSONValue): void {
    this._data[key] = value
  }

  /**
   * Returns a shallow copy of all context data.
   *
   * @returns Copy of the context data
   */
  getAll(): Record<string, JSONValue> {
    return { ...this._data }
  }
}

/**
 * Abstract base class for steering context update callbacks.
 *
 * Each callback handles a specific hook event type and updates the
 * steering context with relevant data from that event.
 *
 * @experimental This API is experimental and may change in future releases.
 */
export abstract class SteeringContextCallback<E extends HookEvent = HookEvent> {
  /**
   * The hook event constructor this callback handles.
   */
  abstract readonly eventType: HookEventConstructor<E>

  /**
   * Updates steering context based on a hook event.
   *
   * @param event - The hook event that triggered the callback
   * @param steeringContext - The steering context to update
   */
  abstract update(event: E, steeringContext: SteeringContext): void | Promise<void>
}

/**
 * Abstract base class for context providers that supply multiple callbacks.
 *
 * Providers group related callbacks (e.g., before and after tool call tracking)
 * and return them as a list for registration.
 *
 * @experimental This API is experimental and may change in future releases.
 */
export abstract class SteeringContextProvider {
  /**
   * Returns the list of context callbacks this provider supplies.
   *
   * @returns Array of context callbacks with their associated event types
   */
  abstract contextProviders(): SteeringContextCallback[]
}
