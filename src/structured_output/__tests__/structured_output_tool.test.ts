import { describe, it, expect, beforeEach } from 'vitest'
import { StructuredOutputTool } from '../structured_output_tool.js'
import { z } from 'zod'
import { StructuredOutputContext } from '../structured_output_context.js'
import { Message, ToolUseBlock, TextBlock, ToolResultBlock } from '../../types/messages.js'

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
    it('generates correct tool spec', () => {
      expect(tool.name).toBe('PersonSchema')
      expect(tool.toolSpec.name).toBe('PersonSchema')
      expect(tool.toolSpec.description).toContain('StructuredOutputTool')
      expect(tool.toolSpec.description).toContain('last and final tool')
      expect(tool.toolSpec.inputSchema?.type).toBe('object')
      expect(tool.toolSpec.inputSchema?.properties).toHaveProperty('name')
      expect(tool.toolSpec.inputSchema?.properties).toHaveProperty('age')
      expect(tool.toolSpec.inputSchema?.properties).toHaveProperty('occupation')
      expect(tool.toolSpec.inputSchema?.required).toContain('name')
      expect(tool.toolSpec.inputSchema?.required).toContain('age')
      expect(tool.toolSpec.inputSchema?.required).toContain('occupation')
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
      expect(result.value).toBeInstanceOf(ToolResultBlock)
      const resultBlock = result.value as ToolResultBlock
      expect(resultBlock.toolUseId).toBe('tool-123')
      expect(resultBlock.status).toBe('success')
      expect(resultBlock.content).toHaveLength(1)
      expect(resultBlock.content[0]).toBeInstanceOf(TextBlock)
      expect((resultBlock.content[0] as TextBlock).text).toBe(JSON.stringify(validInput))

      // Phase 2: Extract the result (simulating what agent does after tool execution)
      const message = new Message({
        role: 'assistant',
        content: [new ToolUseBlock({ name: 'PersonSchema', toolUseId: 'tool-123', input: validInput })],
      })
      context.extractResultFromMessage(message)
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
      expect(result.value).toBeInstanceOf(ToolResultBlock)
      const resultBlock = result.value as ToolResultBlock
      expect(resultBlock.toolUseId).toBe('tool-456')
      expect(resultBlock.status).toBe('error')
      expect(resultBlock.content).toHaveLength(1)
      const errorText = (resultBlock.content[0] as TextBlock).text
      expect(errorText).toContain('Validation failed for PersonSchema')
      expect(errorText).toContain("Field 'age'")
    })

    it('returns error for missing required fields', async () => {
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
      expect(result.value).toBeInstanceOf(ToolResultBlock)
      const resultBlock = result.value as ToolResultBlock
      expect(resultBlock.status).toBe('error')
      const errorText = (resultBlock.content[0] as TextBlock).text
      expect(errorText).toContain("Field 'age'")
      expect(errorText).toContain("Field 'occupation'")
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
      expect(result.value).toBeInstanceOf(ToolResultBlock)
      const resultBlock = result.value as ToolResultBlock
      expect(resultBlock.toolUseId).toBe('tool-opt')
      expect(resultBlock.status).toBe('success')

      // Phase 2: Extract the result
      const message = new Message({
        role: 'assistant',
        content: [new ToolUseBlock({ name: 'OptionalSchema', toolUseId: 'tool-opt', input: validInput })],
      })
      optContext.extractResultFromMessage(message)
      expect(optContext.getResult()).toEqual(validInput)
    })
  })
})
