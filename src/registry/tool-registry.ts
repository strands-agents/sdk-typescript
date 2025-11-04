import { v4 as uuidv4 } from 'uuid'
import { Registry, ValidationError } from './registry'
import type { ToolIdentifier } from '../agent'
import type { Tool, ToolStreamGenerator } from '../tools/tool'

/**
 * A concrete implementation of the Registry for managing Tool instances.
 * It adds validation for tool properties and ensures unique tool names.
 */
export class ToolRegistry extends Registry<Tool, ToolIdentifier> {
  /**
   * Generates a unique identifier for a Tool.
   * @override
   * @returns A new ToolIdentifier object with a UUID.
   */
  protected generateId(): ToolIdentifier {
    return { type: 'toolIdentifier', id: uuidv4() }
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
      yield { type: 'toolStreamEvent' as const, data: 'mock data' }
      return { toolUseId: '', status: 'success' as const, content: [] }
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
      expect(() => registry.register(tool)).not.toThrow()
      expect(registry.values()).toHaveLength(1)
      expect(registry.values()[0]?.name).toBe('valid-tool')
    })

    it('should throw ValidationError for a duplicate tool name', () => {
      const tool1 = createMockTool({ name: 'duplicate-name' })
      const tool2 = createMockTool({ name: 'duplicate-name' })
      registry.register(tool1)

      expect(() => registry.register(tool2)).toThrow(ValidationError)
      expect(() => registry.register(tool2)).toThrow("Tool with name 'duplicate-name' already registered")
    })

    it('should throw ValidationError for an invalid tool name pattern', () => {
      const tool = createMockTool({ name: 'invalid name!' })
      expect(() => registry.register(tool)).toThrow(ValidationError)
      expect(() => registry.register(tool)).toThrow(
        'Tool name must contain only alphanumeric characters, hyphens, and underscores'
      )
    })

    it('should throw ValidationError for a tool name that is too long', () => {
      const longName = 'a'.repeat(65)
      const tool = createMockTool({ name: longName })
      expect(() => registry.register(tool)).toThrow(ValidationError)
      expect(() => registry.register(tool)).toThrow('Tool name must be between 1 and 64 characters')
    })

    it('should throw ValidationError for an invalid description', () => {
      // @ts-expect-error - Testing invalid type for description
      const tool = createMockTool({ description: 123 })
      expect(() => registry.register(tool)).toThrow(ValidationError)
      expect(() => registry.register(tool)).toThrow('Tool description must be a non-empty string')
    })
  })
}
