import { describe, it, expect, beforeEach } from 'vitest'
import { ValidationError } from '../registry.js'
import { ToolRegistry } from '../tool-registry.js'
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

  it('registers a valid tool successfully', () => {
    const tool = createMockTool()
    expect(() => registry.add(tool)).not.toThrow()
    expect(registry.values()).toHaveLength(1)
    expect(registry.values()[0]?.name).toBe('valid-tool')
  })

  it('throws ValidationError for a duplicate tool name', () => {
    const tool1 = createMockTool({ name: 'duplicate-name' })
    const tool2 = createMockTool({ name: 'duplicate-name' })
    registry.add(tool1)

    expect(() => registry.add(tool2)).toThrow(ValidationError)
    expect(() => registry.add(tool2)).toThrow("Tool with name 'duplicate-name' already registered")
  })

  it('throws ValidationError for an invalid tool name pattern', () => {
    const tool = createMockTool({ name: 'invalid name!' })
    expect(() => registry.add(tool)).toThrow(ValidationError)
    expect(() => registry.add(tool)).toThrow(
      'Tool name must contain only alphanumeric characters, hyphens, and underscores'
    )
  })

  it('throws ValidationError for a tool name that is too long', () => {
    const longName = 'a'.repeat(65)
    const tool = createMockTool({ name: longName })
    expect(() => registry.add(tool)).toThrow(ValidationError)
    expect(() => registry.add(tool)).toThrow('Tool name must be between 1 and 64 characters')
  })

  it('throws ValidationError for a tool name that is too short', () => {
    const tool = createMockTool({ name: '' })
    expect(() => registry.add(tool)).toThrow(ValidationError)
    expect(() => registry.add(tool)).toThrow('Tool name must be between 1 and 64 characters')
  })

  it('throws ValidationError for an invalid description', () => {
    // @ts-expect-error - Testing invalid type for description
    const tool = createMockTool({ description: 123 })
    expect(() => registry.add(tool)).toThrow(ValidationError)
    expect(() => registry.add(tool)).toThrow('Tool description must be a non-empty string')
  })

  it('throws ValidationError for an empty string description', () => {
    const tool = createMockTool({ description: '' })
    expect(() => registry.add(tool)).toThrow(ValidationError)
    expect(() => registry.add(tool)).toThrow('Tool description must be a non-empty string')
  })

  it('allows a tool with a null or undefined description', () => {
    const tool1 = createMockTool()
    // @ts-expect-error - Testing explicit undefined description
    tool1.description = undefined

    const tool2 = createMockTool()
    tool2.name = 'another-valid-tool'
    // @ts-expect-error - Testing explicit null description
    tool2.description = null

    expect(() => registry.add(tool1)).not.toThrow()
    expect(() => registry.add(tool2)).not.toThrow()
  })

  it('retrieves a tool by its name', () => {
    const tool = createMockTool({ name: 'find-me' })
    registry.add(tool)
    const foundTool = registry.getByName('find-me')
    expect(foundTool).toBe(tool)
  })

  it('returns undefined when getting a tool by a name that does not exist', () => {
    const foundTool = registry.getByName('non-existent')
    expect(foundTool).toBeUndefined()
  })

  it('removes a tool by its name', () => {
    const tool = createMockTool({ name: 'remove-me' })
    registry.add(tool)
    expect(registry.getByName('remove-me')).toBeDefined()
    registry.removeByName('remove-me')
    expect(registry.getByName('remove-me')).toBeUndefined()
  })

  it('does not throw when removing a tool by a name that does not exist', () => {
    expect(() => registry.removeByName('non-existent')).not.toThrow()
  })

  it('generates a valid ToolIdentifier', () => {
    const tool = createMockTool()
    const id = registry['generateId'](tool)
    expect(id).toBe(tool)
  })

  it('registers a tool with a name at the maximum length', () => {
    const longName = 'a'.repeat(64)
    const tool = createMockTool({ name: longName })
    expect(() => registry.add(tool)).not.toThrow()
  })

  it('throws ValidationError for a non-string tool name', () => {
    // @ts-expect-error - Testing invalid type for name
    const tool = createMockTool({ name: 123 })
    expect(() => registry.add(tool)).toThrow(ValidationError)
    expect(() => registry.add(tool)).toThrow('Tool name must be a string')
  })
})
