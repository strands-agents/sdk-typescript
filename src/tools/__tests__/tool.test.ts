import { describe, it, expect } from 'vitest'
import { FunctionTool } from './function-tool'
import type { ToolContext, ToolExecutionEvent } from '@/tools/tool'
import type { ToolResult } from '@/tools/types'

describe('FunctionTool', () => {
  describe('properties', () => {
    it('has a non-empty toolName', () => {
      const tool = new FunctionTool('testTool', 'Test description', { type: 'object' }, () => 'result')
      expect(tool.toolName).toBeTruthy()
      expect(typeof tool.toolName).toBe('string')
      expect(tool.toolName.length).toBeGreaterThan(0)
      expect(tool.toolName).toBe('testTool')
    })

    it('has a non-empty description', () => {
      const tool = new FunctionTool('testTool', 'Test description', { type: 'object' }, () => 'result')
      expect(tool.description).toBeTruthy()
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.description).toBe('Test description')
    })

    it('has a valid toolSpec', () => {
      const inputSchema = {
        type: 'object' as const,
        properties: {
          value: { type: 'string' as const },
        },
      }
      const tool = new FunctionTool('testTool', 'Test description', inputSchema, () => 'result')
      expect(tool.toolSpec).toBeDefined()
      expect(tool.toolSpec.name).toBe(tool.toolName)
      expect(tool.toolSpec.description).toBe(tool.description)
      expect(tool.toolSpec.inputSchema).toBe(inputSchema)
    })

    it('has matching toolName and toolSpec.name', () => {
      const tool = new FunctionTool('testTool', 'Test description', { type: 'object' }, () => 'result')
      expect(tool.toolName).toBe(tool.toolSpec.name)
    })

    it('has matching description and toolSpec.description', () => {
      const tool = new FunctionTool('testTool', 'Test description', { type: 'object' }, () => 'result')
      expect(tool.description).toBe(tool.toolSpec.description)
    })
  })

  describe('stream method', () => {
    describe('with synchronous callback', () => {
      it('wraps return value in ToolResult', async () => {
        const tool = new FunctionTool(
          'syncTool',
          'Returns synchronous value',
          { type: 'object', properties: { value: { type: 'number' } } },
          (input: unknown) => {
            const { value } = input as { value: number }
            return value * 2
          }
        )

        const toolUse = {
          name: 'syncTool',
          toolUseId: 'test-sync-1',
          input: { value: 5 },
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        expect(events.length).toBe(1)
        const result = events[0] as ToolResult
        expect(result.toolUseId).toBe('test-sync-1')
        expect(result.status).toBe('success')
        expect(result.content.length).toBeGreaterThan(0)
      })

      it('handles string return values', async () => {
        const tool = new FunctionTool(
          'stringTool',
          'Returns string',
          { type: 'object' },
          () => 'Hello, World!'
        )

        const toolUse = {
          name: 'stringTool',
          toolUseId: 'test-string',
          input: {},
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        expect(events.length).toBe(1)
        const result = events[0] as ToolResult
        expect(result.status).toBe('success')
        expect(result.content[0]).toHaveProperty('type', 'toolResultTextContent')
      })

      it('handles object return values', async () => {
        const tool = new FunctionTool(
          'objectTool',
          'Returns object',
          { type: 'object' },
          () => ({ key: 'value', count: 42 })
        )

        const toolUse = {
          name: 'objectTool',
          toolUseId: 'test-object',
          input: {},
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        expect(events.length).toBe(1)
        const result = events[0] as ToolResult
        expect(result.status).toBe('success')
      })

      it('handles null and undefined return values', async () => {
        const tool = new FunctionTool('nullTool', 'Returns null', { type: 'object' }, () => null)

        const toolUse = {
          name: 'nullTool',
          toolUseId: 'test-null',
          input: {},
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        expect(events.length).toBe(1)
        const result = events[0] as ToolResult
        expect(result.status).toBe('success')
      })
    })

    describe('with promise callback', () => {
      it('wraps resolved value in ToolResult', async () => {
        const tool = new FunctionTool(
          'promiseTool',
          'Returns promise',
          { type: 'object', properties: { value: { type: 'number' } } },
          async (input: unknown) => {
            const { value } = input as { value: number }
            return value + 10
          }
        )

        const toolUse = {
          name: 'promiseTool',
          toolUseId: 'test-promise-1',
          input: { value: 5 },
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        expect(events.length).toBe(1)
        const result = events[0] as ToolResult
        expect(result.toolUseId).toBe('test-promise-1')
        expect(result.status).toBe('success')
      })

      it('can access ToolContext in promise', async () => {
        const tool = new FunctionTool(
          'contextTool',
          'Uses context',
          { type: 'object' },
          async (_input: unknown, context: ToolContext) => {
            return context.invocationState
          }
        )

        const toolUse = {
          name: 'contextTool',
          toolUseId: 'test-context',
          input: {},
        }
        const context: ToolContext = { invocationState: { userId: 'user-123' } }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        expect(events.length).toBe(1)
        const result = events[0] as ToolResult
        expect(result.status).toBe('success')
      })
    })

    describe('with async generator callback', () => {
      it('yields ToolStreamEvents then final ToolResult', async () => {
        const tool = new FunctionTool(
          'generatorTool',
          'Streams progress',
          { type: 'object' },
          async function* (_input: unknown, _context: ToolContext) {
            yield 'Starting...'
            yield 'Processing...'
            yield 'Complete!'
            return 'Final result'
          }
        )

        const toolUse = {
          name: 'generatorTool',
          toolUseId: 'test-gen-1',
          input: {},
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        // Should have multiple events: 3 stream events + 1 result
        expect(events.length).toBeGreaterThan(1)

        // Check that intermediate events are ToolStreamEvents
        for (let i = 0; i < events.length - 1; i++) {
          const event = events[i]
          if (event && 'type' in event && event.type === 'toolStreamEvent') {
            expect(event.type).toBe('toolStreamEvent')
            expect(event).toHaveProperty('data')
          }
        }

        // Final event should be ToolResult
        const finalEvent = events[events.length - 1] as ToolResult
        expect(finalEvent).toHaveProperty('toolUseId', 'test-gen-1')
        expect(finalEvent).toHaveProperty('status', 'success')
        expect(finalEvent).toHaveProperty('content')
      })

      it('can yield objects as ToolStreamEvents', async () => {
        const tool = new FunctionTool(
          'objectGenTool',
          'Streams objects',
          { type: 'object' },
          async function* () {
            yield { progress: 0.25, message: 'Quarter done' }
            yield { progress: 0.5, message: 'Halfway done' }
            yield { progress: 1.0, message: 'Complete' }
            return 'Done'
          }
        )

        const toolUse = {
          name: 'objectGenTool',
          toolUseId: 'test-obj-gen',
          input: {},
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        expect(events.length).toBeGreaterThan(1)

        // Verify intermediate events have data
        const streamEvents = events.slice(0, -1)
        for (const event of streamEvents) {
          if ('type' in event && event.type === 'toolStreamEvent') {
            expect(event.data).toBeDefined()
          }
        }
      })
    })

    describe('error handling', () => {
      it('catches synchronous errors', async () => {
        const tool = new FunctionTool('errorTool', 'Throws error', { type: 'object' }, () => {
          throw new Error('Something went wrong')
        })

        const toolUse = {
          name: 'errorTool',
          toolUseId: 'test-error-1',
          input: {},
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        expect(events.length).toBe(1)
        const result = events[0] as ToolResult
        expect(result.toolUseId).toBe('test-error-1')
        expect(result.status).toBe('error')
        expect(result.content.length).toBeGreaterThan(0)
        expect(result.content[0]).toHaveProperty('type', 'toolResultTextContent')
      })

      it('catches promise rejections', async () => {
        const tool = new FunctionTool('rejectTool', 'Rejects promise', { type: 'object' }, async () => {
          throw new Error('Promise rejected')
        })

        const toolUse = {
          name: 'rejectTool',
          toolUseId: 'test-error-2',
          input: {},
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        expect(events.length).toBe(1)
        const result = events[0] as ToolResult
        expect(result.status).toBe('error')
      })

      it('catches errors in async generators', async () => {
        const tool = new FunctionTool(
          'genErrorTool',
          'Generator throws',
          { type: 'object' },
          async function* () {
            yield 'Starting...'
            throw new Error('Generator error')
          }
        )

        const toolUse = {
          name: 'genErrorTool',
          toolUseId: 'test-error-3',
          input: {},
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        // Should have at least one event (could have stream event before error)
        expect(events.length).toBeGreaterThan(0)

        // Final event should be error result
        const finalEvent = events[events.length - 1] as ToolResult
        expect(finalEvent.status).toBe('error')
      })

      it('handles non-Error thrown values', async () => {
        const tool = new FunctionTool('stringErrorTool', 'Throws string', { type: 'object' }, () => {
          throw 'String error'
        })

        const toolUse = {
          name: 'stringErrorTool',
          toolUseId: 'test-error-4',
          input: {},
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        expect(events.length).toBe(1)
        const result = events[0] as ToolResult
        expect(result.status).toBe('error')
      })
    })
  })
})

describe('Tool interface backwards compatibility', () => {
  it('maintains stable interface signature', () => {
    const tool = new FunctionTool('testTool', 'Test description', { type: 'object' }, () => 'result')

    // Verify interface properties exist
    expect(tool).toHaveProperty('toolName')
    expect(tool).toHaveProperty('description')
    expect(tool).toHaveProperty('toolSpec')
    expect(tool).toHaveProperty('stream')

    // Verify stream is a function
    expect(typeof tool.stream).toBe('function')
  })

  it('stream method accepts correct parameter types', async () => {
    const tool = new FunctionTool('testTool', 'Test description', { type: 'object' }, (input: unknown) => input)
    const toolUse = {
      name: 'testTool',
      toolUseId: 'test-types',
      input: { value: 123 },
    }
    const context: ToolContext = { invocationState: {} }

    // This should compile and execute without type errors
    const stream = tool.stream(toolUse, context)
    expect(stream).toBeDefined()
    expect(Symbol.asyncIterator in stream).toBe(true)

    // Consume the stream
    const events: ToolExecutionEvent[] = []
    for await (const event of stream) {
      events.push(event)
    }

    expect(events.length).toBeGreaterThan(0)
  })
})
