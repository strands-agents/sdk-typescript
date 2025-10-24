import type { JSONSchema7 } from 'json-schema'

/**
 * Represents any valid JSON value.
 * This type ensures type safety for JSON-serializable data.
 *
 * @example
 * ```typescript
 * const value: JSONValue = { key: 'value', nested: { arr: [1, 2, 3] } }
 * const text: JSONValue = 'hello'
 * const num: JSONValue = 42
 * const bool: JSONValue = true
 * const nothing: JSONValue = null
 * ```
 */
export type JSONValue = string | number | boolean | null | { [key: string]: JSONValue } | JSONValue[]

/**
 * Represents a JSON Schema definition.
 * Used for defining the structure of tool inputs and outputs.
 *
 * This is based on JSON Schema Draft 7 specification.
 *
 * @example
 * ```typescript
 * const schema: JSONSchema = {
 *   type: 'object',
 *   properties: {
 *     name: { type: 'string' },
 *     age: { type: 'number' }
 *   },
 *   required: ['name']
 * }
 * ```
 */
export type JSONSchema = JSONSchema7

/**
 * Creates a deep copy of a JSON-serializable value.
 * Ensures that the returned value is immutable from the original.
 *
 * Uses JSON serialization to create the copy, which has the benefit of
 * detecting and rejecting non-JSON-serializable values like circular
 * references and functions.
 *
 * @param value - The value to copy
 * @returns A deep copy of the value
 * @throws Error if the value cannot be serialized to JSON (circular references, functions, etc.)
 *
 * @example
 * ```typescript
 * const original = { nested: { value: 'test' } }
 * const copy = deepCopyJson(original)
 * original.nested.value = 'changed'
 * console.log(copy.nested.value) // 'test' - copy is unchanged
 * ```
 */
export function deepCopyJson(value: unknown): JSONValue {
  // First, try to detect if value contains functions or other non-serializable types
  // JSON.stringify will silently drop functions, so we need to check for this
  if (typeof value === 'object' && value !== null) {
    // Check if it's an object or array with non-serializable properties
    const stringified = JSON.stringify(value)
    const parsed = JSON.parse(stringified)

    // If the value is an array, check if lengths match
    if (Array.isArray(value) && Array.isArray(parsed)) {
      if (value.length !== parsed.length) {
        throw new Error('Unable to serialize tool result: Array contains non-serializable values')
      }
    }

    // If the value is an object, check if keys match
    if (!Array.isArray(value) && typeof parsed === 'object') {
      const originalKeys = Object.keys(value).sort()
      const parsedKeys = Object.keys(parsed).sort()

      if (originalKeys.length !== parsedKeys.length || !originalKeys.every((key, i) => key === parsedKeys[i])) {
        throw new Error(
          'Unable to serialize tool result: Object contains non-serializable values (functions, symbols, etc.)'
        )
      }
    }

    return parsed as JSONValue
  }

  // For primitives, just use JSON serialization
  try {
    return JSON.parse(JSON.stringify(value)) as JSONValue
  } catch (error) {
    // Value is not JSON-serializable (e.g., circular reference)
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to serialize tool result: ${errorMessage}`)
  }
}
