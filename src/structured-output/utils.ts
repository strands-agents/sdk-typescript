import { z } from 'zod'
import type { ToolSpec } from '../tools/types.js'
import { StructuredOutputException } from './exceptions.js'
import { zodSchemaToJsonSchema } from '../utils/zod.js'

/**
 * Converts a Zod schema to a complete tool specification.
 *
 * Validates that the schema doesn't contain refinements or transforms, which cannot be
 * properly represented in JSON Schema. Refinements are silently dropped by z.toJSONSchema(),
 * creating a mismatch between what the LLM sees and what validation enforces.
 *
 * @param schema - The Zod schema to convert
 * @param toolName - The name to use for the tool
 * @returns Complete tool specification
 * @throws StructuredOutputException if the schema contains unsupported features
 */
export function convertSchemaToToolSpec(schema: z.ZodSchema, toolName: string): ToolSpec {
  if (hasUnsupportedFeatures(schema)) {
    throw new StructuredOutputException(
      'Zod refinements and transforms are not supported in structured output schemas. Please use basic validation types only.'
    )
  }

  const jsonSchema = zodSchemaToJsonSchema(schema)
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
  const def = (schema as { _def?: { description?: string } })._def
  if (def && typeof def.description === 'string') {
    return def.description
  }

  return ''
}

/**
 * Checks if a Zod schema contains unsupported features like refinements or transforms.
 * These features cannot be properly represented in JSON Schema for the LLM.
 *
 * @param schema - The Zod schema to check
 * @returns true if unsupported features are detected
 */
function hasUnsupportedFeatures(schema: z.ZodSchema): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema as any)._def

  if (!def) {
    return false
  }

  // Check for transforms
  if (def.type === 'pipe' || def.type === 'transform') {
    return true
  }

  // Check for refinements
  if (def.checks?.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const check of def.checks as any[]) {
      if (check.type === 'custom') {
        return true
      }
    }

    // superRefine() creates checks without 'type' at object/array level
    if ((def.type === 'object' || def.type === 'array') && def.checks.some((c: any) => !c.type)) {
      return true
    }
  }

  // Collect nested schemas to check recursively
  const nested: unknown[] = []

  if (def.innerType) nested.push(def.innerType)
  if (def.in) nested.push(def.in)
  if (def.out) nested.push(def.out)
  if (def.element) nested.push(def.element)
  if (def.type) nested.push(def.type)

  if (def.shape) {
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape
    nested.push(...Object.values(shape))
  }

  if (def.options) {
    nested.push(...def.options)
  }

  // Check all nested schemas
  for (const item of nested) {
    if (item && typeof item === 'object' && '_def' in item && hasUnsupportedFeatures(item as z.ZodSchema)) {
      return true
    }
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
  const def = (schema as { _def?: { name?: string } })._def
  if (def && typeof def.name === 'string' && def.name.length > 0) {
    return def.name
  }

  // Fallback to generic name
  return 'StructuredOutput'
}
