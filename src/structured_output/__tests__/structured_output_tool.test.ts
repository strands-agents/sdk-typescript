import { describe, it, expect, beforeEach } from 'vitest'
import { StructuredOutputTool } from '../structured_output_tool.js'
import { z } from 'zod'
import { StructuredOutputContext } from '../structured_output_context.js'

describe('StructuredOutputTool', () => {
  const PersonSchema = z.object({
    name: z.string().describe('Name of the person'),
    age: z.number().describe('Age of the person'),
    occupation: z.string().describe('Occupation of the person'),
  })

  let tool: StructuredOutputTool
  let context: StructuredOutputContext

  beforeEach(() => {
    context = new StructuredOutputContext(PersonSchema)
    tool = new StructuredOutputTool(PersonSchema, 'PersonSchema', context)
  })

  describe('toolSpec', () => {
    it('generates correct tool name', () => {
      expect(tool.toolSpec.name).toBe('PersonSchema')
      expect(tool.name).toBe('PersonSchema')
    })

    it('includes structured output description', () => {
      expect(tool.toolSpec.description).toContain('StructuredOutputTool')
      expect(tool.toolSpec.description).toContain('last and final tool')
    })

    it('includes input schema from Zod schema', () => {
      expect(tool.toolSpec.inputSchema).toBeDefined()
      expect(tool.toolSpec.inputSchema?.type).toBe('object')
      expect(tool.toolSpec.inputSchema?.properties).toBeDefined()
      expect(tool.toolSpec.inputSchema?.properties?.name).toBeDefined()
      expect(tool.toolSpec.inputSchema?.properties?.age).toBeDefined()
      expect(tool.toolSpec.inputSchema?.properties?.occupation).toBeDefined()
    })

    it('includes field descriptions in schema', () => {
      const nameSchema = tool.toolSpec.inputSchema?.properties?.name as any
      expect(nameSchema.description).toBe('Name of the person')
    })
  })

  describe('stream', () => {
    it('validates and stores valid input', async () => {
      const validInput = {
        name: 'John Doe',
        age: 30,
        occupation: 'Engineer',
      }

      const toolContext = {
        toolUse: {
          name: 'PersonSchema',
          toolUseId: 'tool-123',
          input: validInput,
        },
        agent: { state: {}, messages: [] } as any,
      }

      const generator = tool.stream(toolContext)
      const result = await generator.next()

      expect(result.done).toBe(true)
      expect(result.value).toBeDefined()
      if (result.value && 'toolUseId' in result.value) {
        expect(result.value.toolUseId).toBe('tool-123')
        expect(result.value.status).toBe('success')
      }
      // Phase 2: Extract the result (simulating what agent does after tool execution)
      context.extractResult(['tool-123'])
      expect(context.getResult()).toEqual(validInput)
    })

    it('returns error for invalid input type', async () => {
      const invalidInput = {
        name: 'John Doe',
        age: 'thirty', // Wrong type - should be number
        occupation: 'Engineer',
      }

      const toolContext = {
        toolUse: {
          name: 'PersonSchema',
          toolUseId: 'tool-456',
          input: invalidInput,
        },
        agent: { state: {}, messages: [] } as any,
      }

      const generator = tool.stream(toolContext)
      const result = await generator.next()

      expect(result.done).toBe(true)
      if (result.value && 'status' in result.value) {
        expect(result.value.status).toBe('error')
        expect(result.value.content).toHaveLength(1)

        const errorContent = result.value.content[0] as any
        expect(errorContent.text).toContain('Validation failed')
        expect(errorContent.text).toContain('PersonSchema')
        expect(errorContent.text).toContain("Field 'age'")
      }
    })

    it('returns error for missing required field', async () => {
      const invalidInput = {
        name: 'John Doe',
        // Missing age and occupation
      }

      const toolContext = {
        toolUse: {
          name: 'PersonSchema',
          toolUseId: 'tool-789',
          input: invalidInput,
        },
        agent: { state: {}, messages: [] } as any,
      }

      const generator = tool.stream(toolContext)
      const result = await generator.next()

      expect(result.done).toBe(true)
      if (result.value && 'status' in result.value) {
        expect(result.value.status).toBe('error')

        const errorContent = result.value.content[0] as any
        expect(errorContent.text).toContain("Field 'age'")
        expect(errorContent.text).toContain("Field 'occupation'")
      }
    })

    it('formats multiple validation errors as bullet list', async () => {
      const invalidInput = {
        name: 123, // Wrong type
        age: 'thirty', // Wrong type
        occupation: ['Engineer'], // Wrong type
      }

      const toolContext = {
        toolUse: {
          name: 'PersonSchema',
          toolUseId: 'tool-multi',
          input: invalidInput,
        },
        agent: { state: {}, messages: [] } as any,
      }

      const generator = tool.stream(toolContext)
      const result = await generator.next()

      expect(result.done).toBe(true)
      if (result.value && 'status' in result.value) {
        expect(result.value.status).toBe('error')

        const errorContent = result.value.content[0] as any
        // Should have bullet points for each field
        expect(errorContent.text).toContain("- Field 'name'")
        expect(errorContent.text).toContain("- Field 'age'")
        expect(errorContent.text).toContain("- Field 'occupation'")
      }
    })

    it('does not store result for validation errors', async () => {
      const invalidInput = {
        name: 'John Doe',
        age: 'thirty',
        occupation: 'Engineer',
      }

      const toolContext = {
        toolUse: {
          name: 'PersonSchema',
          toolUseId: 'tool-no-store',
          input: invalidInput,
        },
        agent: { state: {}, messages: [] } as any,
      }

      await tool.stream(toolContext).next()

      // Should not store invalid result
      expect(context.getResult()).toBeUndefined()
    })
  })

  describe('with optional fields', () => {
    it('validates schema with optional fields', async () => {
      const OptionalSchema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      })

      const optContext = new StructuredOutputContext(OptionalSchema)
      const optTool = new StructuredOutputTool(OptionalSchema, 'OptionalSchema', optContext)

      const validInput = {
        required: 'value',
        // optional field not provided
      }

      const toolContext = {
        toolUse: {
          name: 'OptionalSchema',
          toolUseId: 'tool-opt',
          input: validInput,
        },
        agent: { state: {}, messages: [] } as any,
      }

      const generator = optTool.stream(toolContext)
      const result = await generator.next()

      expect(result.done).toBe(true)
      if (result.value && 'status' in result.value) {
        expect(result.value.status).toBe('success')
      }
      // Phase 2: Extract the result
      optContext.extractResult(['tool-opt'])
      expect(optContext.getResult()).toEqual(validInput)
    })
  })
})
