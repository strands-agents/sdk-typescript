import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { StructuredOutputTool } from '../structured-output-tool.js'
import { createMockContext } from '../../../__fixtures__/tool-helpers.js'
import { collectGenerator } from '../../../__fixtures__/model-test-helpers.js'

const SimpleSchema = z
  .object({
    name: z.string().describe('Name field'),
    value: z.number().describe('Value field'),
  })
  .describe('SimpleModel')

const ComplexSchema = z
  .object({
    title: z.string().describe('Title field'),
    count: z.number().min(0).max(100).describe('Count between 0 and 100'),
    tags: z.array(z.string()).default([]).describe('List of tags'),
    metadata: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .nullable()
      .optional()
      .describe('Optional metadata'),
  })
  .describe('ComplexModel')

const ValidationSchema = z
  .object({
    email: z.string().email().describe('Email address'),
    age: z.number().min(0).max(150).describe('Age between 0 and 150'),
    status: z.enum(['active', 'inactive', 'pending']).describe('Status'),
  })
  .describe('ValidationTestModel')

describe('StructuredOutputTool', () => {
  describe('initialization', () => {
    it('initializes with simple schema and derives name from describe()', () => {
      const storeResult = (): void => {}
      const tool = new StructuredOutputTool({ schema: SimpleSchema, storeResult })
      expect(tool.name).toBe('SimpleModel')
      expect(tool.toolSpec.name).toBe('SimpleModel')
      expect(tool.toolSpec.description).toContain('IMPORTANT: This StructuredOutputTool should only be invoked')
      expect(tool.toolSpec.inputSchema).toBeDefined()
    })

    it('initializes with complex schema', () => {
      const storeResult = (): void => {}
      const tool = new StructuredOutputTool({ schema: ComplexSchema, storeResult })
      expect(tool.name).toBe('ComplexModel')
      expect(tool.toolSpec.name).toBe('ComplexModel')
    })

    it('uses explicit name when provided', () => {
      const storeResult = (): void => {}
      const tool = new StructuredOutputTool({
        schema: SimpleSchema,
        name: 'CustomTool',
        storeResult,
      })
      expect(tool.name).toBe('CustomTool')
      expect(tool.toolSpec.name).toBe('CustomTool')
    })

    it('sanitizes invalid name to valid tool name', () => {
      const storeResult = (): void => {}
      const tool = new StructuredOutputTool({
        schema: SimpleSchema,
        name: 'My Tool Name!',
        storeResult,
      })
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]+$/)
      expect(tool.name.length).toBeLessThanOrEqual(64)
    })

    it('toolSpec includes IMPORTANT message and description', () => {
      const storeResult = (): void => {}
      const tool = new StructuredOutputTool({ schema: SimpleSchema, storeResult })
      const spec = tool.toolSpec
      expect(spec.description).toContain('IMPORTANT: This StructuredOutputTool should only be invoked')
      expect(spec.description).toContain('last and final tool')
      expect(spec.description).toContain('<description>')
      expect(spec.description).toContain('</description>')
    })
  })

  describe('stream', () => {
    it('validates valid input and stores result via callback', async () => {
      const stored: Array<{ id: string; value: unknown }> = []
      const storeResult = (toolUseId: string, value: unknown): void => {
        stored.push({ id: toolUseId, value })
      }
      const tool = new StructuredOutputTool({ schema: SimpleSchema, storeResult })
      const context = createMockContext({
        name: 'SimpleModel',
        toolUseId: 'test_123',
        input: { name: 'Test Name', value: 42 },
      })

      const { items, result } = await collectGenerator(tool.stream(context))

      expect(items).toHaveLength(1)
      expect(result.status).toBe('success')
      expect(result.content[0]).toMatchObject({
        type: 'textBlock',
        text: expect.stringContaining('Successfully validated'),
      })
      expect(stored).toHaveLength(1)
      expect(stored[0]?.id).toBe('test_123')
      expect(stored[0]?.value).toStrictEqual({ name: 'Test Name', value: 42 })
    })

    it('returns error result when required fields are missing', async () => {
      const storeResult = (): void => {}
      const tool = new StructuredOutputTool({ schema: SimpleSchema, storeResult })
      const context = createMockContext({
        name: 'SimpleModel',
        toolUseId: 'test_789',
        input: { name: 'Test Name' },
      })

      const { items, result } = await collectGenerator(tool.stream(context))
      expect(items).toHaveLength(1)

      expect(result.status).toBe('error')
      expect(result.content[0]).toMatchObject({
        type: 'textBlock',
        text: expect.stringContaining('Validation failed for SimpleModel'),
      })
      const text = (result.content[0] as { text: string }).text
      expect(text).toMatch(/value|required/i)
    })

    it('returns error result when type is wrong', async () => {
      const storeResult = (): void => {}
      const tool = new StructuredOutputTool({ schema: SimpleSchema, storeResult })
      const context = createMockContext({
        name: 'SimpleModel',
        toolUseId: 'test_format_1',
        input: { name: 'Test', value: 'not an integer' },
      })

      const { items, result } = await collectGenerator(tool.stream(context))
      expect(items).toHaveLength(1)

      expect(result.status).toBe('error')
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('Validation failed for SimpleModel')
      expect(text).toContain("Field 'value'")
    })

    it('formats multiple validation errors', async () => {
      const storeResult = (): void => {}
      const tool = new StructuredOutputTool({ schema: ValidationSchema, storeResult })
      const context = createMockContext({
        name: 'ValidationTestModel',
        toolUseId: 'test_format_2',
        input: { email: 'bad-email', age: -5, status: 'invalid' },
      })

      const { items, result } = await collectGenerator(tool.stream(context))
      expect(items).toHaveLength(1)

      expect(result.status).toBe('error')
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('Validation failed for ValidationTestModel')
      expect(text).toContain('Please fix the following errors:')
      const errorLines = text.split('\n').filter((line) => line.startsWith('- Field'))
      expect(errorLines.length).toBeGreaterThanOrEqual(2)
    })

    it('handles complex nested data successfully', async () => {
      const stored: Array<{ id: string; value: unknown }> = []
      const storeResult = (toolUseId: string, value: unknown): void => {
        stored.push({ id: toolUseId, value })
      }
      const tool = new StructuredOutputTool({ schema: ComplexSchema, storeResult })
      const context = createMockContext({
        name: 'ComplexModel',
        toolUseId: 'test_complex',
        input: {
          title: 'Test Title',
          count: 50,
          tags: ['tag1', 'tag2', 'tag3'],
          metadata: { key1: 'value1', key2: 123 },
        },
      })

      const { items, result } = await collectGenerator(tool.stream(context))
      expect(items).toHaveLength(1)

      expect(result.status).toBe('success')
      expect(stored[0]?.value).toStrictEqual({
        title: 'Test Title',
        count: 50,
        tags: ['tag1', 'tag2', 'tag3'],
        metadata: { key1: 'value1', key2: 123 },
      })
    })

    it('returns error when storeResult callback throws', async () => {
      const storeResult = (): void => {
        throw new Error('Unexpected error')
      }
      const tool = new StructuredOutputTool({ schema: SimpleSchema, storeResult })
      const context = createMockContext({
        name: 'SimpleModel',
        toolUseId: 'test_error',
        input: { name: 'Test', value: 1 },
      })

      const { items, result } = await collectGenerator(tool.stream(context))
      expect(items).toHaveLength(1)

      expect(result.status).toBe('error')
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('Unexpected error validating SimpleModel')
      expect(text).toContain('Unexpected error')
    })

    it('handles non-object input by parsing as empty object', async () => {
      const storeResult = (): void => {}
      const tool = new StructuredOutputTool({ schema: SimpleSchema, storeResult })
      const context = createMockContext({
        name: 'SimpleModel',
        toolUseId: 'test_non_object',
        input: 'not an object',
      })

      const { items, result } = await collectGenerator(tool.stream(context))
      expect(items).toHaveLength(1)

      expect(result.status).toBe('error')
    })
  })
})
