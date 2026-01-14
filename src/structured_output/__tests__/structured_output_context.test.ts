import { describe, it, expect, beforeEach } from 'vitest'
import { StructuredOutputContext } from '../structured_output_context.js'
import { ToolRegistry } from '../../registry/tool-registry.js'
import { Message, ToolUseBlock, TextBlock } from '../../types/messages.js'
import { z } from 'zod'

describe('StructuredOutputContext', () => {
  const PersonSchema = z.object({
    name: z.string(),
    age: z.number(),
  })

  let context: StructuredOutputContext
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
    context = new StructuredOutputContext(PersonSchema)
  })

  describe('constructor', () => {
    it('creates context with schema', () => {
      expect(context).toBeDefined()
    })
  })

  describe('registerTool', () => {
    it('registers tool with schema', () => {
      context.registerTool(registry)

      const tool = registry.getByName('StructuredOutput')
      expect(tool).toBeDefined()
      expect(tool?.name).toBe('StructuredOutput')
    })

    it('tool appears in getToolsForModel()', () => {
      context.registerTool(registry)

      expect(registry.getToolsForModel()).toHaveLength(1)
      expect(registry.getToolsForModel()[0]?.name).toBe('StructuredOutput')
    })
  })

  describe('storeResult and extractResultFromMessage', () => {
    beforeEach(() => {
      context.registerTool(registry)
    })

    it('stores and retrieves result via two-phase pattern', () => {
      const result = { name: 'John', age: 30 }
      const toolUseId = 'tool-123'

      // Phase 1: Store
      context.storeResult(toolUseId, result)
      expect(context.hasResult()).toBe(false)

      // Phase 2: Extract from message
      const message = new Message({
        role: 'assistant',
        content: [new ToolUseBlock({ name: 'StructuredOutput', toolUseId, input: result })],
      })
      context.extractResultFromMessage(message)
      expect(context.hasResult()).toBe(true)
      expect(context.getResult()).toEqual(result)
    })

    it('returns undefined when no result stored', () => {
      expect(context.getResult()).toBeUndefined()
      expect(context.hasResult()).toBe(false)
    })

    it('extracts from message with multiple tool uses', () => {
      context.storeResult('tool-1', { name: 'John', age: 30 })

      const message = new Message({
        role: 'assistant',
        content: [
          new TextBlock('Some text'),
          new ToolUseBlock({ name: 'StructuredOutput', toolUseId: 'tool-1', input: {} }),
          new ToolUseBlock({ name: 'OtherTool', toolUseId: 'tool-2', input: {} }),
        ],
      })
      context.extractResultFromMessage(message)
      expect(context.getResult()).toEqual({ name: 'John', age: 30 })
    })

    it('returns undefined if message has no matching tool uses', () => {
      context.storeResult('tool-1', { name: 'John', age: 30 })

      const message = new Message({
        role: 'assistant',
        content: [new ToolUseBlock({ name: 'OtherTool', toolUseId: 'different-tool', input: {} })],
      })
      const result = context.extractResultFromMessage(message)
      expect(result).toBeUndefined()
    })
  })

  describe('cleanup', () => {
    it('removes tool from registry', () => {
      context.registerTool(registry)
      expect(registry.getToolsForModel()).toHaveLength(1)

      context.cleanup(registry)
      expect(registry.getToolsForModel()).toHaveLength(0)
    })

    it('can be called multiple times safely', () => {
      context.registerTool(registry)
      context.cleanup(registry)

      expect(() => context.cleanup(registry)).not.toThrow()
    })

    it('does not throw when tool was never registered', () => {
      expect(() => context.cleanup(registry)).not.toThrow()
    })

    it('result still accessible after cleanup', () => {
      context.registerTool(registry)
      const toolUseId = 'tool-123'
      const result = { name: 'John', age: 30 }
      context.storeResult(toolUseId, result)

      const message = new Message({
        role: 'assistant',
        content: [new ToolUseBlock({ name: 'StructuredOutput', toolUseId, input: result })],
      })
      context.extractResultFromMessage(message)

      context.cleanup(registry)

      expect(registry.getToolsForModel()).toHaveLength(0)
      expect(context.getResult()).toEqual(result)
    })
  })

  describe('full lifecycle', () => {
    it('handles complete lifecycle: register -> store -> extract -> cleanup', () => {
      const toolUseId = 'tool-123'
      const result = { name: 'John', age: 30 }

      // Register
      context.registerTool(registry)
      expect(registry.getToolsForModel()).toHaveLength(1)

      // Phase 1: Store result
      context.storeResult(toolUseId, result)
      expect(context.hasResult()).toBe(false)

      // Phase 2: Extract result from message
      const message = new Message({
        role: 'assistant',
        content: [new ToolUseBlock({ name: 'StructuredOutput', toolUseId, input: result })],
      })
      context.extractResultFromMessage(message)
      expect(context.hasResult()).toBe(true)
      expect(context.getResult()).toEqual(result)

      // Cleanup
      context.cleanup(registry)
      expect(registry.getToolsForModel()).toHaveLength(0)
      expect(context.getResult()).toEqual(result)
    })
  })

  describe('getToolName', () => {
    it('returns tool name when registered', () => {
      context.registerTool(registry)
      expect(context.getToolName()).toBe('StructuredOutput')
    })

    it('returns fallback when not registered', () => {
      expect(context.getToolName()).toBe('StructuredOutput')
    })
  })
})
