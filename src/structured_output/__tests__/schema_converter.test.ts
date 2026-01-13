import { describe, it, expect } from 'vitest'
import {
  convertSchemaToJsonSchema,
  convertSchemaToToolSpec,
  getSchemaDescription,
  getToolNameFromSchema,
} from '../schema_converter.js'
import { z } from 'zod'
import { StructuredOutputException } from '../exceptions.js'

describe('convertSchemaToJsonSchema', () => {
  it('converts simple object schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      active: z.boolean(),
    })

    const jsonSchema = convertSchemaToJsonSchema(schema)

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.properties).toBeDefined()
    expect(jsonSchema.properties?.name).toEqual({ type: 'string' })
    expect(jsonSchema.properties?.age).toEqual({ type: 'number' })
    expect(jsonSchema.properties?.active).toEqual({ type: 'boolean' })
    expect(jsonSchema.required).toEqual(['name', 'age', 'active'])
  })

  it('converts schema with optional fields', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    })

    const jsonSchema = convertSchemaToJsonSchema(schema)

    expect(jsonSchema.required).toEqual(['required'])
    expect(jsonSchema.required).not.toContain('optional')
  })

  it('converts array schema', () => {
    const schema = z.array(z.string())

    const jsonSchema = convertSchemaToJsonSchema(schema)

    expect(jsonSchema.type).toBe('array')
    expect(jsonSchema.items).toEqual({ type: 'string' })
  })

  it('converts nested object schema', () => {
    const schema = z.object({
      person: z.object({
        name: z.string(),
        age: z.number(),
      }),
    })

    const jsonSchema = convertSchemaToJsonSchema(schema)

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.properties?.person).toBeDefined()
    const personSchema = jsonSchema.properties?.person as any
    expect(personSchema.type).toBe('object')
    expect(personSchema.properties?.name).toEqual({ type: 'string' })
    expect(personSchema.properties?.age).toEqual({ type: 'number' })
  })

  it('converts union types', () => {
    const schema = z.union([z.string(), z.number()])

    const jsonSchema = convertSchemaToJsonSchema(schema)

    // Union is represented as anyOf in JSON Schema
    expect(jsonSchema.anyOf).toBeDefined()
    expect(jsonSchema.anyOf).toHaveLength(2)
  })

  it('converts schema with descriptions', () => {
    const schema = z.object({
      name: z.string().describe('The person name'),
      age: z.number().describe('The person age'),
    })

    const jsonSchema = convertSchemaToJsonSchema(schema)

    expect(jsonSchema.properties?.name).toHaveProperty('description', 'The person name')
    expect(jsonSchema.properties?.age).toHaveProperty('description', 'The person age')
  })

  it('throws error for schema with refinements', () => {
    const schema = z.string().refine((val) => val.length > 5, {
      message: 'String must be longer than 5 characters',
    })

    expect(() => convertSchemaToJsonSchema(schema)).toThrow(StructuredOutputException)
    expect(() => convertSchemaToJsonSchema(schema)).toThrow('Zod refinements and transforms are not supported')
  })

  it('throws error for schema with transforms', () => {
    const schema = z.string().transform((val) => val.toUpperCase())

    expect(() => convertSchemaToJsonSchema(schema)).toThrow(StructuredOutputException)
    expect(() => convertSchemaToJsonSchema(schema)).toThrow('Zod refinements and transforms are not supported')
  })

  it('throws error for nested schema with refinements', () => {
    const schema = z.object({
      name: z.string().refine((val) => val.length > 0),
    })

    expect(() => convertSchemaToJsonSchema(schema)).toThrow(StructuredOutputException)
  })
})

describe('convertSchemaToToolSpec', () => {
  it('generates complete tool spec', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })

    const toolSpec = convertSchemaToToolSpec(schema, 'PersonSchema')

    expect(toolSpec.name).toBe('PersonSchema')
    expect(toolSpec.description).toContain('StructuredOutputTool')
    expect(toolSpec.description).toContain('last and final tool')
    expect(toolSpec.inputSchema).toBeDefined()
    expect(toolSpec.inputSchema?.type).toBe('object')
  })

  it('includes schema description in tool spec', () => {
    const schema = z.object({ name: z.string() }).describe('A person object')

    const toolSpec = convertSchemaToToolSpec(schema, 'PersonSchema')

    expect(toolSpec.description).toContain('A person object')
  })

  it('works without schema description', () => {
    const schema = z.object({ name: z.string() })

    const toolSpec = convertSchemaToToolSpec(schema, 'PersonSchema')

    expect(toolSpec.description).toContain('StructuredOutputTool')
    expect(toolSpec.name).toBe('PersonSchema')
  })
})

describe('getSchemaDescription', () => {
  it('extracts description from schema', () => {
    const schema = z.object({ name: z.string() }).describe('Test description')

    const description = getSchemaDescription(schema)

    expect(description).toBe('Test description')
  })

  it('returns empty string for schema without description', () => {
    const schema = z.object({ name: z.string() })

    const description = getSchemaDescription(schema)

    expect(description).toBe('')
  })
})

describe('getToolNameFromSchema', () => {
  it('returns fallback name', () => {
    const schema = z.object({ name: z.string() })

    const toolName = getToolNameFromSchema(schema)

    // Without special metadata, should return fallback
    expect(toolName).toBe('StructuredOutput')
  })

  it('uses fallback for anonymous schema', () => {
    const anonymousSchema = z.string()

    const toolName = getToolNameFromSchema(anonymousSchema)

    expect(toolName).toBe('StructuredOutput')
  })
})
