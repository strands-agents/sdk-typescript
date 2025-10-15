import { describe, it, expect } from 'vitest'
import { MockAgentTool } from './mock-tool'
import type { ToolContext, ToolExecutionEvent } from '@/tools/tool'
import type { ToolResult } from '@/tools/types'

describe('MockAgentTool', () => {
  describe('properties', () => {
    it('has a non-empty toolName', () => {
      const tool = new MockAgentTool()
      expect(tool.toolName).toBeTruthy()
      expect(typeof tool.toolName).toBe('string')
      expect(tool.toolName.length).toBeGreaterThan(0)
    })

    it('has a non-empty description', () => {
      const tool = new MockAgentTool()
      expect(tool.description).toBeTruthy()
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
    })

    it('has a valid toolSpec', () => {
      const tool = new MockAgentTool()
      expect(tool.toolSpec).toBeDefined()
      expect(tool.toolSpec.name).toBe(tool.toolName)
      expect(tool.toolSpec.description).toBeTruthy()
      expect(tool.toolSpec.inputSchema).toBeDefined()
      expect(tool.toolSpec.inputSchema.type).toBe('object')
    })

    it('has matching toolName and toolSpec.name', () => {
      const tool = new MockAgentTool()
      expect(tool.toolName).toBe(tool.toolSpec.name)
    })
  })

  describe('stream method', () => {
    describe('with valid input', () => {
      it('yields events and returns success result for addition', async () => {
        const tool = new MockAgentTool()
        const toolUse = {
          name: 'mockCalculator',
          toolUseId: 'test-123',
          input: { operation: 'add', a: 5, b: 3 },
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        // Should have at least one event (the final ToolResult)
        expect(events.length).toBeGreaterThan(0)

        // Final event should be a ToolResult
        const finalEvent = events[events.length - 1]
        expect(finalEvent).toHaveProperty('toolUseId')
        expect(finalEvent).toHaveProperty('status')
        expect(finalEvent).toHaveProperty('content')

        const result = finalEvent as ToolResult
        expect(result.toolUseId).toBe('test-123')
        expect(result.status).toBe('success')
        expect(result.content.length).toBeGreaterThan(0)
      })

      it('yields events and returns success result for subtraction', async () => {
        const tool = new MockAgentTool()
        const toolUse = {
          name: 'mockCalculator',
          toolUseId: 'test-456',
          input: { operation: 'subtract', a: 10, b: 3 },
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        const finalEvent = events[events.length - 1] as ToolResult
        expect(finalEvent.status).toBe('success')
        expect(finalEvent.toolUseId).toBe('test-456')
      })

      it('yields events and returns success result for multiplication', async () => {
        const tool = new MockAgentTool()
        const toolUse = {
          name: 'mockCalculator',
          toolUseId: 'test-789',
          input: { operation: 'multiply', a: 4, b: 7 },
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        const finalEvent = events[events.length - 1] as ToolResult
        expect(finalEvent.status).toBe('success')
        expect(finalEvent.toolUseId).toBe('test-789')
      })

      it('yields events and returns success result for division', async () => {
        const tool = new MockAgentTool()
        const toolUse = {
          name: 'mockCalculator',
          toolUseId: 'test-012',
          input: { operation: 'divide', a: 20, b: 4 },
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        const finalEvent = events[events.length - 1] as ToolResult
        expect(finalEvent.status).toBe('success')
        expect(finalEvent.toolUseId).toBe('test-012')
      })

      it('may yield ToolStreamEvents before final ToolResult', async () => {
        const tool = new MockAgentTool()
        const toolUse = {
          name: 'mockCalculator',
          toolUseId: 'test-345',
          input: { operation: 'add', a: 1, b: 2 },
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        // Should have at least one event
        expect(events.length).toBeGreaterThan(0)

        // Check that we can distinguish event types
        for (let i = 0; i < events.length - 1; i++) {
          const event = events[i]
          if (event) {
            // Events before the last one could be ToolStreamEvents
            if ('type' in event && event.type === 'toolStreamEvent') {
              expect(event.type).toBe('toolStreamEvent')
            }
          }
        }

        // Final event is always ToolResult
        const finalEvent = events[events.length - 1]
        expect(finalEvent).toBeDefined()
        expect(finalEvent).toHaveProperty('status')
      })
    })

    describe('with invalid input', () => {
      it('returns error result for missing operation', async () => {
        const tool = new MockAgentTool()
        const toolUse = {
          name: 'mockCalculator',
          toolUseId: 'test-error-1',
          input: { a: 5, b: 3 },
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        const finalEvent = events[events.length - 1] as ToolResult
        expect(finalEvent.status).toBe('error')
        expect(finalEvent.toolUseId).toBe('test-error-1')
        expect(finalEvent.content.length).toBeGreaterThan(0)
      })

      it('returns error result for missing operands', async () => {
        const tool = new MockAgentTool()
        const toolUse = {
          name: 'mockCalculator',
          toolUseId: 'test-error-2',
          input: { operation: 'add' },
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        const finalEvent = events[events.length - 1] as ToolResult
        expect(finalEvent.status).toBe('error')
        expect(finalEvent.toolUseId).toBe('test-error-2')
      })

      it('returns error result for invalid operation', async () => {
        const tool = new MockAgentTool()
        const toolUse = {
          name: 'mockCalculator',
          toolUseId: 'test-error-3',
          input: { operation: 'power', a: 2, b: 3 },
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        const finalEvent = events[events.length - 1] as ToolResult
        expect(finalEvent.status).toBe('error')
        expect(finalEvent.toolUseId).toBe('test-error-3')
      })

      it('returns error result for division by zero', async () => {
        const tool = new MockAgentTool()
        const toolUse = {
          name: 'mockCalculator',
          toolUseId: 'test-error-4',
          input: { operation: 'divide', a: 10, b: 0 },
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        const finalEvent = events[events.length - 1] as ToolResult
        expect(finalEvent.status).toBe('error')
        expect(finalEvent.toolUseId).toBe('test-error-4')
      })

      it('returns error result for non-numeric inputs', async () => {
        const tool = new MockAgentTool()
        const toolUse = {
          name: 'mockCalculator',
          toolUseId: 'test-error-5',
          input: { operation: 'add', a: 'five', b: 3 },
        }
        const context: ToolContext = { invocationState: {} }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        const finalEvent = events[events.length - 1] as ToolResult
        expect(finalEvent.status).toBe('error')
        expect(finalEvent.toolUseId).toBe('test-error-5')
      })
    })

    describe('with ToolContext', () => {
      it('receives and can access invocationState', async () => {
        const tool = new MockAgentTool()
        const toolUse = {
          name: 'mockCalculator',
          toolUseId: 'test-context',
          input: { operation: 'add', a: 1, b: 2 },
        }
        const context: ToolContext = {
          invocationState: { userId: 'user-123', sessionId: 'session-456' },
        }

        const events: ToolExecutionEvent[] = []
        for await (const event of tool.stream(toolUse, context)) {
          events.push(event)
        }

        // Should complete successfully even with context
        const finalEvent = events[events.length - 1] as ToolResult
        expect(finalEvent.status).toBe('success')
      })
    })
  })
})

describe('Tool interface backwards compatibility', () => {
  it('maintains stable interface signature', () => {
    const tool = new MockAgentTool()

    // Verify interface properties exist
    expect(tool).toHaveProperty('toolName')
    expect(tool).toHaveProperty('description')
    expect(tool).toHaveProperty('toolSpec')
    expect(tool).toHaveProperty('stream')

    // Verify stream is a function
    expect(typeof tool.stream).toBe('function')
  })

  it('stream method accepts correct parameter types', async () => {
    const tool = new MockAgentTool()
    const toolUse = {
      name: 'mockCalculator',
      toolUseId: 'test-types',
      input: { operation: 'add', a: 1, b: 1 },
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
