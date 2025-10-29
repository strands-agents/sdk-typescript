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
              text: '10', // 5 * 2 = 10 (converted to string)
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

        // Verify entire result object
        expect(result).toEqual({
          toolUseId: 'test-object',
          status: 'success',
          content: [
            {
              type: 'toolResultJsonContent',
              json: { key: 'value', count: 42 },
            },
          ],
        })
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

      it('handles boolean return values as text content', async () => {
        const trueTool = new FunctionTool({
          name: 'trueTool',
          description: 'Returns true',
          inputSchema: { type: 'object' },
          callback: (): boolean => true,
        })

        const { result: trueResult } = await collectGeneratorEvents(
          trueTool.stream({ toolUse: { name: 'trueTool', toolUseId: 'test-true', input: {} }, invocationState: {} })
        )

        expect(trueResult).toEqual({
          toolUseId: 'test-true',
          status: 'success',
          content: [{ type: 'toolResultTextContent', text: 'true' }],
        })

        const falseTool = new FunctionTool({
          name: 'falseTool',
          description: 'Returns false',
          inputSchema: { type: 'object' },
          callback: (): boolean => false,
        })

        const { result: falseResult } = await collectGeneratorEvents(
          falseTool.stream({ toolUse: { name: 'falseTool', toolUseId: 'test-false', input: {} }, invocationState: {} })
        )

        expect(falseResult).toEqual({
          toolUseId: 'test-false',
          status: 'success',
          content: [{ type: 'toolResultTextContent', text: 'false' }],
        })
      })

      it('handles number return values as text content', async () => {
        const tool = new FunctionTool({
          name: 'numberTool',
          description: 'Returns number',
          inputSchema: { type: 'object' },
          callback: (): number => 42,
        })

        const { result } = await collectGeneratorEvents(
          tool.stream({ toolUse: { name: 'numberTool', toolUseId: 'test-number', input: {} }, invocationState: {} })
        )

        expect(result).toEqual({
          toolUseId: 'test-number',
          status: 'success',
          content: [{ type: 'toolResultTextContent', text: '42' }],
        })

        // Test negative number
        const negativeTool = new FunctionTool({
          name: 'negativeTool',
          description: 'Returns negative number',
          inputSchema: { type: 'object' },
          callback: (): number => -3.14,
        })

        const { result: negativeResult } = await collectGeneratorEvents(
          negativeTool.stream({
            toolUse: { name: 'negativeTool', toolUseId: 'test-negative', input: {} },
            invocationState: {},
          })
        )

        expect(negativeResult).toEqual({
          toolUseId: 'test-negative',
          status: 'success',
          content: [{ type: 'toolResultTextContent', text: '-3.14' }],
        })
      })

      it('handles array return values as wrapped JSON content', async () => {
        const tool = new FunctionTool({
          name: 'arrayTool',
          description: 'Returns array',
          inputSchema: { type: 'object' },
          callback: (): JSONValue[] => [1, 2, 3, { key: 'value' }],
        })

        const { result } = await collectGeneratorEvents(
          tool.stream({ toolUse: { name: 'arrayTool', toolUseId: 'test-array', input: {} }, invocationState: {} })
        )

        expect(result).toEqual({
          toolUseId: 'test-array',
          status: 'success',
          content: [{ type: 'toolResultJsonContent', json: { $value: [1, 2, 3, { key: 'value' }] } }],
        })
      })

      it('deep copies objects to prevent mutation', async () => {
        const original = { nested: { value: 'original' } }
        const tool = new FunctionTool({
          name: 'copyTool',
          description: 'Returns object',
          inputSchema: { type: 'object' },
          callback: (): { nested: { value: string } } => original,
        })

        const { result } = await collectGeneratorEvents(
          tool.stream({ toolUse: { name: 'copyTool', toolUseId: 'test-copy', input: {} }, invocationState: {} })
        )

        // Mutate the original object
        original.nested.value = 'mutated'

        // Verify the result still has the original value
        expect(result).toEqual({
          toolUseId: 'test-copy',
          status: 'success',
          content: [{ type: 'toolResultJsonContent', json: { nested: { value: 'original' } } }],
        })
      })

      it('deep copies arrays to prevent mutation', async () => {
        const original = [{ value: 'original' }]
        const tool = new FunctionTool({
          name: 'arrayCopyTool',
          description: 'Returns array',
          inputSchema: { type: 'object' },
          callback: (): JSONValue[] => original,
        })

        const { result } = await collectGeneratorEvents(
          tool.stream({
            toolUse: { name: 'arrayCopyTool', toolUseId: 'test-array-copy', input: {} },
            invocationState: {},
          })
        )

        // Mutate the original array
        original[0]!.value = 'mutated'

        // Verify the result still has the original value (wrapped in $value)
        expect(result).toEqual({
          toolUseId: 'test-array-copy',
          status: 'success',
          content: [{ type: 'toolResultJsonContent', json: { $value: [{ value: 'original' }] } }],
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

      it('captures Error object in ToolResult when callback throws Error', async () => {
        const testError = new Error('Test error message')
        const tool = new FunctionTool({
          name: 'errorObjectTool',
          description: 'Throws Error object',
          inputSchema: { type: 'object' },
          callback: (): never => {
            throw testError
          },
        })

        const toolUse = {
          name: 'errorObjectTool',
          toolUseId: 'test-error-capture',
          input: {},
        }

        const { result } = await collectGeneratorEvents(tool.stream({ toolUse, invocationState: {} }))

        expect(result).toEqual({
          toolUseId: 'test-error-capture',
          status: 'error',
          content: [
            {
              type: 'toolResultTextContent',
              text: 'Error: Test error message',
            },
          ],
          error: testError,
        })
      })

      it('wraps non-Error thrown values into Error object', async () => {
        const tool = new FunctionTool({
          name: 'stringThrowTool',
          description: 'Throws string',
          inputSchema: { type: 'object' },
          callback: (): never => {
            throw 'string error'
          },
        })

        const toolUse = {
          name: 'stringThrowTool',
          toolUseId: 'test-string-wrap',
          input: {},
        }

        const { result } = await collectGeneratorEvents(tool.stream({ toolUse, invocationState: {} }))

        expect(result).toEqual({
          toolUseId: 'test-string-wrap',
          status: 'error',
          content: [
            {
              type: 'toolResultTextContent',
              text: 'Error: string error',
            },
          ],
          error: expect.any(Error),
        })
        expect(result.error?.message).toBe('string error')
      })

      it('preserves custom Error subclass instances', async () => {
        class CustomError extends Error {
          constructor(
            message: string,
            public code: string
          ) {
            super(message)
            this.name = 'CustomError'
          }
        }

        const customError = new CustomError('Custom error message', 'ERR_001')
        const tool = new FunctionTool({
          name: 'customErrorTool',
          description: 'Throws custom error',
          inputSchema: { type: 'object' },
          callback: (): never => {
            throw customError
          },
        })

        const toolUse = {
          name: 'customErrorTool',
          toolUseId: 'test-custom-error',
          input: {},
        }

        const { result } = await collectGeneratorEvents(tool.stream({ toolUse, invocationState: {} }))

        expect(result).toEqual({
          toolUseId: 'test-custom-error',
          status: 'error',
          content: [
            {
              type: 'toolResultTextContent',
              text: 'Error: Custom error message',
            },
          ],
          error: customError,
        })
        expect((result.error as CustomError).code).toBe('ERR_001')
      })

      it('preserves error stack traces', async () => {
        const tool = new FunctionTool({
          name: 'stackTraceTool',
          description: 'Throws error with stack trace',
          inputSchema: { type: 'object' },
          callback: (): never => {
            throw new Error('Error with stack')
          },
        })

        const toolUse = {
          name: 'stackTraceTool',
          toolUseId: 'test-stack-trace',
          input: {},
        }

        const { result } = await collectGeneratorEvents(tool.stream({ toolUse, invocationState: {} }))

        expect(result).toEqual({
          toolUseId: 'test-stack-trace',
          status: 'error',
          content: [
            {
              type: 'toolResultTextContent',
              text: 'Error: Error with stack',
            },
          ],
          error: expect.any(Error),
        })
        expect(result.error?.stack).toBeDefined()
        expect(result.error?.stack).toContain('Error: Error with stack')
      })

      it('captures errors thrown in async generator callbacks', async () => {
        const testError = new Error('Async generator error')
        const tool = new FunctionTool({
          name: 'asyncGenErrorTool',
          description: 'Async generator that throws',
          inputSchema: { type: 'object' },
          callback: async function* (): AsyncGenerator<string, never, unknown> {
            yield 'Starting...'
            throw testError
          },
        })

        const toolUse = {
          name: 'asyncGenErrorTool',
          toolUseId: 'test-async-gen-error',
          input: {},
        }

        const { streamEvents, result } = await collectGeneratorEvents(tool.stream({ toolUse, invocationState: {} }))

        // Should have one stream event before the error
        expect(streamEvents.length).toBe(1)
        expect(streamEvents[0]).toEqual({ type: 'toolStreamEvent', data: 'Starting...' })

        // Final result should have error object
        expect(result).toEqual({
          toolUseId: 'test-async-gen-error',
          status: 'error',
          content: [
            {
              type: 'toolResultTextContent',
              text: 'Error: Async generator error',
            },
          ],
          error: testError,
        })
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

      it('returns error for circular references', async () => {
        const tool = new FunctionTool({
          name: 'circularTool',
          description: 'Returns circular object',
          inputSchema: { type: 'object' },
          callback: (): JSONValue => {
            // Create circular reference

            const obj: any = { a: 1 }
            obj.self = obj
            return obj
          },
        })

        const { result } = await collectGeneratorEvents(
          tool.stream({ toolUse: { name: 'circularTool', toolUseId: 'test-circular', input: {} }, invocationState: {} })
        )

        expect(result).toEqual({
          toolUseId: 'test-circular',
          status: 'error',
          error: expect.any(Error),
          content: [
            {
              type: 'toolResultTextContent',
              text: expect.stringContaining('Error:'),
            },
          ],
        })
      })

      it('silently drops non-serializable values (functions)', async () => {
        const tool = new FunctionTool({
          name: 'functionTool',
          description: 'Returns object with function',
          inputSchema: { type: 'object' },
          callback: (): JSONValue => {
            return { fn: () => {} } as any
          },
        })

        const { result } = await collectGeneratorEvents(
          tool.stream({
            toolUse: { name: 'functionTool', toolUseId: 'test-function', input: {} },
            invocationState: {},
          })
        )

        // Functions are silently dropped during JSON serialization
        expect(result).toEqual({
          toolUseId: 'test-function',
          status: 'success',
          content: [
            {
              type: 'toolResultJsonContent',
              json: {},
            },
          ],
        })
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
