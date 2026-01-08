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
    })

    it('stores and retrieves result', () => {
      const result = { name: 'John', age: 30 }
      context.storeResult('tool-123', result)

      expect(context.getResult()).toEqual(result)
    })

    it('returns undefined when no result stored', () => {
      expect(context.getResult()).toBeUndefined()
    })

    it('overwrites previous result', () => {
      context.storeResult('tool-1', { name: 'John', age: 30 })
      context.storeResult('tool-2', { name: 'Jane', age: 25 })

      expect(context.getResult()).toEqual({ name: 'Jane', age: 25 })
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
      context.storeResult('tool-123', { name: 'John', age: 30 })

      context.cleanup(registry)

      expect(registry.getToolsForModel()).toHaveLength(0)
      // Result should still be accessible after cleanup
      expect(context.getResult()).toEqual({ name: 'John', age: 30 })
    })
  })

  describe('full lifecycle', () => {
    it('handles complete lifecycle: register -> store -> cleanup', () => {
      context = new StructuredOutputContext(PersonSchema)

      // Register
      context.registerTool(registry)
      expect(registry.getToolsForModel()).toHaveLength(1)

      // Store result
      const result = { name: 'John', age: 30 }
      context.storeResult('tool-123', result)
      expect(context.getResult()).toEqual(result)

      // Cleanup
      context.cleanup(registry)
      expect(registry.getToolsForModel()).toHaveLength(0)
      expect(context.getResult()).toEqual(result)
    })
  })
})