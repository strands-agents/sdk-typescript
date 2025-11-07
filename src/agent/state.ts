import { deepCopy, type JSONValue } from '../types/json.js'

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
