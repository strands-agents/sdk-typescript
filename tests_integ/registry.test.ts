import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry } from '../src/tools/registry'
import { FunctionTool } from '../src/tools/function-tool'
import type { ToolContext } from '../src/tools/tool'

describe('ToolRegistry Integration', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  describe('complete CRUDL workflow with FunctionTool', () => {
    it('registers, retrieves, updates, lists, and removes FunctionTool instances', () => {
      // Create real FunctionTool instances
      const calculator = new FunctionTool({
        name: 'calculator',
        description: 'Performs basic arithmetic operations',
        inputSchema: {
          type: 'object',
          properties: {
            operation: { type: 'string' },
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['operation', 'a', 'b'],
        },
        callback: (input: unknown): number => {
          const { operation, a, b } = input as { operation: string; a: number; b: number }
          switch (operation) {
            case 'add':
              return a + b
            case 'subtract':
              return a - b
            case 'multiply':
              return a * b
            case 'divide':
              return a / b
            default:
              throw new Error(`Unknown operation: ${operation}`)
          }
        },
      })

      const greeter = new FunctionTool({
        name: 'greeter',
        description: 'Greets a person by name',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
        callback: (input: unknown): string => {
          const { name } = input as { name: string }
          return `Hello, ${name}!`
        },
      })

      // Register tools
      registry.register([calculator, greeter])

      // Verify registration
      expect(registry.list()).toHaveLength(2)

      // Retrieve tools
      const retrievedCalculator = registry.get('calculator')
      expect(retrievedCalculator.toolName).toBe('calculator')
      expect(retrievedCalculator.description).toBe('Performs basic arithmetic operations')

      const retrievedGreeter = registry.get('greeter')
      expect(retrievedGreeter.toolName).toBe('greeter')

      // Create an updated version of calculator
      const calculatorV2 = new FunctionTool({
        name: 'calculator',
        description: 'Enhanced calculator with more operations',
        inputSchema: {
          type: 'object',
          properties: {
            operation: { type: 'string' },
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['operation', 'a', 'b'],
        },
        callback: (input: unknown): number => {
          const { operation, a, b } = input as { operation: string; a: number; b: number }
          switch (operation) {
            case 'add':
              return a + b
            case 'subtract':
              return a - b
            case 'multiply':
              return a * b
            case 'divide':
              return a / b
            case 'power':
              return Math.pow(a, b)
            default:
              throw new Error(`Unknown operation: ${operation}`)
          }
        },
      })

      // Update calculator
      registry.update('calculator', calculatorV2)

      // Verify update
      const updatedCalculator = registry.get('calculator')
      expect(updatedCalculator.description).toBe('Enhanced calculator with more operations')

      // List all tools
      const allTools = registry.list()
      expect(allTools).toHaveLength(2)
      expect(allTools[0].toolName).toBe('calculator')
      expect(allTools[1].toolName).toBe('greeter')

      // Remove greeter
      registry.remove('greeter')

      // Verify removal
      expect(registry.list()).toHaveLength(1)
      expect(() => registry.get('greeter')).toThrow("Tool with name 'greeter' not found")

      // Verify calculator still exists
      expect(registry.get('calculator').toolName).toBe('calculator')
    })
  })

  describe('tool execution through registry', () => {
    it('retrieves and executes a registered FunctionTool', async () => {
      // Create a streaming tool
      const processor = new FunctionTool({
        name: 'processor',
        description: 'Processes data with progress updates',
        inputSchema: {
          type: 'object',
          properties: {
            data: { type: 'string' },
          },
          required: ['data'],
        },
        callback: async function* (input: unknown) {
          const { data } = input as { data: string }
          yield 'Starting processing...'
          yield `Processing: ${data}`
          yield 'Almost done...'
          return `Processed: ${data.toUpperCase()}`
        },
      })

      // Register the tool
      registry.register(processor)

      // Retrieve the tool from registry
      const retrievedTool = registry.get('processor')

      // Execute the tool
      const context: ToolContext = {
        toolUse: {
          name: 'processor',
          toolUseId: 'test-123',
          input: { data: 'hello world' },
        },
        invocationState: {},
      }

      // Manually collect all events and the return value
      const events: string[] = []
      const generator = retrievedTool.stream(context)

      let result = await generator.next()
      while (!result.done) {
        events.push(result.value.data as string)
        result = await generator.next()
      }

      // The final result.value is the ToolResult when done = true
      const toolResult = result.value

      // Verify events
      expect(events).toEqual(['Starting processing...', 'Processing: hello world', 'Almost done...'])

      // Verify final result
      expect(toolResult.status).toBe('success')
      expect(toolResult.toolUseId).toBe('test-123')
      expect(toolResult.content).toHaveLength(1)
      expect(toolResult.content[0]).toEqual({
        type: 'toolResultTextContent',
        text: 'Processed: HELLO WORLD',
      })
    })
  })

  describe('multiple registry instances', () => {
    it('maintains independent state across multiple registries', () => {
      const registry1 = new ToolRegistry()
      const registry2 = new ToolRegistry()

      const tool1 = new FunctionTool({
        name: 'tool1',
        description: 'First tool',
        inputSchema: { type: 'object' },
        callback: (): string => 'result1',
      })

      const tool2 = new FunctionTool({
        name: 'tool2',
        description: 'Second tool',
        inputSchema: { type: 'object' },
        callback: (): string => 'result2',
      })

      // Register different tools in each registry
      registry1.register(tool1)
      registry2.register(tool2)

      // Verify independence
      expect(registry1.list()).toHaveLength(1)
      expect(registry1.list()[0].toolName).toBe('tool1')

      expect(registry2.list()).toHaveLength(1)
      expect(registry2.list()[0].toolName).toBe('tool2')

      // Verify cross-contamination doesn't occur
      expect(() => registry1.get('tool2')).toThrow()
      expect(() => registry2.get('tool1')).toThrow()
    })
  })
})
