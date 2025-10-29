import type { Tool, ToolContext, ToolStreamEvent } from './tool'
import type { ToolSpec, ToolResult } from './types'
import type { JSONSchema, JSONValue } from '../types/json'
import { deepCopy } from '../types/json'

/**
 * Callback function for FunctionTool implementations.
 * The callback can return values in multiple ways, and FunctionTool handles the conversion to ToolResult.
 *
 * @param input - The input parameters conforming to the tool's inputSchema
 * @param toolContext - The tool execution context with invocation state
 * @returns Can return:
 *   - AsyncGenerator: Each yielded value becomes a ToolStreamEvent, final value wrapped in ToolResult
 *   - Promise: Resolved value is wrapped in ToolResult
 *   - Synchronous value: Value is wrapped in ToolResult
 *   - If an error is thrown, it's handled and returned as an error ToolResult
 *
 * @example
 * ```typescript
 * // Async generator example
 * async function* calculator(input: unknown, context: ToolContext) {
 *   yield 'Calculating...'
 *   const result = input.a + input.b
 *   yield `Result: ${result}`
 *   return result
 * }
 *
 * // Promise example
 * async function fetchData(input: unknown, context: ToolContext) {
 *   const response = await fetch(input.url)
 *   return await response.json()
 * }
 *
 * // Synchronous example
 * function multiply(input: unknown, context: ToolContext) {
 *   return input.a * input.b
 * }
 * ```
 */
export type FunctionToolCallback = (
  input: unknown,
  toolContext: ToolContext
) => AsyncGenerator<JSONValue, JSONValue, never> | Promise<JSONValue> | JSONValue

/**
 * Configuration options for creating a FunctionTool.
 */
export interface FunctionToolConfig {
  /** The unique name of the tool */
  name: string
  /** Human-readable description of the tool's purpose */
  description: string
  /** JSON Schema defining the expected input structure */
  inputSchema: JSONSchema
  /** Function that implements the tool logic */
  callback: FunctionToolCallback
}

/**
 * A Tool implementation that wraps a callback function and handles all ToolResult conversion.
 *
 * FunctionTool allows creating tools from existing functions without needing to manually
 * handle ToolResult formatting or error handling. It supports multiple callback patterns:
 * - Async generators for streaming responses
 * - Promises for async operations
 * - Synchronous functions for immediate results
 *
 * All return values are automatically wrapped in ToolResult, and errors are caught and
 * returned as error ToolResults.
 *
 * @example
 * ```typescript
 * // Create a tool with streaming
 * const streamingTool = new FunctionTool({
 *   name: 'processor',
 *   description: 'Processes data with progress updates',
 *   inputSchema: { type: 'object', properties: { data: { type: 'string' } } },
 *   callback: async function* (input: any) {
 *     yield 'Starting processing...'
 *     // Do some work
 *     yield 'Halfway done...'
 *     // More work
 *     return 'Processing complete!'
 *   }
 * })
 * ```
 */
export class FunctionTool implements Tool {
  /**
   * The unique name of the tool.
   */
  readonly toolName: string

  /**
   * Human-readable description of what the tool does.
   */
  readonly description: string

  /**
   * OpenAPI JSON specification for the tool.
   */
  readonly toolSpec: ToolSpec

  /**
   * The callback function that implements the tool's logic.
   */
  private readonly _callback: FunctionToolCallback

  /**
   * Creates a new FunctionTool instance.
   *
   * @param config - Configuration object for the tool
   *
   * @example
   * ```typescript
   * const tool = new FunctionTool({
   *   name: 'greeter',
   *   description: 'Greets a person by name',
   *   inputSchema: {
   *     type: 'object',
   *     properties: { name: { type: 'string' } },
   *     required: ['name']
   *   },
   *   callback: (input: any) => `Hello, ${input.name}!`
   * })
   * ```
   */
  constructor(config: FunctionToolConfig) {
    this.toolName = config.name
    this.description = config.description
    this.toolSpec = {
      name: config.name,
      description: config.description,
      inputSchema: config.inputSchema,
    }
    this._callback = config.callback
  }

  /**
   * Executes the tool with streaming support.
   * Handles all callback patterns (async generator, promise, sync) and converts results to ToolResult.
   *
   * @param toolContext - Context information including the tool use request and invocation state
   * @returns Async generator that yields ToolStreamEvents and returns a ToolResult
   */
  async *stream(toolContext: ToolContext): AsyncGenerator<ToolStreamEvent, ToolResult, unknown> {
    const { toolUse } = toolContext

    try {
      const result = this._callback(toolUse.input, toolContext)

      // Check if result is an async generator
      if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
        // Handle async generator: yield each value as ToolStreamEvent, wrap final value in ToolResult
        const generator = result as AsyncGenerator<unknown, unknown, unknown>

        // Iterate through all yielded values
        let iterResult = await generator.next()

        while (!iterResult.done) {
          // Each yielded value becomes a ToolStreamEvent
          yield {
            type: 'toolStreamEvent',
            data: iterResult.value,
          }
          iterResult = await generator.next()
        }

        // The generator's return value (when done = true) is wrapped in ToolResult
        return this._wrapInToolResult(iterResult.value, toolUse.toolUseId)
      } else if (result instanceof Promise) {
        // Handle promise: await and wrap in ToolResult
        const value = await result
        return this._wrapInToolResult(value, toolUse.toolUseId)
      } else {
        // Handle synchronous value: wrap in ToolResult
        return this._wrapInToolResult(result, toolUse.toolUseId)
      }
    } catch (error) {
      // Handle any errors and yield as error ToolResult
      return this._createErrorResult(error, toolUse.toolUseId)
    }
  }

  /**
   * Invokes the tool directly with type-safe input and returns the unwrapped result.
   * This is useful for testing and standalone tool execution.
   *
   * Unlike stream(), this method:
   * - Returns the raw result (not wrapped in ToolResult)
   * - Consumes async generators and returns only the final value
   * - Lets errors throw naturally (not wrapped in error ToolResult)
   *
   * @param input - The input parameters for the tool
   * @param context - Optional tool execution context
   * @returns The unwrapped result
   *
   * @example
   * ```typescript
   * const tool = new FunctionTool({
   *   name: 'calculator',
   *   description: 'Does math',
   *   inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
   *   callback: (input: any) => (input as any).a + (input as any).b
   * })
   *
   * const result = await tool.invoke({ a: 5, b: 3 })
   * console.log(result) // 8
   * ```
   */
  async invoke(input: unknown, context?: ToolContext): Promise<unknown> {
    // Create a minimal context if not provided
    const toolContext: ToolContext = context ?? {
      toolUse: {
        name: this.toolName,
        toolUseId: 'direct-invocation',
        input: input as JSONValue,
      },
      invocationState: {},
    }

    const result = this._callback(input, toolContext)

    // Handle async generator - consume and return final value
    if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
      const generator = result as AsyncGenerator<unknown, unknown, undefined>
      let iterResult = await generator.next()

      // Keep iterating until we reach the done state
      while (!iterResult.done) {
        iterResult = await generator.next()
      }

      // Return the final value (the return value of the generator)
      return iterResult.value
    }

    // For promises and synchronous values, await/return directly
    return await result
  }

  /**
   * Wraps a value in a ToolResult with success status.
   *
   * Due to AWS Bedrock limitations (only accepts objects as JSON content), the following
   * rules are applied:
   * - Strings → toolResultTextContent
   * - Numbers, Booleans → toolResultTextContent (converted to string)
   * - null, undefined → toolResultTextContent (special string representation)
   * - Objects → toolResultJsonContent (with deep copy)
   * - Arrays → toolResultJsonContent wrapped in \{ $value: array \} (with deep copy)
   *
   * @param value - The value to wrap (can be any type)
   * @param toolUseId - The tool use ID for the ToolResult
   * @returns A ToolResult containing the value
   */
  private _wrapInToolResult(value: unknown, toolUseId: string): ToolResult {
    try {
      // Handle null with special string representation as text content
      if (value === null) {
        return {
          toolUseId,
          status: 'success',
          content: [
            {
              type: 'toolResultTextContent',
              text: '<null>',
            },
          ],
        }
      }

      // Handle undefined with special string representation as text content
      if (value === undefined) {
        return {
          toolUseId,
          status: 'success',
          content: [
            {
              type: 'toolResultTextContent',
              text: '<undefined>',
            },
          ],
        }
      }

      // Handle primitives (strings, numbers, booleans) as text content
      // Bedrock doesn't accept primitives as JSON content, so we convert all to strings
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return {
          toolUseId,
          status: 'success',
          content: [
            {
              type: 'toolResultTextContent',
              text: String(value),
            },
          ],
        }
      }

      // Handle arrays by wrapping in object { $value: array }
      if (Array.isArray(value)) {
        const copiedValue = deepCopy(value)
        return {
          toolUseId,
          status: 'success',
          content: [
            {
              type: 'toolResultJsonContent',
              json: { $value: copiedValue },
            },
          ],
        }
      }

      // Handle objects as JSON content with deep copy
      const copiedValue = deepCopy(value)
      return {
        toolUseId,
        status: 'success',
        content: [
          {
            type: 'toolResultJsonContent',
            json: copiedValue,
          },
        ],
      }
    } catch (error) {
      // If deep copy fails (circular references, non-serializable values), return error result
      return this._createErrorResult(error, toolUseId)
    }
  }

  /**
   * Creates an error ToolResult from an error object.
   * Ensures all errors are normalized to Error objects and includes the original error
   * in the ToolResult for inspection by hooks, error handlers, and event loop.
   *
   * TODO: Implement consistent logging format as defined in #30
   * This error should be logged to the caller using the established logging pattern.
   *
   * @param error - The error that occurred (can be Error object or any thrown value)
   * @param toolUseId - The tool use ID for the ToolResult
   * @returns A ToolResult with error status, error message content, and original error object
   */
  private _createErrorResult(error: unknown, toolUseId: string): ToolResult {
    // Ensure error is an Error object (wrap non-Error values)
    const errorObject = error instanceof Error ? error : new Error(String(error))

    return {
      toolUseId,
      status: 'error',
      content: [
        {
          type: 'toolResultTextContent',
          text: `Error: ${errorObject.message}`,
        },
      ],
      error: errorObject,
    }
  }
}
