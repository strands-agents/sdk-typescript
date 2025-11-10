import { Registry, ValidationError } from './registry.js'
import type { Tool, ToolStreamGenerator } from '../tools/tool.js'
import { ToolStreamEvent } from '../tools/tool.js'
import { ToolResultBlock } from '../types/messages.js'

/**
 * A concrete implementation of the Registry for managing Tool instances.
 * It adds validation for tool properties and ensures unique tool names.
 */
export class ToolRegistry extends Registry<Tool, Tool> {
  /**
   * Generates a unique identifier for a Tool.
   * @override
   * @returns The tool itself as the identifier.
   */
  protected generateId(tool: Tool): Tool {
    return tool
  }

  /**
   * Validates a tool before it is registered.
   * @override
   * @param tool - The tool to be validated.
   * @throws ValidationError If the tool's properties are invalid or its name is already registered.
   */
  protected validate(tool: Tool): void {
    // Validate tool name is a string
    if (typeof tool.name !== 'string') {
      throw new ValidationError('Tool name must be a string')
    }

    // Validate tool name length (1-64 characters)
    if (tool.name.length < 1 || tool.name.length > 64) {
      throw new ValidationError('Tool name must be between 1 and 64 characters')
    }

    // Validate tool name pattern
    const validNamePattern = /^[a-zA-Z0-9_-]+$/
    if (!validNamePattern.test(tool.name)) {
      throw new ValidationError('Tool name must contain only alphanumeric characters, hyphens, and underscores')
    }

    // Validate tool description if present
    if (tool.description !== undefined && tool.description !== null) {
      if (typeof tool.description !== 'string' || tool.description.length < 1) {
        throw new ValidationError('Tool description must be a non-empty string')
      }
    }

    // Check for duplicate names
    if (this.values().some((t) => t.name === tool.name)) {
      throw new ValidationError(`Tool with name '${tool.name}' already registered`)
    }
  }

  /**
   * Retrieves the first tool that matches the given name.
   * @param name - The name of the tool to retrieve.
   * @returns The tool if found, otherwise undefined.
   */
  public getByName(name: string): Tool | undefined {
    return this.values().find((tool) => tool.name === name)
  }

  /**
   * Finds and removes the first tool that matches the given name.
   * If multiple tools have the same name, only the first one found is removed.
   * @param name - The name of the tool to remove.
   */
  public removeByName(name: string): void {
    this.findRemove((tool) => tool.name === name)
  }
}

// Unit tests
if (import.meta.vitest) {
  const { describe, it, expect, beforeEach } = import.meta.vitest

  // Mock Tool definition for testing purposes
  const createMockTool = (overrides: Partial<Tool> = {}): Tool => ({
    name: 'valid-tool',
    description: 'A valid tool description.',
    toolSpec: {
      name: 'valid-tool',
      description: 'A valid tool description.',
      inputSchema: { type: 'object', properties: {} },
    },
    stream: async function* (): ToolStreamGenerator {
      // Mock stream implementation
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

    it('should register a valid tool successfully', () => {
      const tool = createMockTool()
      expect(() => registry.add(tool)).not.toThrow()
      expect(registry.values()).toHaveLength(1)
      expect(registry.values()[0]?.name).toBe('valid-tool')
    })

    it('should throw ValidationError for a duplicate tool name', () => {
      const tool1 = createMockTool({ name: 'duplicate-name' })
      const tool2 = createMockTool({ name: 'duplicate-name' })
      registry.add(tool1)

      expect(() => registry.add(tool2)).toThrow(ValidationError)
      expect(() => registry.add(tool2)).toThrow("Tool with name 'duplicate-name' already registered")
    })

    it('should throw ValidationError for an invalid tool name pattern', () => {
      const tool = createMockTool({ name: 'invalid name!' })
      expect(() => registry.add(tool)).toThrow(ValidationError)
      expect(() => registry.add(tool)).toThrow(
        'Tool name must contain only alphanumeric characters, hyphens, and underscores'
      )
    })

    it('should throw ValidationError for a tool name that is too long', () => {
      const longName = 'a'.repeat(65)
      const tool = createMockTool({ name: longName })
      expect(() => registry.add(tool)).toThrow(ValidationError)
      expect(() => registry.add(tool)).toThrow('Tool name must be between 1 and 64 characters')
    })

    it('should throw ValidationError for a tool name that is too short', () => {
      const tool = createMockTool({ name: '' })
      expect(() => registry.add(tool)).toThrow(ValidationError)
      expect(() => registry.add(tool)).toThrow('Tool name must be between 1 and 64 characters')
    })

    it('should throw ValidationError for an invalid description', () => {
      // @ts-expect-error - Testing invalid type for description
      const tool = createMockTool({ description: 123 })
      expect(() => registry.add(tool)).toThrow(ValidationError)
      expect(() => registry.add(tool)).toThrow('Tool description must be a non-empty string')
    })

    it('should throw ValidationError for an empty string description', () => {
      const tool = createMockTool({ description: '' })
      expect(() => registry.add(tool)).toThrow(ValidationError)
      expect(() => registry.add(tool)).toThrow('Tool description must be a non-empty string')
    })

    it('should allow a tool with a null or undefined description', () => {
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

    it('should retrieve a tool by its name', () => {
      const tool = createMockTool({ name: 'find-me' })
      registry.add(tool)
      const foundTool = registry.getByName('find-me')
      expect(foundTool).toBe(tool)
    })

    it('should return undefined when getting a tool by a name that does not exist', () => {
      const foundTool = registry.getByName('non-existent')
      expect(foundTool).toBeUndefined()
    })

    it('should remove a tool by its name', () => {
      const tool = createMockTool({ name: 'remove-me' })
      registry.add(tool)
      expect(registry.getByName('remove-me')).toBeDefined()
      registry.removeByName('remove-me')
      expect(registry.getByName('remove-me')).toBeUndefined()
    })

    it('should not throw when removing a tool by a name that does not exist', () => {
      expect(() => registry.removeByName('non-existent')).not.toThrow()
    })

    it('should generate a valid ToolIdentifier', () => {
      const tool = createMockTool()
      const id = registry['generateId'](tool)
      expect(id).toBe(tool)
    })

    it('should register a tool with a name at the maximum length', () => {
      const longName = 'a'.repeat(64)
      const tool = createMockTool({ name: longName })
      expect(() => registry.add(tool)).not.toThrow()
    })

    it('should throw ValidationError for a non-string tool name', () => {
      // @ts-expect-error - Testing invalid type for name
      const tool = createMockTool({ name: 123 })
      expect(() => registry.add(tool)).toThrow(ValidationError)
      expect(() => registry.add(tool)).toThrow('Tool name must be a string')
    })
  })
}
