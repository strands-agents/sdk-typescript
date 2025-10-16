import type { Tool, ToolContext, ToolExecutionEvent } from '@/tools/tool'
import type { ToolSpec, ToolUse, ToolResult } from '@/tools/types'
import type { JSONSchema } from '@/types/json'

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
) => AsyncGenerator<unknown, unknown, unknown> | Promise<unknown> | unknown

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
 * // Create a simple calculator tool
 * const calculator = new FunctionTool(
 *   'calculator',
 *   'Performs arithmetic operations',
 *   {
 *     type: 'object',
 *     properties: {
 *       operation: { type: 'string', enum: ['add', 'subtract'] },
 *       a: { type: 'number' },
 *       b: { type: 'number' }
 *     },
 *     required: ['operation', 'a', 'b']
 *   },
 *   (input: any) => {
 *     const { operation, a, b } = input
 *     return operation === 'add' ? a + b : a - b
 *   }
 * )
 *
 * // Create a tool with streaming
 * const streamingTool = new FunctionTool(
 *   'processor',
 *   'Processes data with progress updates',
 *   { type: 'object', properties: { data: { type: 'string' } } },
 *   async function* (input: any) {
 *     yield 'Starting processing...'
 *     // Do some work
 *     yield 'Halfway done...'
 *     // More work
 *     return 'Processing complete!'
 *   }
 * )
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
  private readonly callback: FunctionToolCallback

  /**
   * Creates a new FunctionTool instance.
   *
   * @param name - The unique name of the tool
   * @param description - Human-readable description of the tool's purpose
   * @param inputSchema - JSON Schema defining the expected input structure
   * @param callback - Function that implements the tool logic
   *
   * @example
   * ```typescript
   * const tool = new FunctionTool(
   *   'greeter',
   *   'Greets a person by name',
   *   {
   *     type: 'object',
   *     properties: { name: { type: 'string' } },
   *     required: ['name']
   *   },
   *   (input: any) => `Hello, ${input.name}!`
   * )
   * ```
   */
  constructor(name: string, description: string, inputSchema: JSONSchema, callback: FunctionToolCallback) {
    this.toolName = name
    this.description = description
    this.toolSpec = {
      name,
      description,
      inputSchema,
    }
    this.callback = callback
  }

  /**
   * Executes the tool with streaming support.
   * Handles all callback patterns (async generator, promise, sync) and converts results to ToolResult.
   *
   * @param toolUse - The tool use request containing the tool name, ID, and input
   * @param toolContext - Context information including invocation state
   * @returns Async iterable of tool execution events
   */
  async *stream(toolUse: ToolUse, toolContext: ToolContext): AsyncIterable<ToolExecutionEvent> {
    try {
      const result = this.callback(toolUse.input, toolContext)

      // Check if result is an async generator
      if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
        // Handle async generator: yield each value as ToolStreamEvent, wrap final value in ToolResult
        yield* this.handleAsyncGenerator(result as AsyncGenerator<unknown, unknown, unknown>, toolUse.toolUseId)
      } else if (result instanceof Promise) {
        // Handle promise: await and wrap in ToolResult
        const value = await result
        yield this.wrapInToolResult(value, toolUse.toolUseId)
      } else {
        // Handle synchronous value: wrap in ToolResult
        yield this.wrapInToolResult(result, toolUse.toolUseId)
      }
    } catch (error) {
      // Handle any errors and return as error ToolResult
      yield this.createErrorResult(error, toolUse.toolUseId)
    }
  }

  /**
   * Handles async generator callbacks.
   * Yields each value as a ToolStreamEvent, then wraps the final return value in a ToolResult.
   *
   * @param generator - The async generator from the callback
   * @param toolUseId - The tool use ID for the ToolResult
   * @returns Async iterable of tool execution events
   */
  private async *handleAsyncGenerator(
    generator: AsyncGenerator<unknown, unknown, unknown>,
    toolUseId: string
  ): AsyncIterable<ToolExecutionEvent> {
    try {
      let finalValue: unknown

      for await (const value of generator) {
        // Each yielded value becomes a ToolStreamEvent
        yield {
          type: 'toolStreamEvent',
          data: value,
        }
        finalValue = value
      }

      // The final return value is wrapped in ToolResult
      // Note: In JavaScript/TypeScript, the return value of a generator is separate from yielded values
      // For simplicity, we'll use the last yielded value if no explicit return
      yield this.wrapInToolResult(finalValue, toolUseId)
    } catch (error) {
      yield this.createErrorResult(error, toolUseId)
    }
  }

  /**
   * Wraps a value in a ToolResult with success status.
   *
   * @param value - The value to wrap (can be any type)
   * @param toolUseId - The tool use ID for the ToolResult
   * @returns A ToolResult containing the value
   */
  private wrapInToolResult(value: unknown, toolUseId: string): ToolResult {
    // Convert value to appropriate content format
    let text: string

    if (value === null || value === undefined) {
      text = 'null'
    } else if (typeof value === 'object') {
      text = JSON.stringify(value, null, 2)
    } else {
      text = String(value)
    }

    return {
      toolUseId,
      status: 'success',
      content: [
        {
          type: 'toolResultTextContent',
          text,
        },
      ],
    }
  }

  /**
   * Creates an error ToolResult from an error object.
   *
   * @param error - The error that occurred
   * @param toolUseId - The tool use ID for the ToolResult
   * @returns A ToolResult with error status
   */
  private createErrorResult(error: unknown, toolUseId: string): ToolResult {
    const errorMessage = error instanceof Error ? error.message : String(error)

    return {
      toolUseId,
      status: 'error',
      content: [
        {
          type: 'toolResultTextContent',
          text: `Error: ${errorMessage}`,
        },
      ],
    }
  }
}
