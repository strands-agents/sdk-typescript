/**
 * Serialization interfaces for state persistence.
 *
 * This module provides interfaces for objects that can serialize and deserialize
 * their state, enabling persistence and restoration of runtime state.
 */

import type { JSONSerializable } from './json.js'
import type { JSONValue } from './json.js'

/**
 * Interface for mutable state containers that can serialize and restore their state.
 * Extends JSONSerializable for one-way serialization, adding in-place state restoration.
 *
 * Use JSONSerializable for immutable value objects (with static fromJSON).
 * Use StateSerializable for mutable state that loads into an existing instance.
 */
export interface StateSerializable extends JSONSerializable<JSONValue> {
  /**
   * Loads state from a previously serialized JSON value.
   *
   * @param json - The serialized state to load
   */
  loadStateFromJson(json: JSONValue): void
}

/**
 * Type guard to check if an object implements StateSerializable.
 *
 * @param obj - The object to check
 * @returns True if the object implements StateSerializable
 */
export function isStateSerializable(obj: unknown): obj is StateSerializable {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof (obj as StateSerializable).toJSON === 'function' &&
    typeof (obj as StateSerializable).loadStateFromJson === 'function'
  )
}
