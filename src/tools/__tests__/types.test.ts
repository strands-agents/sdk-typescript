import { describe, it, expect } from 'vitest'
import type { JSONSchema } from '@/types/json'
import type { ToolSpec, ToolUse, ToolResultContent, ToolResultStatus, ToolResult, ToolChoice } from '@/tools/types'

describe('tool types', () => {
  describe('JSONSchema type', () => {
    it('accepts valid JSON schema object', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      }
      expect(schema.type).toBe('object')
    })

    it('accepts empty schema object', () => {
      const schema: JSONSchema = {}
      expect(schema).toBeDefined()
    })

    it('accepts nested schema structures', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
              city: { type: 'string' },
            },
          },
        },
      }
      expect(schema.properties).toBeDefined()
    })
  })

  describe('ToolSpec interface', () => {
    it('accepts valid tool spec with all required fields', () => {
      const spec: ToolSpec = {
        name: 'calculator',
        description: 'Performs mathematical calculations',
        inputSchema: {
          type: 'object',
          properties: {
            operation: { type: 'string' },
            a: { type: 'number' },
            b: { type: 'number' },
          },
        },
      }
      expect(spec.name).toBe('calculator')
      expect(spec.description).toBe('Performs mathematical calculations')
    })

    it('accepts tool spec with minimal schema', () => {
      const spec: ToolSpec = {
        name: 'notify',
        description: 'Sends a notification',
        inputSchema: {},
      }
      expect(spec.name).toBe('notify')
    })
  })

  describe('ToolUse interface', () => {
    it('accepts valid tool use with all fields', () => {
      const toolUse: ToolUse = {
        name: 'calculator',
        toolUseId: 'calc-123',
        input: { operation: 'add', a: 5, b: 3 },
      }
      expect(toolUse.name).toBe('calculator')
      expect(toolUse.toolUseId).toBe('calc-123')
    })

    it('accepts tool use with complex input', () => {
      const toolUse: ToolUse = {
        name: 'search',
        toolUseId: 'search-456',
        input: {
          query: 'TypeScript',
          filters: {
            date: '2024-01-01',
            category: 'programming',
          },
          limit: 10,
        },
      }
      expect(toolUse.input).toBeDefined()
    })

    it('accepts tool use with empty input', () => {
      const toolUse: ToolUse = {
        name: 'ping',
        toolUseId: 'ping-789',
        input: {},
      }
      expect(toolUse.input).toEqual({})
    })
  })

  describe('ToolResultContent type', () => {
    it('accepts content with text only', () => {
      const content: ToolResultContent = {
        type: 'text',
        text: 'Result: 42',
      }
      if (content.type === 'text') {
        expect(content.text).toBe('Result: 42')
      }
    })

    it('accepts content with json only', () => {
      const content: ToolResultContent = {
        type: 'json',
        json: { result: 42, unit: 'answer' },
      }
      if (content.type === 'json') {
        expect(content.json).toEqual({ result: 42, unit: 'answer' })
      }
    })
  })

  describe('ToolResultStatus type', () => {
    it('accepts "success" status', () => {
      const status: ToolResultStatus = 'success'
      expect(status).toBe('success')
    })

    it('accepts "error" status', () => {
      const status: ToolResultStatus = 'error'
      expect(status).toBe('error')
    })
  })

  describe('ToolResult interface', () => {
    it('accepts valid tool result with success status', () => {
      const result: ToolResult = {
        toolUseId: 'tool-123',
        status: 'success',
        content: [{ type: 'text', text: 'Operation completed' }],
      }
      expect(result.status).toBe('success')
      expect(result.content).toHaveLength(1)
    })

    it('accepts tool result with error status', () => {
      const result: ToolResult = {
        toolUseId: 'tool-456',
        status: 'error',
        content: [{ type: 'text', text: 'Division by zero error' }],
      }
      expect(result.status).toBe('error')
    })

    it('accepts tool result with multiple content blocks', () => {
      const result: ToolResult = {
        toolUseId: 'tool-789',
        status: 'success',
        content: [
          { type: 'text', text: 'Result summary' },
          { type: 'json', json: { data: [1, 2, 3] } },
        ],
      }
      expect(result.content).toHaveLength(2)
    })

    it('accepts tool result with empty content array', () => {
      const result: ToolResult = {
        toolUseId: 'tool-000',
        status: 'success',
        content: [],
      }
      expect(result.content).toHaveLength(0)
    })
  })

  describe('ToolChoice type', () => {
    it('accepts auto choice', () => {
      const choice: ToolChoice = { auto: {} }
      expect(choice.auto).toBeDefined()
    })

    it('accepts any choice', () => {
      const choice: ToolChoice = { any: {} }
      expect(choice.any).toBeDefined()
    })

    it('accepts specific tool choice', () => {
      const choice: ToolChoice = { tool: { name: 'calculator' } }
      expect(choice.tool?.name).toBe('calculator')
    })
  })
})
