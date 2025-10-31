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
 * Creates a deep copy of a value using JSON serialization.
 *
 * @param value - The value to copy
 * @returns A deep copy of the value
 * @throws Error if the value cannot be JSON serialized
 */
export function deepCopy(value: unknown): JSONValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JSONValue
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to serialize tool result: ${errorMessage}`)
  }
}
