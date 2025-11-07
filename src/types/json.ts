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

/**
 * Creates a deep copy of a value with explicit validation for non-serializable types.
 * Uses JSON.stringify's replacer to detect and report non-serializable values with path information.
 *
 * @param value - The value to copy
 * @param contextPath - Context path for error messages (e.g., 'initialState', 'value for key "config"')
 * @returns A deep copy of the value
 * @throws Error if value contains functions, symbols, or undefined values
 */
export function deepCopyWithValidation(value: unknown, contextPath: string = 'value'): JSONValue {
  const pathStack: string[] = []

  const replacer = (key: string, val: unknown): unknown => {
    // Build current path
    let currentPath = contextPath
    if (key !== '') {
      // Check if parent is array (numeric key pattern)
      const isArrayIndex = /^\d+$/.test(key)
      if (isArrayIndex) {
        currentPath = pathStack.length > 0 ? `${pathStack[pathStack.length - 1]}[${key}]` : `${contextPath}[${key}]`
      } else {
        currentPath = pathStack.length > 0 ? `${pathStack[pathStack.length - 1]}.${key}` : `${contextPath}.${key}`
      }
    }

    // Check for non-serializable types
    if (typeof val === 'function') {
      throw new Error(`${currentPath} contains a function which cannot be serialized`)
    }

    if (typeof val === 'symbol') {
      throw new Error(`${currentPath} contains a symbol which cannot be serialized`)
    }

    if (val === undefined) {
      throw new Error(`${currentPath} is undefined which cannot be serialized`)
    }

    // Track path for nested objects/arrays
    if (val !== null && typeof val === 'object') {
      pathStack.push(currentPath)
    }

    return val
  }

  try {
    const serialized = JSON.stringify(value, replacer)
    pathStack.length = 0 // Clean up
    return JSON.parse(serialized) as JSONValue
  } catch (error) {
    // If it's our validation error, re-throw it
    if (error instanceof Error && error.message.includes('cannot be serialized')) {
      throw error
    }
    // Otherwise, wrap it
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to serialize value: ${errorMessage}`)
  }
}
