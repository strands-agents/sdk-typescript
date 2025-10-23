import { describe, it, expect } from 'vitest'
import { FunctionTool } from '../function-tool'
import type { ToolContext, ToolStreamEvent } from '../tool'
import type { ToolResult } from '../types'
import type { JSONValue } from '../../types/json'

/**
 * Helper function to consume an async generator and collect all events including the return value.
 * For await loops only capture yielded values, not the return value.
 */
async function collectGeneratorEvents(generator: AsyncGenerator<ToolStreamEvent, ToolResult, unknown>): Promise<{
  streamEvents: ToolStreamEvent[]
  result: ToolResult
}> {
  const streamEvents: ToolStreamEvent[] = []
  let result = await generator.next()

  while (!result.done) {
    streamEvents.push(result.value)
    result = await generator.next()
  }

  return {
    streamEvents,
    result: result.value,
  }
}

describe('FunctionTool', () => {
  describe('properties', () => {
    it('has a non-empty toolName', () => {
      const tool = new FunctionTool({
        name: 'testTool',
        description: 'Test description',
        inputSchema: { type: 'object' },
        callback: (): string => 'result',
      })
      expect(tool.toolName).toBeTruthy()
      expect(typeof tool.toolName).toBe('string')
      expect(tool.toolName.length).toBeGreaterThan(0)
      expect(tool.toolName).toBe('testTool')
    })

    it('has a non-empty description', () => {
      const tool = new FunctionTool({
        name: 'testTool',
        description: 'Test description',
        inputSchema: { type: 'object' },
        callback: (): string => 'result',
      })
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
      const tool = new FunctionTool({
        name: 'testTool',
        description: 'Test description',
        inputSchema,
        callback: (): string => 'result',
      })

      // Verify entire toolSpec object at once
      expect(tool.toolSpec).toEqual({
        name: 'testTool',
        description: 'Test description',
        inputSchema,
      })
    })

    it('has matching toolName and toolSpec.name', () => {
      const tool = new FunctionTool({
        name: 'testTool',
        description: 'Test description',
        inputSchema: { type: 'object' },
        callback: (): string => 'result',
      })
      expect(tool.toolName).toBe(tool.toolSpec.name)
    })

    it('has matching description and toolSpec.description', () => {
      const tool = new FunctionTool({
        name: 'testTool',
        description: 'Test description',
        inputSchema: { type: 'object' },
        callback: (): string => 'result',
      })
      expect(tool.description).toBe(tool.toolSpec.description)
    })
  })

  describe('stream method', () => {
    describe('with synchronous callback', () => {
      it('wraps return value in ToolResult', async () => {
        const tool = new FunctionTool({
          name: 'syncTool',
          description: 'Returns synchronous value',
          inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
          callback: (input: unknown): number => {
            const { value } = input as { value: number }
            return value * 2
          },
        })

        const toolUse = {
          name: 'syncTool',
          toolUseId: 'test-sync-1',
          input: { value: 5 },
        }
        const context: ToolContext = { toolUse, invocationState: {} }

        const { streamEvents, result } = await collectGeneratorEvents(
          tool.stream({ toolUse, invocationState: context.invocationState })
        )

        // No stream events for sync callback
        expect(streamEvents.length).toBe(0)

        // Verify entire result with actual calculated value
        expect(result).toEqual({
          toolUseId: 'test-sync-1',
          status: 'success',
          content: [
            {
              type: 'toolResultTextContent',
              text: '10', // 5 * 2 = 10
            },
          ],
        })
      })

      it('handles string return values', async () => {
        const tool = new FunctionTool({
          name: 'stringTool',
          description: 'Returns string',
          inputSchema: { type: 'object' },
          callback: (): string => 'Hello, World!',
        })

        const toolUse = {
          name: 'stringTool',
          toolUseId: 'test-string',
          input: {},
        }
        const context: ToolContext = { toolUse, invocationState: {} }

        const { streamEvents, result } = await collectGeneratorEvents(
          tool.stream({ toolUse, invocationState: context.invocationState })
        )

        expect(streamEvents.length).toBe(0)

        // Verify entire result object
        expect(result).toEqual({
          toolUseId: 'test-string',
          status: 'success',
          content: [
            {
              type: 'toolResultTextContent',
              text: 'Hello, World!',
            },
          ],
        })
      })

      it('handles object return values', async () => {
        const tool = new FunctionTool({
          name: 'objectTool',
          description: 'Returns object',
          inputSchema: { type: 'object' },
          callback: (): { key: string; count: number } => ({ key: 'value', count: 42 }),
        })

        const toolUse = {
          name: 'objectTool',
          toolUseId: 'test-object',
          input: {},
        }
        const context: ToolContext = { toolUse, invocationState: {} }

        const { streamEvents, result } = await collectGeneratorEvents(
          tool.stream({ toolUse, invocationState: context.invocationState })
        )

        expect(streamEvents.length).toBe(0)

        // Verify result structure
        expect(result.toolUseId).toBe('test-object')
        expect(result.status).toBe('success')
        expect(result.content.length).toBe(1)
        expect(result.content[0]).toHaveProperty('type', 'toolResultTextContent')

        // Verify the content contains the serialized object
        const content = result.content[0] as { type: string; text: string }
        const parsedContent = JSON.parse(content.text)
        expect(parsedContent).toEqual({ key: 'value', count: 42 })
      })

      it('passes input to callback exactly as provided to stream', async () => {
        const inputData = { name: 'test', value: 42, nested: { key: 'value' } }
        let receivedInput: unknown

        const tool = new FunctionTool({
          name: 'inputTool',
          description: 'Captures input',
          inputSchema: { type: 'object' },
          callback: (input: unknown): string => {
            receivedInput = input
            return 'success'
          },
        })

        const toolUse = {
          name: 'inputTool',
          toolUseId: 'test-input',
          input: inputData,
        }

        await collectGeneratorEvents(tool.stream({ toolUse, invocationState: {} }))

        expect(receivedInput).toEqual(inputData)
      })

      it('handles null return values correctly', async () => {
        const tool = new FunctionTool({
          name: 'nullTool',
          description: 'Returns null',
          inputSchema: { type: 'object' },
          callback: (): null => null,
        })

        const { result } = await collectGeneratorEvents(
          tool.stream({ toolUse: { name: 'nullTool', toolUseId: 'test-null', input: {} }, invocationState: {} })
        )

        expect(result).toEqual({
          toolUseId: 'test-null',
          status: 'success',
          content: [{ type: 'toolResultTextContent', text: '<null>' }],
        })
      })

      it('handles undefined return values correctly', async () => {
        const tool = new FunctionTool({
          name: 'undefinedTool',
          description: 'Returns undefined',
          inputSchema: { type: 'object' },
          // @ts-expect-error we're intentionally testing a type violation
          callback: (): undefined => undefined,
        })

        const { result } = await collectGeneratorEvents(
          tool.stream({
            toolUse: { name: 'undefinedTool', toolUseId: 'test-undefined', input: {} },
            invocationState: {},
          })
        )

        expect(result).toEqual({
          toolUseId: 'test-undefined',
          status: 'success',
          content: [{ type: 'toolResultTextContent', text: '<undefined>' }],
        })
      })
    })

    describe('with promise callback', () => {
      it('wraps resolved value in ToolResult', async () => {
        const tool = new FunctionTool({
          name: 'promiseTool',
          description: 'Returns promise',
          inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
          callback: async (input: unknown): Promise<number> => {
            const { value } = input as { value: number }
            return value + 10
          },
        })

        const toolUse = {
          name: 'promiseTool',
          toolUseId: 'test-promise-1',
          input: { value: 5 },
        }
        const context: ToolContext = { toolUse, invocationState: {} }

        const { streamEvents, result } = await collectGeneratorEvents(
          tool.stream({ toolUse, invocationState: context.invocationState })
        )

        expect(streamEvents.length).toBe(0)
        expect(result.toolUseId).toBe('test-promise-1')
        expect(result.status).toBe('success')
        expect(result.status).toBe('success')
      })

      it('can access ToolContext in promise', async () => {
        const tool = new FunctionTool({
          name: 'contextTool',
          description: 'Uses context',
          inputSchema: { type: 'object' },
          callback: async (_input: unknown, context: ToolContext): Promise<JSONValue> => {
            return context.invocationState as JSONValue
          },
        })

        const toolUse = {
          name: 'contextTool',
          toolUseId: 'test-context',
          input: {},
        }
        const context: ToolContext = { toolUse, invocationState: { userId: 'user-123' } }

        const { streamEvents, result } = await collectGeneratorEvents(
          tool.stream({ toolUse, invocationState: context.invocationState })
        )

        expect(streamEvents.length).toBe(0)
        expect(result.status).toBe('success')
      })
    })

    describe('with async generator callback', () => {
      it('yields ToolStreamEvents then final ToolResult', async () => {
        const tool = new FunctionTool({
          name: 'generatorTool',
          description: 'Streams progress',
          inputSchema: { type: 'object' },
          callback: async function* (): AsyncGenerator<string, string, unknown> {
            yield 'Starting...'
            yield 'Processing...'
            yield 'Complete!'
            return 'Final result'
          },
        })

        const toolUse = {
          name: 'generatorTool',
          toolUseId: 'test-gen-1',
          input: {},
        }
        const context: ToolContext = { toolUse, invocationState: {} }

        const { streamEvents, result } = await collectGeneratorEvents(
          tool.stream({ toolUse, invocationState: context.invocationState })
        )

        // Should have 3 stream events
        expect(streamEvents.length).toBe(3)

        // Verify all stream events are as expected
        expect(streamEvents).toEqual([
          { type: 'toolStreamEvent', data: 'Starting...' },
          { type: 'toolStreamEvent', data: 'Processing...' },
          { type: 'toolStreamEvent', data: 'Complete!' },
        ])

        // Verify entire result object
        expect(result).toEqual({
          toolUseId: 'test-gen-1',
          status: 'success',
          content: [
            {
              type: 'toolResultTextContent',
              text: 'Final result',
            },
          ],
        })
      })

      it('can yield objects as ToolStreamEvents', async () => {
        const tool = new FunctionTool({
          name: 'objectGenTool',
          description: 'Streams objects',
          inputSchema: { type: 'object' },
          callback: async function* (): AsyncGenerator<{ progress: number; message: string }, string, unknown> {
            yield { progress: 0.25, message: 'Quarter done' }
            yield { progress: 0.5, message: 'Halfway done' }
            yield { progress: 1.0, message: 'Complete' }
            return 'Done'
          },
        })

        const toolUse = {
          name: 'objectGenTool',
          toolUseId: 'test-obj-gen',
          input: {},
        }
        const context: ToolContext = { toolUse, invocationState: {} }

        const { streamEvents, result } = await collectGeneratorEvents(
          tool.stream({ toolUse, invocationState: context.invocationState })
        )

        expect(streamEvents.length).toBe(3)

        // Verify all stream events have data
        for (const event of streamEvents) {
          expect(event.type).toBe('toolStreamEvent')
          expect(event.data).toBeDefined()
        }

        // Verify final result
        expect(result.status).toBe('success')
      })
    })

    describe('error handling', () => {
      it('catches synchronous errors', async () => {
        const tool = new FunctionTool({
          name: 'errorTool',
          description: 'Throws error',
          inputSchema: { type: 'object' },
          callback: (): never => {
            throw new Error('Something went wrong')
          },
        })

        const toolUse = {
          name: 'errorTool',
          toolUseId: 'test-error-1',
          input: {},
        }
        const context: ToolContext = { toolUse, invocationState: {} }

        const { streamEvents, result } = await collectGeneratorEvents(
          tool.stream({ toolUse, invocationState: context.invocationState })
        )

        expect(streamEvents.length).toBe(0)
        expect(result.toolUseId).toBe('test-error-1')
        expect(result.status).toBe('error')
        expect(result.content.length).toBeGreaterThan(0)
        expect(result.content[0]).toHaveProperty('type', 'toolResultTextContent')
      })

      it('catches promise rejections', async () => {
        const tool = new FunctionTool({
          name: 'rejectTool',
          description: 'Rejects promise',
          inputSchema: { type: 'object' },
          callback: async (): Promise<never> => {
            throw new Error('Promise rejected')
          },
        })

        const toolUse = {
          name: 'rejectTool',
          toolUseId: 'test-error-2',
          input: {},
        }
        const context: ToolContext = { toolUse, invocationState: {} }

        const { streamEvents, result } = await collectGeneratorEvents(
          tool.stream({ toolUse, invocationState: context.invocationState })
        )

        expect(streamEvents.length).toBe(0)
        expect(result.status).toBe('error')
      })

      it('catches errors in async generators', async () => {
        const tool = new FunctionTool({
          name: 'genErrorTool',
          description: 'Generator throws',
          inputSchema: { type: 'object' },
          callback: async function* (): AsyncGenerator<string, never, unknown> {
            yield 'Starting...'
            throw new Error('Generator error')
          },
        })

        const toolUse = {
          name: 'genErrorTool',
          toolUseId: 'test-error-3',
          input: {},
        }
        const context: ToolContext = { toolUse, invocationState: {} }

        const { streamEvents, result } = await collectGeneratorEvents(
          tool.stream({ toolUse, invocationState: context.invocationState })
        )

        // Should have one stream event before the error
        expect(streamEvents.length).toBe(1)
        expect(streamEvents[0]?.type).toBe('toolStreamEvent')

        // Final result should be error
        expect(result.status).toBe('error')
      })

      it('handles non-Error thrown values', async () => {
        const tool = new FunctionTool({
          name: 'stringErrorTool',
          description: 'Throws string',
          inputSchema: { type: 'object' },
          callback: (): never => {
            throw 'String error'
          },
        })

        const toolUse = {
          name: 'stringErrorTool',
          toolUseId: 'test-error-4',
          input: {},
        }
        const context: ToolContext = { toolUse, invocationState: {} }

        const { streamEvents, result } = await collectGeneratorEvents(
          tool.stream({ toolUse, invocationState: context.invocationState })
        )

        expect(streamEvents.length).toBe(0)
        expect(result.status).toBe('error')
      })
    })
  })
})

describe('Tool interface backwards compatibility', () => {
  it('maintains stable interface signature', () => {
    const tool = new FunctionTool({
      name: 'testTool',
      description: 'Test description',
      inputSchema: { type: 'object' },
      callback: (): string => 'result',
    })

    // Verify interface properties exist
    expect(tool).toHaveProperty('toolName')
    expect(tool).toHaveProperty('description')
    expect(tool).toHaveProperty('toolSpec')
    expect(tool).toHaveProperty('stream')

    // Verify stream is a function
    expect(typeof tool.stream).toBe('function')
  })

  it('stream method accepts correct parameter types', async () => {
    const tool = new FunctionTool({
      name: 'testTool',
      description: 'Test description',
      inputSchema: { type: 'object' },
      callback: (input: unknown): JSONValue => input as JSONValue,
    })
    const toolUse = {
      name: 'testTool',
      toolUseId: 'test-types',
      input: { value: 123 },
    }
    const context: ToolContext = { toolUse, invocationState: {} }

    // This should compile and execute without type errors
    const stream = tool.stream({ ...context, toolUse })
    expect(stream).toBeDefined()
    expect(Symbol.asyncIterator in stream).toBe(true)

    // Consume the stream with helper
    const { result } = await collectGeneratorEvents(stream)

    expect(result).toBeDefined()
    expect(result.status).toBe('success')
  })
})
