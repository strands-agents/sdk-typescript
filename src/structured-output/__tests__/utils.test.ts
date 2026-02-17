import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { convertSchemaToToolSpec, getSchemaDescription, getToolNameFromSchema } from '../utils.js'
import { StructuredOutputException } from '../exceptions.js'

describe('convertSchemaToToolSpec', () => {
  it('converts basic schema to tool spec', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })

    const toolSpec = convertSchemaToToolSpec(schema, 'TestTool')

    expect(toolSpec.name).toBe('TestTool')
    expect(toolSpec.description).toContain('StructuredOutputTool')
    expect(toolSpec.inputSchema).toStrictEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
      additionalProperties: false,
    })
  })

  it('includes schema description in tool spec', () => {
    const schema = z
      .object({
        name: z.string(),
      })
      .describe('A person object')

    const toolSpec = convertSchemaToToolSpec(schema, 'TestTool')

    expect(toolSpec.description).toContain('A person object')
  })

  it('throws error for schema with refinements', () => {
    const schema = z.object({
      name: z.string().refine((val) => val.length > 0, 'Name cannot be empty'),
    })

    expect(() => convertSchemaToToolSpec(schema, 'TestTool')).toThrow(StructuredOutputException)
    expect(() => convertSchemaToToolSpec(schema, 'TestTool')).toThrow(
      'Zod refinements and transforms are not supported'
    )
  })

  it('throws error for schema with transforms', () => {
    const schema = z.string().transform((val) => val.toUpperCase())

    expect(() => convertSchemaToToolSpec(schema, 'TestTool')).toThrow(StructuredOutputException)
    expect(() => convertSchemaToToolSpec(schema, 'TestTool')).toThrow(
      'Zod refinements and transforms are not supported'
    )
  })

  it('throws error for schema with superRefine', () => {
    const schema = z.object({ name: z.string() }).superRefine((val, ctx) => {
      if (val.name.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Name required' })
      }
    })

    expect(() => convertSchemaToToolSpec(schema, 'TestTool')).toThrow(StructuredOutputException)
  })

  it('accepts schema with basic validations', () => {
    const schema = z.object({
      name: z.string().min(1).max(100),
      age: z.number().int().positive(),
      email: z.string().email(),
    })

    const toolSpec = convertSchemaToToolSpec(schema, 'TestTool')

    expect(toolSpec.inputSchema).toBeDefined()
    expect(toolSpec.inputSchema?.type).toBe('object')
    expect(toolSpec.inputSchema?.properties).toBeDefined()
    expect(toolSpec.inputSchema?.properties?.name).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 100,
    })
    expect(toolSpec.inputSchema?.properties?.age).toMatchObject({
      type: 'integer',
    })
    expect(toolSpec.inputSchema?.properties?.email).toMatchObject({
      type: 'string',
      format: 'email',
    })
  })

  it('throws error for nested schema with refinements', () => {
    const schema = z.object({
      user: z.object({
        name: z.string().refine((val) => val.length > 0),
      }),
    })

    expect(() => convertSchemaToToolSpec(schema, 'TestTool')).toThrow(StructuredOutputException)
  })

  it('accepts nested schema without refinements', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        age: z.number(),
      }),
      items: z.array(z.string()),
    })

    const toolSpec = convertSchemaToToolSpec(schema, 'TestTool')

    expect(toolSpec.inputSchema).toStrictEqual({
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name', 'age'],
          additionalProperties: false,
        },
        items: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['user', 'items'],
      additionalProperties: false,
    })
  })

  it('throws error for array with refinements', () => {
    const schema = z.array(z.string().refine((val) => val.length > 0))

    expect(() => convertSchemaToToolSpec(schema, 'TestTool')).toThrow(StructuredOutputException)
  })

  it('accepts union types', () => {
    const schema = z.union([z.string(), z.number()])

    expect(() => convertSchemaToToolSpec(schema, 'TestTool')).not.toThrow()
  })

  it('accepts optional fields', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
    })

    const toolSpec = convertSchemaToToolSpec(schema, 'TestTool')

    expect(toolSpec.inputSchema).toStrictEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
      additionalProperties: false,
    })
  })

  it('throws error for deeply nested refinements', () => {
    const schema = z.object({
      level1: z.object({
        level2: z.object({
          level3: z.string().refine((val) => val.length > 0),
        }),
      }),
    })

    expect(() => convertSchemaToToolSpec(schema, 'TestTool')).toThrow(StructuredOutputException)
  })

  it('throws error for refinements in union types', () => {
    const schema = z.union([z.string().refine((val) => val.length > 0), z.number()])

    expect(() => convertSchemaToToolSpec(schema, 'TestTool')).toThrow(StructuredOutputException)
  })

  it('throws error for refinements in array items', () => {
    const schema = z.object({
      items: z.array(
        z.object({
          name: z.string().refine((val) => val.length > 0),
        })
      ),
    })

    expect(() => convertSchemaToToolSpec(schema, 'TestTool')).toThrow(StructuredOutputException)
  })
})

describe('getSchemaDescription', () => {
  it('returns description from schema metadata', () => {
    const schema = z.object({ name: z.string() }).describe('Test description')

    const description = getSchemaDescription(schema)

    expect(description).toBe('Test description')
  })

  it('returns empty string when no description', () => {
    const schema = z.object({ name: z.string() })

    const description = getSchemaDescription(schema)

    expect(description).toBe('')
  })

  it('returns description from _def', () => {
    const schema = z.object({ name: z.string() })
    // Manually set description in _def
    ;(schema as any)._def.description = 'Description in _def'

    const description = getSchemaDescription(schema)

    expect(description).toBe('Description in _def')
  })
})

describe('getToolNameFromSchema', () => {
  it('returns fallback name when no metadata', () => {
    const schema = z.object({ name: z.string() })

    const toolName = getToolNameFromSchema(schema)

    expect(toolName).toBe('StructuredOutput')
  })

  it('returns name from _def metadata', () => {
    const schema = z.object({ name: z.string() })
    // Manually set name in _def
    ;(schema as any)._def.name = 'CustomName'

    const toolName = getToolNameFromSchema(schema)

    expect(toolName).toBe('CustomName')
  })

  it('returns fallback when name is empty string', () => {
    const schema = z.object({ name: z.string() })
    ;(schema as any)._def.name = ''

    const toolName = getToolNameFromSchema(schema)

    expect(toolName).toBe('StructuredOutput')
  })
})
