import type { JSONSchema7 } from 'json-schema'

/**
 * Represents any valid JSON value.
 * This type ensures type safety for JSON-serializable data.
 */
export type JSONValue = string | number | boolean | null | { [key: string]: JSONValue } | JSONValue[]

/**
 * Represents a JSON Schema definition.
 * Used for defining the structure of tool inputs and outputs.
 *
 * This is based on JSON Schema Draft 7 specification.
 */
export type JSONSchema = JSONSchema7
