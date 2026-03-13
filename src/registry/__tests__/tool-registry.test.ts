import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry } from '../tool-registry.js'
import { ToolValidationError } from '../../errors.js'
import type { Tool, ToolStreamGenerator } from '../../tools/tool.js'
import { ToolStreamEvent } from '../../tools/tool.js'
import { ToolResultBlock } from '../../types/messages.js'

const createMockTool = (overrides: Partial<Tool> = {}): Tool => ({
  name: 'valid-tool',
  description: 'A valid tool description.',
  toolSpec: {
    name: 'valid-tool',
    description: 'A valid tool description.',
    inputSchema: { type: 'object', properties: {} },
  },
  stream: async function* (): ToolStreamGenerator {
    yield new ToolStreamEvent({ data: 'mock data' })
    return new ToolResultBlock({ toolUseId: '', status: 'success', content: [] })
  },
  ...overrides,
})

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  describe('add', () => {
    it('registers a single tool', () => {
      const tool = createMockTool()
      registry.add(tool)
      expect(registry.list()).toStrictEqual([tool])
    })

    it('registers an array of tools', () => {
      const tool1 = createMockTool({ name: 'tool-1' })
      const tool2 = createMockTool({ name: 'tool-2' })
      registry.add([tool1, tool2])
      expect(registry.list()).toStrictEqual([tool1, tool2])
    })

    it('throws ToolValidationError for a duplicate tool name', () => {
      registry.add(createMockTool({ name: 'duplicate' }))
      expect(() => registry.add(createMockTool({ name: 'duplicate' }))).toThrow(ToolValidationError)
      expect(() => registry.add(createMockTool({ name: 'duplicate' }))).toThrow(
        "Tool with name 'duplicate' already registered"
      )
    })

    it('throws ToolValidationError for an invalid tool name pattern', () => {
      expect(() => registry.add(createMockTool({ name: 'invalid name!' }))).toThrow(ToolValidationError)
      expect(() => registry.add(createMockTool({ name: 'invalid name!' }))).toThrow(
        'Tool name must contain only alphanumeric characters, hyphens, and underscores'
      )
    })

    it('throws ToolValidationError for a tool name that is too long', () => {
      expect(() => registry.add(createMockTool({ name: 'a'.repeat(65) }))).toThrow(ToolValidationError)
      expect(() => registry.add(createMockTool({ name: 'a'.repeat(65) }))).toThrow(
        'Tool name must be between 1 and 64 characters'
      )
    })

    it('throws ToolValidationError for a tool name that is too short', () => {
      expect(() => registry.add(createMockTool({ name: '' }))).toThrow(ToolValidationError)
      expect(() => registry.add(createMockTool({ name: '' }))).toThrow('Tool name must be between 1 and 64 characters')
    })

    it('throws ToolValidationError for a non-string tool name', () => {
      // @ts-expect-error - Testing invalid type for name
      expect(() => registry.add(createMockTool({ name: 123 }))).toThrow(ToolValidationError)
      // @ts-expect-error - Testing invalid type for name
      expect(() => registry.add(createMockTool({ name: 123 }))).toThrow('Tool name must be a string')
    })

    it('throws ToolValidationError for an invalid description', () => {
      // @ts-expect-error - Testing invalid type for description
      expect(() => registry.add(createMockTool({ description: 123 }))).toThrow(ToolValidationError)
      // @ts-expect-error - Testing invalid type for description
      expect(() => registry.add(createMockTool({ description: 123 }))).toThrow(
        'Tool description must be a non-empty string'
      )
    })

    it('throws ToolValidationError for an empty string description', () => {
      expect(() => registry.add(createMockTool({ description: '' }))).toThrow(ToolValidationError)
      expect(() => registry.add(createMockTool({ description: '' }))).toThrow(
        'Tool description must be a non-empty string'
      )
    })

    it('allows a tool with a null or undefined description', () => {
      const tool1 = createMockTool({ name: 'tool-1' })
      // @ts-expect-error - Testing explicit undefined description
      tool1.description = undefined

      const tool2 = createMockTool({ name: 'tool-2' })
      // @ts-expect-error - Testing explicit null description
      tool2.description = null

      registry.add([tool1, tool2])
      expect(registry.list()).toHaveLength(2)
    })

    it('registers a tool with a name at the maximum length', () => {
      const tool = createMockTool({ name: 'a'.repeat(64) })
      expect(() => registry.add(tool)).not.toThrow()
    })
  })

  describe('get', () => {
    it('retrieves a tool by name', () => {
      const tool = createMockTool({ name: 'find-me' })
      registry.add(tool)
      expect(registry.get('find-me')).toBe(tool)
    })

    it('returns undefined for a non-existent tool', () => {
      expect(registry.get('non-existent')).toBeUndefined()
    })
  })

  describe('remove', () => {
    it('removes a tool by name', () => {
      registry.add(createMockTool({ name: 'remove-me' }))
      registry.remove('remove-me')
      expect(registry.get('remove-me')).toBeUndefined()
    })

    it('does not throw when removing a non-existent tool', () => {
      expect(() => registry.remove('non-existent')).not.toThrow()
    })
  })

  describe('list', () => {
    it('returns an empty array when no tools are registered', () => {
      expect(registry.list()).toStrictEqual([])
    })

    it('returns all registered tools', () => {
      const tool1 = createMockTool({ name: 'tool-1' })
      const tool2 = createMockTool({ name: 'tool-2' })
      registry.add([tool1, tool2])
      expect(registry.list()).toStrictEqual([tool1, tool2])
    })
  })

  describe('constructor', () => {
    it('accepts initial tools', () => {
      const tool = createMockTool()
      const reg = new ToolRegistry([tool])
      expect(reg.list()).toStrictEqual([tool])
    })
  })
})
