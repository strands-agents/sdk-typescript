import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { tool } from '../tool-factory.js'
import { Tool } from '../tool.js'

describe('tool factory', () => {
  describe('dispatch logic', () => {
    it('creates ZodTool when inputSchema is a Zod type', () => {
      const myTool = tool({
        name: 'zod',
        description: 'Zod',
        inputSchema: z.object({ x: z.string() }),
        callback: (input) => input.x,
      })

      // ZodTool generates JSON schema from Zod with additionalProperties: false
      expect(myTool.toolSpec.inputSchema).toHaveProperty('additionalProperties', false)
    })

    it('creates FunctionTool when inputSchema is a plain object', () => {
      const schema = { type: 'object' as const, properties: { x: { type: 'string' as const } } }
      const myTool = tool({
        name: 'json',
        description: 'JSON',
        inputSchema: schema,
        callback: () => 'ok',
      })

      // JSON schema is passed through as-is
      expect(myTool.toolSpec.inputSchema).toStrictEqual(schema)
    })

    it('creates FunctionTool when inputSchema is omitted', () => {
      const myTool = tool({
        name: 'noSchema',
        description: 'No schema',
        callback: () => 'ok',
      })

      expect(myTool.toolSpec.inputSchema).toStrictEqual({
        type: 'object',
        properties: {},
        additionalProperties: false,
      })
    })
  })

  describe('FunctionTool invoke()', () => {
    it('handles synchronous callback', async () => {
      const myTool = tool({
        name: 'sync',
        description: 'Sync',
        inputSchema: { type: 'object' },
        callback: (input) => {
          const { a, b } = input as { a: number; b: number }
          return a + b
        },
      })

      expect(await myTool.invoke({ a: 5, b: 3 })).toBe(8)
    })

    it('handles promise callback', async () => {
      const myTool = tool({
        name: 'async',
        description: 'Async',
        inputSchema: { type: 'object' },
        callback: async (input) => `Result: ${(input as { value: string }).value}`,
      })

      expect(await myTool.invoke({ value: 'test' })).toBe('Result: test')
    })

    it('handles async generator callback', async () => {
      const myTool = tool({
        name: 'gen',
        description: 'Generator',
        inputSchema: { type: 'object' },
        callback: async function* (input) {
          const { count } = input as { count: number }
          for (let i = 1; i <= count; i++) {
            yield i
          }
          return 0
        },
      })

      expect(await myTool.invoke({ count: 3 })).toBe(0)
    })

    it('passes instanceof Tool check', () => {
      const myTool = tool({
        name: 'test',
        description: 'test',
        inputSchema: { type: 'object' },
        callback: () => 'ok',
      })

      expect(myTool instanceof Tool).toBe(true)
    })

    it('defaults description to empty string', () => {
      const myTool = tool({
        name: 'test',
        description: '',
        inputSchema: { type: 'object' },
        callback: () => 'ok',
      })

      expect(myTool.description).toBe('')
    })
  })

  describe('DerivedTool (inputSchema as existing tool)', () => {
    const zodTool = tool({
      name: 'zod_tool',
      description: 'A Zod schema tool',
      inputSchema: z.object({ url: z.string().url(), method: z.enum(['GET', 'POST']) }),
      callback: async (input) => ({ fetched: input.url, method: input.method }),
    })

    const functionTool = tool({
      name: 'function_tool',
      description: 'A JSON schema tool',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      callback: (input) => `got ${(input as { x: number }).x}`,
    })

    it('inherits input schema and defaults description from source tool', () => {
      const derived = tool({
        name: 'derived_tool',
        inputSchema: zodTool,
        callback: async (input) => input.url,
      })

      expect(derived).toBeInstanceOf(Tool)
      expect(derived.name).toBe('derived_tool')
      expect(derived.description).toBe('A Zod schema tool')
      expect(derived.toolSpec.inputSchema).toStrictEqual(zodTool.toolSpec.inputSchema)
    })

    it('overrides description when provided', () => {
      const derived = tool({
        name: 'derived',
        description: 'Custom description',
        inputSchema: zodTool,
        callback: async (input) => input.url,
      })

      expect(derived.description).toBe('Custom description')
    })

    it('delegates to source tool with typed input', async () => {
      const derived = tool({
        name: 'derived',
        inputSchema: zodTool,
        callback: async (input, context) => {
          const result = await zodTool.invoke(input, context)
          return { ...result, wrapped: true }
        },
      })

      const result = await derived.invoke({ url: 'https://example.com', method: 'POST' })
      expect(result).toStrictEqual({ fetched: 'https://example.com', method: 'POST', wrapped: true })
    })

    it('inherits input schema from a FunctionTool source', async () => {
      const derived = tool({
        name: 'derived_json',
        inputSchema: functionTool,
        callback: (input) => `wrapped: ${(input as { x: number }).x}`,
      })

      expect(derived.toolSpec.inputSchema).toStrictEqual(functionTool.toolSpec.inputSchema)
      expect(await derived.invoke({ x: 42 })).toBe('wrapped: 42')
    })

    it('preserves Zod validation from source ZodTool', async () => {
      const derived = tool({
        name: 'derived',
        inputSchema: zodTool,
        callback: async (input) => input.url,
      })

      await expect(derived.invoke({ url: 'not-a-url', method: 'GET' })).rejects.toThrow()
    })
  })
})
