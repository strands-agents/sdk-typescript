import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ToolRegistry } from '../../../registry/tool-registry.js'
import { StructuredOutputContext, DEFAULT_STRUCTURED_OUTPUT_PROMPT } from '../structured-output-context.js'

const SampleSchema = z
  .object({
    name: z.string().describe('Name field'),
    age: z.number().min(0).describe('Age field'),
    email: z.string().email().optional().nullable().describe('Optional email field'),
  })
  .describe('SampleModel')

describe('StructuredOutputContext', () => {
  describe('initialization', () => {
    it('initializes with schema and sets expected tool name from schema describe', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      expect(context.isEnabled).toBe(true)
      expect(context.expectedToolName).toBe('SampleModel')
      expect(context.forcedMode).toBe(false)
      expect(context.toolChoice).toBeNull()
      expect(context.stopLoop).toBe(false)
      expect(context.structuredOutputPrompt).toBe(DEFAULT_STRUCTURED_OUTPUT_PROMPT)
    })

    it('initializes without schema when model is null', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: null })
      expect(context.isEnabled).toBe(false)
      expect(context.expectedToolName).toBeNull()
      expect(context.getToolSpec()).toBeNull()
    })

    it('initializes with custom prompt', () => {
      const customPrompt = 'Please format your response using the output schema.'
      const context = new StructuredOutputContext({
        structuredOutputModel: SampleSchema,
        structuredOutputPrompt: customPrompt,
      })
      expect(context.structuredOutputPrompt).toBe(customPrompt)
    })

    it('uses default prompt when prompt is not provided', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      expect(context.structuredOutputPrompt).toBe(DEFAULT_STRUCTURED_OUTPUT_PROMPT)
    })

    it('default prompt constant has expected value', () => {
      expect(DEFAULT_STRUCTURED_OUTPUT_PROMPT).toBe('You must format the previous response as structured output.')
    })

    it('isEnabled is true with model and false without', () => {
      expect(new StructuredOutputContext({ structuredOutputModel: SampleSchema }).isEnabled).toBe(true)
      expect(new StructuredOutputContext({ structuredOutputModel: null }).isEnabled).toBe(false)
    })
  })

  describe('store and get result', () => {
    it('stores and retrieves result by tool use id', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      const testResult = { name: 'John Doe', age: 30, email: 'john@example.com' }
      const toolUseId = 'test_tool_use_123'

      context.storeResult(toolUseId, testResult)
      expect(context.getResult(toolUseId)).toStrictEqual(testResult)
    })

    it('returns undefined for non-existent tool use id', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      expect(context.getResult('non_existent_id')).toBeUndefined()
    })
  })

  describe('setForcedMode', () => {
    it('sets forced mode with default tool choice when enabled', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      context.setForcedMode()
      expect(context.forcedMode).toBe(true)
      expect(context.forceAttempted).toBe(true)
      expect(context.toolChoice).toStrictEqual({ any: {} })
    })

    it('sets forced mode with custom tool choice', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      context.setForcedMode({ tool: { name: 'SampleModel' } })
      expect(context.forcedMode).toBe(true)
      expect(context.toolChoice).toStrictEqual({ tool: { name: 'SampleModel' } })
    })

    it('no-op when context is not enabled', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: null })
      context.setForcedMode({ tool: { name: 'X' } })
      expect(context.forcedMode).toBe(false)
      expect(context.toolChoice).toBeNull()
    })
  })

  describe('hasStructuredOutputTool', () => {
    it('returns true when tool uses include the expected tool name', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      const toolUses = [
        { name: 'other_tool', toolUseId: '1', input: {} },
        { name: 'SampleModel', toolUseId: '2', input: {} },
      ]
      expect(context.hasStructuredOutputTool(toolUses)).toBe(true)
    })

    it('returns false when no matching tool use', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      const toolUses = [{ name: 'other_tool', toolUseId: '1', input: {} }]
      expect(context.hasStructuredOutputTool(toolUses)).toBe(false)
    })

    it('returns false when context is disabled', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: null })
      expect(context.hasStructuredOutputTool([{ name: 'SampleModel', toolUseId: '1', input: {} }])).toBe(false)
    })
  })

  describe('getToolSpec', () => {
    it('returns tool spec when enabled', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      const spec = context.getToolSpec()
      expect(spec).not.toBeNull()
      expect(spec?.name).toBe('SampleModel')
      expect(spec?.description).toContain('IMPORTANT')
    })

    it('returns null when disabled', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: null })
      expect(context.getToolSpec()).toBeNull()
    })
  })

  describe('extractResult', () => {
    it('extracts and removes result for matching tool use', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      const result = { name: 'Jane', age: 25 }
      context.storeResult('tid_1', result)

      const extracted = context.extractResult([{ name: 'SampleModel', toolUseId: 'tid_1', input: {} }])
      expect(extracted).toStrictEqual(result)
      expect(context.getResult('tid_1')).toBeUndefined()
      expect(context.stopLoop).toBe(true)
    })

    it('returns null when no matching tool use', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      context.storeResult('tid_1', { name: 'x', age: 1 })
      const extracted = context.extractResult([{ name: 'OtherTool', toolUseId: 'tid_1', input: {} }])
      expect(extracted).toBeNull()
    })

    it('returns null when no stored result for matching tool use', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      const extracted = context.extractResult([{ name: 'SampleModel', toolUseId: 'tid_missing', input: {} }])
      expect(extracted).toBeNull()
    })

    it('extracts first matching tool use when multiple match', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      const first = { name: 'First', age: 1 }
      context.storeResult('id_1', first)
      context.storeResult('id_2', { name: 'Second', age: 2 })

      const toolUses = [
        { name: 'SampleModel', toolUseId: 'id_1', input: {} },
        { name: 'SampleModel', toolUseId: 'id_2', input: {} },
      ]
      const extracted = context.extractResult(toolUses)
      expect(extracted).toStrictEqual(first)
    })
  })

  describe('registerTool and cleanup', () => {
    it('registers structured output tool with registry', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      const registry = new ToolRegistry()
      expect(registry.getByName('SampleModel')).toBeUndefined()

      context.registerTool(registry)
      expect(registry.getByName('SampleModel')).toBeDefined()
    })

    it('cleanup removes structured output tool from registry', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      const registry = new ToolRegistry()
      context.registerTool(registry)
      expect(registry.getByName('SampleModel')).toBeDefined()

      context.cleanup(registry)
      expect(registry.getByName('SampleModel')).toBeUndefined()
    })

    it('registerTool does not duplicate when already registered', () => {
      const context = new StructuredOutputContext({ structuredOutputModel: SampleSchema })
      const registry = new ToolRegistry()
      context.registerTool(registry)
      const countAfterFirst = registry.values().filter((t) => t.name === 'SampleModel').length
      context.registerTool(registry)
      const countAfterSecond = registry.values().filter((t) => t.name === 'SampleModel').length
      expect(countAfterFirst).toBe(1)
      expect(countAfterSecond).toBe(1)
    })
  })
})
