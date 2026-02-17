import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { StructuredOutputContext, NullStructuredOutputContext, createStructuredOutputContext } from '../context.js'
import { ToolRegistry } from '../../registry/tool-registry.js'
import { StructuredOutputTool } from '../tool.js'

describe('NullStructuredOutputContext', () => {
  it('has isEnabled set to false', () => {
    const context = new NullStructuredOutputContext()
    expect(context.isEnabled).toBe(false)
  })

  it('registerTool does nothing', () => {
    const context = new NullStructuredOutputContext()
    const registry = new ToolRegistry()

    context.registerTool(registry)

    expect(registry.values()).toEqual([])
  })

  it('storeResult does nothing', () => {
    const context = new NullStructuredOutputContext()

    expect(() => context.storeResult('tool-1', { data: 'test' })).not.toThrow()
  })

  it('hasResult always returns true', () => {
    const context = new NullStructuredOutputContext()

    expect(context.hasResult()).toBe(true)
  })

  it('getResult returns undefined', () => {
    const context = new NullStructuredOutputContext()

    expect(context.getResult()).toBeUndefined()
  })

  it('getToolName returns default name', () => {
    const context = new NullStructuredOutputContext()

    expect(context.getToolName()).toBe('StructuredOutput')
  })

  it('cleanup does nothing', () => {
    const context = new NullStructuredOutputContext()
    const registry = new ToolRegistry()

    expect(() => context.cleanup(registry)).not.toThrow()
  })
})

describe('StructuredOutputContext', () => {
  describe('constructor', () => {
    it('creates context with schema', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)

      expect(context.isEnabled).toBe(true)
    })
  })

  describe('registerTool', () => {
    it('registers structured output tool with registry', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)
      const registry = new ToolRegistry()

      context.registerTool(registry)

      const tools = registry.values()
      expect(tools.length).toBe(1)
      expect(tools[0]).toBeInstanceOf(StructuredOutputTool)
      expect(tools[0]?.name).toBe('StructuredOutput')
    })

    it('does not register duplicate tools on multiple calls', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)
      const registry = new ToolRegistry()

      context.registerTool(registry)
      expect(registry.values().length).toBe(1)

      expect(() => context.registerTool(registry)).toThrow('already registered')
    })

    it('uses tool name from schema metadata', () => {
      const schema = z.object({ name: z.string() })
      ;(schema as any)._def.name = 'CustomTool'
      const context = new StructuredOutputContext(schema)
      const registry = new ToolRegistry()

      context.registerTool(registry)

      const tools = registry.values()
      expect(tools[0]?.name).toBe('CustomTool')
    })
  })

  describe('storeResult', () => {
    it('stores validated result', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)

      context.storeResult('tool-1', { name: 'John' })

      expect(context.hasResult()).toBe(true)
      expect(context.getResult()).toEqual({ name: 'John' })
    })

    it('overwrites previous result', () => {
      const schema = z.object({ value: z.number() })
      const context = new StructuredOutputContext(schema)

      context.storeResult('tool-1', { value: 1 })
      expect(context.getResult()).toEqual({ value: 1 })
      expect(context.hasResult()).toBe(true)

      context.storeResult('tool-2', { value: 2 })
      expect(context.getResult()).toEqual({ value: 2 })
      expect(context.hasResult()).toBe(true)
    })
  })

  describe('hasResult', () => {
    it('returns false when no result stored', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)

      expect(context.hasResult()).toBe(false)
    })

    it('returns true when result stored', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)

      context.storeResult('tool-1', { name: 'John' })

      expect(context.hasResult()).toBe(true)
    })
  })

  describe('getResult', () => {
    it('returns undefined when no result stored', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)

      expect(context.getResult()).toBeUndefined()
    })

    it('returns stored result', () => {
      const schema = z.object({ name: z.string(), age: z.number() })
      const context = new StructuredOutputContext(schema)

      context.storeResult('tool-1', { name: 'John', age: 30 })

      expect(context.getResult()).toEqual({ name: 'John', age: 30 })
    })
  })

  describe('getToolName', () => {
    it('returns tool name after registration', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)
      const registry = new ToolRegistry()

      context.registerTool(registry)

      expect(context.getToolName()).toBe('StructuredOutput')
    })

    it('returns fallback before registration', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)

      expect(context.getToolName()).toBe('StructuredOutput')
    })

    it('returns custom tool name from schema', () => {
      const schema = z.object({ name: z.string() })
      ;(schema as any)._def.name = 'CustomTool'
      const context = new StructuredOutputContext(schema)
      const registry = new ToolRegistry()

      context.registerTool(registry)

      expect(context.getToolName()).toBe('CustomTool')
    })
  })

  describe('cleanup', () => {
    it('removes tool from registry', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)
      const registry = new ToolRegistry()

      context.registerTool(registry)
      expect(registry.values().length).toBe(1)

      context.cleanup(registry)
      expect(registry.values().length).toBe(0)
    })

    it('can be called multiple times safely', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)
      const registry = new ToolRegistry()

      context.registerTool(registry)
      context.cleanup(registry)
      expect(registry.values().length).toBe(0)

      context.cleanup(registry)
      expect(registry.values().length).toBe(0)
    })

    it('does nothing if tool not registered', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)
      const registry = new ToolRegistry()

      context.cleanup(registry)
      expect(registry.values().length).toBe(0)
    })

    it('supports register-cleanup-register cycle', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)
      const registry = new ToolRegistry()

      context.registerTool(registry)
      expect(registry.values().length).toBe(1)

      context.cleanup(registry)
      expect(registry.values().length).toBe(0)

      context.registerTool(registry)
      expect(registry.values().length).toBe(1)
    })
  })

  describe('lifecycle', () => {
    it('supports full register-use-cleanup lifecycle', () => {
      const schema = z.object({ name: z.string() })
      const context = new StructuredOutputContext(schema)
      const registry = new ToolRegistry()

      // Register
      context.registerTool(registry)
      expect(registry.values().length).toBe(1)

      // Use
      context.storeResult('tool-1', { name: 'John' })
      expect(context.hasResult()).toBe(true)
      expect(context.getResult()).toEqual({ name: 'John' })

      // Cleanup
      context.cleanup(registry)
      expect(registry.values().length).toBe(0)
    })
  })
})

describe('createStructuredOutputContext', () => {
  it('returns StructuredOutputContext when schema provided', () => {
    const schema = z.object({ name: z.string() })
    const context = createStructuredOutputContext(schema)

    expect(context).toBeInstanceOf(StructuredOutputContext)
    expect(context.isEnabled).toBe(true)
  })

  it('returns NullStructuredOutputContext when no schema provided', () => {
    const context = createStructuredOutputContext()

    expect(context).toBeInstanceOf(NullStructuredOutputContext)
    expect(context.isEnabled).toBe(false)
  })

  it('returns NullStructuredOutputContext when undefined schema', () => {
    const context = createStructuredOutputContext(undefined)

    expect(context).toBeInstanceOf(NullStructuredOutputContext)
    expect(context.isEnabled).toBe(false)
  })
})
