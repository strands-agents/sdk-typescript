import * as z4mini from 'zod/v4-mini'
import { z } from 'zod'
import type { JSONSchema } from '../types/json.js'
import type { ToolSpec } from '../tools/types.js'
import { StructuredOutputException } from './exceptions.js'

/**
 * Converts a Zod schema to a JSON Schema for use in tool specifications.
 *
 * @param schema - The Zod schema to convert
 * @returns JSON Schema representation of the Zod schema
 * @throws StructuredOutputException if the schema contains unsupported features
 */
export function convertSchemaToJsonSchema(schema: z.ZodSchema): JSONSchema {
  // Check for unsupported features (refinements and transforms)
  // Note: This is a basic check - Zod doesn't expose a clean way to detect these
  // We'll rely on the schema structure and _def property
  if (hasUnsupportedFeatures(schema)) {
    throw new StructuredOutputException(
      'Zod refinements and transforms are not supported in structured output schemas. Please use basic validation types only.'
    )
  }

  // Convert to JSON Schema using Zod v4's built-in toJSONSchema
  const result = z4mini.toJSONSchema(schema, { target: 'draft-7' })
  
  // Remove the $schema property and return the rest
  const { $schema, ...jsonSchema } = result as any

  return jsonSchema as JSONSchema
}

/**
 * Converts a Zod schema to a complete tool specification.
 *
 * @param schema - The Zod schema to convert
 * @param toolName - The name to use for the tool
 * @returns Complete tool specification
 */
export function convertSchemaToToolSpec(schema: z.ZodSchema, toolName: string): ToolSpec {
  const jsonSchema = convertSchemaToJsonSchema(schema)
  const schemaDescription = getSchemaDescription(schema)

  return {
    name: toolName,
    description: `IMPORTANT: This StructuredOutputTool should only be invoked as the last and final tool before returning the completed result to the caller. ${schemaDescription}`,
    inputSchema: jsonSchema,
  }
}

/**
 * Extracts a description from the Zod schema if available.
 *
 * @param schema - The Zod schema to extract description from
 * @returns The schema description or empty string if not available
 */
export function getSchemaDescription(schema: z.ZodSchema): string {
  // Try to get description from schema metadata
  if ('description' in schema && typeof schema.description === 'string') {
    return schema.description
  }

  // Check _def for description (common in Zod schemas)
  const def = (schema as any)._def
  if (def && typeof def.description === 'string') {
    return def.description
  }

  return ''
}

/**
 * Checks if a Zod schema contains unsupported features like refinements or transforms.
 *
 * @param schema - The Zod schema to check
 * @returns true if unsupported features are detected
 */
function hasUnsupportedFeatures(schema: z.ZodSchema): boolean {
  const def = (schema as any)._def

  if (!def) {
    return false
  }

  // Check for transforms (pipe type in Zod v4)
  if (def.type === 'pipe') {
    // Check if the output is a transform
    if (def.out && def.out.type === 'transform') {
      return true
    }
  }

  // Check for transforms directly
  if (def.type === 'transform') {
    return true
  }

  // Check for refinements (custom checks in Zod v4)
  if (def.checks && Array.isArray(def.checks)) {
    for (const check of def.checks) {
      if (check.type === 'custom' || check.def?.type === 'custom') {
        return true
      }
    }
  }

  // Check for ZodEffects (legacy Zod v3 style)
  if (def.typeName === 'ZodEffects') {
    return true
  }

  // Recursively check wrapped/inner types
  if (def.innerType) {
    return hasUnsupportedFeatures(def.innerType)
  }

  // Check pipe input/output
  if (def.in) {
    if (hasUnsupportedFeatures(def.in)) return true
  }
  if (def.out) {
    if (hasUnsupportedFeatures(def.out)) return true
  }

  // Check array element type
  if (def.type && typeof def.type === 'object') {
    return hasUnsupportedFeatures(def.type)
  }

  // Check object properties
  if (def.shape) {
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape
    for (const key in shape) {
      if (hasUnsupportedFeatures(shape[key])) {
        return true
      }
    }
  }

  // Check union options
  if (def.options && Array.isArray(def.options)) {
    return def.options.some((option: z.ZodSchema) => hasUnsupportedFeatures(option))
  }

  return false
}

/**
 * Extracts the tool name from a Zod schema variable name or uses a fallback.
 * This is a best-effort approach since JavaScript doesn't preserve variable names.
 *
 * @param schema - The Zod schema
 * @returns The extracted tool name or 'StructuredOutput' as fallback
 */
export function getToolNameFromSchema(schema: z.ZodSchema): string {
  // Try to get name from schema metadata
  const def = (schema as any)._def
  if (def && typeof def.name === 'string' && def.name.length > 0) {
    return def.name
  }

  // Fallback to generic name
  return 'StructuredOutput'
}
