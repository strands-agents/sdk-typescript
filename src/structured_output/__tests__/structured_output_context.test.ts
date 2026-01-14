import { describe, it, expect, beforeEach } from 'vitest'
import { StructuredOutputContext } from '../structured_output_context.js'
import { ToolRegistry } from '../../registry/tool-registry.js'
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
  })

  describe('constructor', () => {
    it('creates context with schema', () => {
      context = new StructuredOutputContext(PersonSchema)
      expect(context).toBeDefined()
    })

    it('creates context without schema', () => {
      context = new StructuredOutputContext()
      expect(context).toBeDefined()
    })
  })

  describe('registerTool', () => {
    it('registers tool when schema is provided', () => {
      context = new StructuredOutputContext(PersonSchema)
      context.registerTool(registry)

      // Tool should be registered as dynamic tool
      const tool = registry.getByName('StructuredOutput')
      expect(tool).toBeDefined()
      expect(tool?.name).toBe('StructuredOutput')
    })

    it('does not register tool when schema is not provided', () => {
      context = new StructuredOutputContext()
      context.registerTool(registry)

      // No tools should be registered
      expect(registry.values()).toHaveLength(0)
      expect(registry.getToolsForModel()).toHaveLength(0)
    })

    it('registered tool is hidden from public tools', () => {
      context = new StructuredOutputContext(PersonSchema)
      context.registerTool(registry)

      // Tool should not appear in public values()
      expect(registry.values()).toHaveLength(0)

      // But should appear in getToolsForModel()
      expect(registry.getToolsForModel()).toHaveLength(1)
      expect(registry.getToolsForModel()[0]?.name).toBe('StructuredOutput')
    })
  })

  describe('storeResult and getResult', () => {
    beforeEach(() => {
      context = new StructuredOutputContext(PersonSchema)
      context.registerTool(registry) // Required for extractResult to work
    })

    it('stores and retrieves result via two-phase pattern', () => {
      const result = { name: 'John', age: 30 }
      const toolUseId = 'tool-123'

      // Phase 1: Store
      context.storeResult(toolUseId, result)
      expect(context.hasResult()).toBe(false) // Not yet extracted

      // Phase 2: Extract
      context.extractResult([toolUseId])
      expect(context.hasResult()).toBe(true)
      expect(context.getResult()).toEqual(result)
    })

    it('returns undefined when no result stored', () => {
      expect(context.getResult()).toBeUndefined()
      expect(context.hasResult()).toBe(false)
    })

    it('extracts the first matching result from multiple tool uses', () => {
      context.storeResult('tool-1', { name: 'John', age: 30 })
      context.storeResult('tool-2', { name: 'Jane', age: 25 })

      // Extract will find tool-1 first
      context.extractResult(['tool-1', 'tool-2'])
      expect(context.getResult()).toEqual({ name: 'John', age: 30 })
    })

    it('returns undefined if tool use IDs do not match', () => {
      context.storeResult('tool-1', { name: 'John', age: 30 })
      const result = context.extractResult(['different-tool'])
      expect(result).toBeUndefined()
    })
  })

  describe('cleanup', () => {
    beforeEach(() => {
      context = new StructuredOutputContext(PersonSchema)
    })

    it('removes tool from registry', () => {
      context.registerTool(registry)
      expect(registry.getToolsForModel()).toHaveLength(1)

      context.cleanup(registry)
      expect(registry.getToolsForModel()).toHaveLength(0)
    })

    it('can be called multiple times safely', () => {
      context.registerTool(registry)
      context.cleanup(registry)

      // Should not throw on second cleanup
      expect(() => context.cleanup(registry)).not.toThrow()
    })

    it('does not throw when tool was never registered', () => {
      expect(() => context.cleanup(registry)).not.toThrow()
    })

    it('cleans up after storing result', () => {
      context.registerTool(registry)
      const toolUseId = 'tool-123'
      const result = { name: 'John', age: 30 }
      context.storeResult(toolUseId, result)
      context.extractResult([toolUseId])

      context.cleanup(registry)

      expect(registry.getToolsForModel()).toHaveLength(0)
      // Result should still be accessible after cleanup
      expect(context.getResult()).toEqual(result)
    })
  })

  describe('full lifecycle', () => {
    it('handles complete lifecycle: register -> store -> extract -> cleanup', () => {
      context = new StructuredOutputContext(PersonSchema)
      const toolUseId = 'tool-123'
      const result = { name: 'John', age: 30 }

      // Register
      context.registerTool(registry)
      expect(registry.getToolsForModel()).toHaveLength(1)

      // Phase 1: Store result
      context.storeResult(toolUseId, result)
      expect(context.hasResult()).toBe(false)

      // Phase 2: Extract result
      context.extractResult([toolUseId])
      expect(context.hasResult()).toBe(true)
      expect(context.getResult()).toEqual(result)

      // Cleanup
      context.cleanup(registry)
      expect(registry.getToolsForModel()).toHaveLength(0)
      expect(context.getResult()).toEqual(result) // Still accessible
    })
  })

  describe('getToolName', () => {
    it('returns tool name when registered', () => {
      context = new StructuredOutputContext(PersonSchema)
      context.registerTool(registry)
      expect(context.getToolName()).toBe('StructuredOutput')
    })

    it('returns fallback when not registered', () => {
      context = new StructuredOutputContext(PersonSchema)
      expect(context.getToolName()).toBe('StructuredOutput')
    })
  })
})
