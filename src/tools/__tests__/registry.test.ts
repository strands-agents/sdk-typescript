import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../registry.js'
import type { Tool, ToolStreamEvent } from '../tool.js'
import type { ToolResult, ToolSpec } from '../types.js'

/**
 * Helper function to create a mock Tool for testing.
 * Creates a minimal Tool implementation with configurable name and description.
 */
function createMockTool(name: string, description = 'Test tool description'): Tool {
  const toolSpec: ToolSpec = {
    name,
    description,
    inputSchema: { type: 'object' },
  }

  return {
    toolName: name,
    description,
    toolSpec,
    // eslint-disable-next-line require-yield
    async *stream(): AsyncGenerator<ToolStreamEvent, ToolResult, unknown> {
      return {
        toolUseId: 'test-id',
        status: 'success',
        content: [
          {
            type: 'toolResultTextContent',
            text: 'test result',
          },
        ],
      }
    },
  }
}

describe('ToolRegistry', () => {
  describe('constructor', () => {
    it('creates an empty registry', () => {
      const registry = new ToolRegistry()
      expect(registry).toBeDefined()
      expect(registry.list()).toEqual([])
    })
  })

  describe('register', () => {
    describe('when registering a single tool', () => {
      it('adds the tool to the registry', () => {
        const registry = new ToolRegistry()
        const tool = createMockTool('testTool')
        registry.register(tool)

        const retrieved = registry.get('testTool')
        expect(retrieved).toBe(tool)
      })

      it('allows retrieval with get()', () => {
        const registry = new ToolRegistry()
        const tool = createMockTool('calculator')
        registry.register(tool)

        const retrieved = registry.get('calculator')
        expect(retrieved?.toolName).toBe('calculator')
      })
    })

    describe('when registering multiple tools', () => {
      it('adds all tools to the registry', () => {
        const registry = new ToolRegistry()
        const tool1 = createMockTool('multiTool1')
        const tool2 = createMockTool('multiTool2')
        const tool3 = createMockTool('multiTool3')

        registry.register([tool1, tool2, tool3])

        expect(registry.get('multiTool1')).toBe(tool1)
        expect(registry.get('multiTool2')).toBe(tool2)
        expect(registry.get('multiTool3')).toBe(tool3)
      })

      it('allows retrieval of each tool', () => {
        const registry = new ToolRegistry()
        const tools = [createMockTool('alpha'), createMockTool('beta'), createMockTool('gamma')]

        registry.register(tools)

        const allTools = registry.list()
        expect(allTools).toHaveLength(3)
        expect(allTools[0]?.toolName).toBe('alpha')
        expect(allTools[1]?.toolName).toBe('beta')
        expect(allTools[2]?.toolName).toBe('gamma')
      })
    })

    describe('when registering a duplicate tool name', () => {
      it('throws an error with descriptive message', () => {
        const registry = new ToolRegistry()
        const tool1 = createMockTool('duplicateTool')
        const tool2 = createMockTool('duplicateTool')

        registry.register(tool1)

        expect(() => registry.register(tool2)).toThrow("Tool with name 'duplicateTool' already registered")
      })
    })

    describe('when registering a tool with empty name', () => {
      it('throws an error with descriptive message', () => {
        const registry = new ToolRegistry()
        const tool = createMockTool('')

        expect(() => registry.register(tool)).toThrow('Tool name must be between 1 and 64 characters')
      })
    })

    describe('when registering a tool with name too long', () => {
      it('throws an error with descriptive message', () => {
        const registry = new ToolRegistry()
        const longName = 'a'.repeat(65)
        const tool = createMockTool(longName)

        expect(() => registry.register(tool)).toThrow('Tool name must be between 1 and 64 characters')
      })
    })

    describe('when registering a tool with invalid name characters', () => {
      it('throws an error for spaces', () => {
        const registry = new ToolRegistry()
        const tool = createMockTool('invalid name')

        expect(() => registry.register(tool)).toThrow(
          'Tool name must contain only alphanumeric characters, hyphens, and underscores'
        )
      })

      it('throws an error for special characters', () => {
        const registry = new ToolRegistry()
        const tool = createMockTool('invalid@name!')

        expect(() => registry.register(tool)).toThrow(
          'Tool name must contain only alphanumeric characters, hyphens, and underscores'
        )
      })

      it('allows valid characters', () => {
        const registry = new ToolRegistry()
        const tool1 = createMockTool('valid_name')
        const tool2 = createMockTool('valid-name')
        const tool3 = createMockTool('ValidName123')

        expect(() => {
          registry.register([tool1, tool2, tool3])
        }).not.toThrow()

        expect(registry.list()).toHaveLength(3)
      })
    })

    describe('when registering a tool with empty description', () => {
      it('throws an error with descriptive message', () => {
        const registry = new ToolRegistry()
        const tool = createMockTool('validName', '')

        expect(() => registry.register(tool)).toThrow('Tool description must be a non-empty string')
      })
    })

    describe('when registering a tool with valid name at boundary', () => {
      it('accepts name with 1 character', () => {
        const registry = new ToolRegistry()
        const tool = createMockTool('a')

        expect(() => registry.register(tool)).not.toThrow()
        expect(registry.get('a')).toBe(tool)
      })

      it('accepts name with 64 characters', () => {
        const registry = new ToolRegistry()
        const name64 = 'a'.repeat(64)
        const tool = createMockTool(name64)

        expect(() => registry.register(tool)).not.toThrow()
        expect(registry.get(name64)).toBe(tool)
      })
    })
  })

  describe('get', () => {
    describe('when tool exists', () => {
      it('returns the tool instance', () => {
        const registry = new ToolRegistry()
        const tool = createMockTool('existingTool')
        registry.register(tool)

        const retrieved = registry.get('existingTool')
        expect(retrieved).toBe(tool)
      })
    })

    describe('when tool does not exist', () => {
      it('returns undefined', () => {
        const registry = new ToolRegistry()
        expect(registry.get('nonExistentTool')).toBeUndefined()
      })
    })

    describe('when registry is empty', () => {
      it('returns undefined', () => {
        const registry = new ToolRegistry()
        expect(registry.get('anyTool')).toBeUndefined()
      })
    })
  })
  describe('remove', () => {
    describe('when removing an existing tool', () => {
      it('removes the tool from registry', () => {
        const registry = new ToolRegistry()
        const tool = createMockTool('removableTool')
        registry.register(tool)

        registry.remove('removableTool')

        expect(registry.list()).toEqual([])
      })

      it('get() returns undefined after removal', () => {
        const registry = new ToolRegistry()
        const tool = createMockTool('temporaryTool')
        registry.register(tool)

        registry.remove('temporaryTool')

        expect(registry.get('temporaryTool')).toBeUndefined()
      })
    })

    describe('when tool does not exist', () => {
      it('throws an error with descriptive message', () => {
        const registry = new ToolRegistry()
        expect(() => registry.remove('nonExistent')).toThrow("Tool with name 'nonExistent' not found")
      })
    })
  })

  describe('list', () => {
    describe('when registry has tools', () => {
      it('returns all registered tools', () => {
        const registry = new ToolRegistry()
        const tool1 = createMockTool('listTool1')
        const tool2 = createMockTool('listTool2')
        const tool3 = createMockTool('listTool3')

        registry.register([tool1, tool2, tool3])

        const tools = registry.list()
        expect(tools).toEqual([tool1, tool2, tool3])
      })

      it('returns a copy (mutation does not affect registry)', () => {
        const registry = new ToolRegistry()
        const tool1 = createMockTool('copyTool1')
        const tool2 = createMockTool('copyTool2')

        registry.register([tool1, tool2])

        const tools = registry.list()
        tools.pop() // Mutate the returned array

        // Verify registry still has both tools
        expect(registry.list()).toEqual([tool1, tool2])
      })

      it('returns tools in insertion order', () => {
        const registry = new ToolRegistry()
        const toolA = createMockTool('orderA')
        const toolB = createMockTool('orderB')
        const toolC = createMockTool('orderC')

        registry.register(toolA)
        registry.register(toolB)
        registry.register(toolC)

        const tools = registry.list()
        expect(tools).toHaveLength(3)
        expect(tools[0]?.toolName).toBe('orderA')
        expect(tools[1]?.toolName).toBe('orderB')
        expect(tools[2]?.toolName).toBe('orderC')
      })
    })

    describe('when registry is empty', () => {
      it('returns an empty array', () => {
        const registry = new ToolRegistry()
        expect(registry.list()).toEqual([])
      })
    })

    describe('after adding and removing tools', () => {
      it('reflects current state', () => {
        const registry = new ToolRegistry()
        const tool1 = createMockTool('stateTool1')
        const tool2 = createMockTool('stateTool2')
        const tool3 = createMockTool('stateTool3')

        registry.register([tool1, tool2, tool3])
        expect(registry.list()).toHaveLength(3)

        registry.remove('stateTool2')
        const tools = registry.list()
        expect(tools).toHaveLength(2)
        expect(tools).toEqual([tool1, tool3])
      })
    })
  })
})
