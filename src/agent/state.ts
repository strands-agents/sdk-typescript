import { deepCopy, type JSONValue } from '../types/json.js'

/**
 * Validates that a value is JSON serializable without data loss.
 * Throws an error if the value contains non-serializable types or would lose data.
 *
 * @param value - The value to validate
 * @param path - The path to the value (for error messages)
 * @throws Error if value contains non-serializable types or would lose data
 */
function validateJSONSerializable(value: unknown, path: string = 'value'): void {
  // Check for non-serializable primitive types
  if (typeof value === 'function') {
    throw new Error(`${path} contains a function which cannot be serialized`)
  }

  if (typeof value === 'symbol') {
    throw new Error(`${path} contains a symbol which cannot be serialized`)
  }

  if (typeof value === 'undefined') {
    throw new Error(`${path} is undefined which cannot be serialized`)
  }

  // For objects and arrays, check recursively
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        validateJSONSerializable(value[i], `${path}[${i}]`)
      }
    } else {
      for (const [key, val] of Object.entries(value)) {
        validateJSONSerializable(val, `${path}.${key}`)
      }
    }
  }
}

/**
 * Agent state provides key-value storage outside conversation context.
 * State is not passed to the model during inference but is accessible
 * by tools (via ToolContext) and application logic.
 *
 * All values are deep copied on get/set operations to prevent reference mutations.
 * Values must be JSON serializable.
 *
 * @typeParam TState - Optional type for strongly typing state keys and values
 *
 * @example
 * ```typescript
 * const state = new AgentState({ userId: 'user-123' })
 * state.set('sessionId', 'session-456')
 * const userId = state.get('userId') // 'user-123'
 * ```
 */
export class AgentState<TState extends Record<string, JSONValue> = Record<string, JSONValue>> {
  private _state: Record<string, JSONValue>

  /**
   * Creates a new AgentState instance.
   *
   * @param initialState - Optional initial state values
   * @throws Error if initialState is not JSON serializable
   */
  constructor(initialState?: TState) {
    if (initialState !== undefined) {
      validateJSONSerializable(initialState, 'initialState')
      this._state = deepCopy(initialState) as Record<string, JSONValue>
    } else {
      this._state = {}
    }
  }

  /**
   * Get a state value by key, or all state if no key provided.
   * Returns a deep copy to prevent mutations.
   *
   * @param key - Optional key to retrieve specific value
   * @returns The value for the key, all state if no key provided, or undefined if key doesn't exist
   */
  get(key: string): JSONValue | Record<string, JSONValue> | undefined {
    if (key == null) {
      throw new Error('key is required')
    }

    const value = this._state[key]
    if (value === undefined) {
      return undefined
    }

    // Return deep copy to prevent mutations
    return deepCopy(value)
  }

  /**
   * Set a state value. Validates JSON serializability and stores a deep copy.
   *
   * @param key - The key to set
   * @param value - The value to store (must be JSON serializable)
   * @throws Error if value is not JSON serializable
   */
  set(key: string, value: unknown): void {
    validateJSONSerializable(value, `value for key "${key}"`)
    this._state[key] = deepCopy(value)
  }

  /**
   * Delete a state value by key.
   *
   * @param key - The key to delete
   */
  delete(key: string): void {
    delete this._state[key]
  }

  /**
   * Clear all state values.
   */
  clear(): void {
    this._state = {}
  }

  /**
   * Get a copy of all state as an object.
   *
   * @returns Deep copy of all state
   */
  getAll(): Record<string, JSONValue> {
    return deepCopy(this._state) as Record<string, JSONValue>
  }

  /**
   * Get all state keys.
   *
   * @returns Array of state keys
   */
  keys(): string[] {
    return Object.keys(this._state)
  }
}
