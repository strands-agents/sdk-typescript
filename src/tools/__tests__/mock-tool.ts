import type { Tool, ToolContext, ToolExecutionEvent } from '@/tools/tool'
import type { ToolSpec, ToolUse } from '@/tools/types'

/**
 * Callback function for mock tool invocations.
 * Allows custom behavior during tool execution.
 *
 * @param toolUse - The tool use request
 * @param toolContext - The tool execution context
 * @returns An async iterable of tool execution events, or undefined to use default behavior
 */
export type MockToolCallback = (
  toolUse: ToolUse,
  toolContext: ToolContext
) => AsyncIterable<ToolExecutionEvent> | undefined

/**
 * Mock implementation of the Tool interface for testing purposes.
 * Provides a flexible mock that can be customized for different testing scenarios.
 *
 * This serves as both a test fixture and a utility for creating mock tools
 * with custom behavior.
 *
 * @example
 * ```typescript
 * // Basic usage with default calculator behavior
 * const tool1 = new MockAgentTool('calculator1')
 * const tool2 = new MockAgentTool('calculator2')
 *
 * // Custom tool with specific spec
 * const customTool = new MockAgentTool(
 *   'customTool',
 *   'Performs custom operations',
 *   {
 *     name: 'customTool',
 *     description: 'Performs custom operations',
 *     inputSchema: { type: 'object', properties: {} }
 *   }
 * )
 *
 * // Tool with custom callback
 * const callbackTool = new MockAgentTool(
 *   'callbackTool',
 *   undefined,
 *   undefined,
 *   async function* (toolUse, context) {
 *     yield { type: 'toolStreamEvent', data: 'Custom progress' }
 *     yield {
 *       toolUseId: toolUse.toolUseId,
 *       status: 'success',
 *       content: [{ type: 'toolResultTextContent', text: 'Custom result' }]
 *     }
 *   }
 * )
 * ```
 */
export class MockAgentTool implements Tool {
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
   * Optional callback to customize tool behavior.
   */
  private readonly callback: MockToolCallback | undefined

  /**
   * Creates a new MockAgentTool instance.
   *
   * @param toolName - The unique name of the tool
   * @param description - Human-readable description (defaults to general purpose calculator description)
   * @param toolSpec - OpenAPI specification (defaults to general purpose calculator spec)
   * @param callback - Optional callback to customize tool execution behavior
   */
  constructor(toolName: string, description?: string, toolSpec?: ToolSpec, callback?: MockToolCallback) {
    this.toolName = toolName
    this.description =
      description ?? 'A general purpose calculator for testing that performs basic arithmetic operations'
    this.toolSpec = toolSpec ?? {
      name: toolName,
      description: this.description,
      inputSchema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['add', 'subtract', 'multiply', 'divide'],
            description: 'The arithmetic operation to perform',
          },
          a: {
            type: 'number',
            description: 'The first operand',
          },
          b: {
            type: 'number',
            description: 'The second operand',
          },
        },
        required: ['operation', 'a', 'b'],
      },
    }
    this.callback = callback
  }

  /**
   * Executes the mock tool with streaming support.
   * If a callback is provided, delegates to the callback.
   * Otherwise, performs default calculator behavior.
   *
   * @param toolUse - The tool use request
   * @param toolContext - Context information including invocation state
   * @returns Async iterable of tool execution events
   */
  async *stream(toolUse: ToolUse, toolContext: ToolContext): AsyncIterable<ToolExecutionEvent> {
    // If callback is provided, use it
    if (this.callback) {
      const result = this.callback(toolUse, toolContext)
      if (result) {
        yield* result
        return
      }
    }

    // Default behavior: calculator implementation
    yield* this.defaultCalculatorBehavior(toolUse)
  }

  /**
   * Default calculator implementation for testing.
   * Validates input, performs calculation, and yields appropriate events.
   *
   * @param toolUse - The tool use request containing the operation and operands
   * @returns Async iterable of tool execution events
   */
  private async *defaultCalculatorBehavior(toolUse: ToolUse): AsyncIterable<ToolExecutionEvent> {
    // Yield a progress event to demonstrate streaming
    yield {
      type: 'toolStreamEvent',
      data: 'Starting calculation...',
    }

    try {
      // Validate and extract input
      const input = toolUse.input as Record<string, unknown>
      const operation = input.operation
      const a = input.a
      const b = input.b

      // Validate required fields
      if (typeof operation !== 'string') {
        yield {
          toolUseId: toolUse.toolUseId,
          status: 'error',
          content: [
            {
              type: 'toolResultTextContent',
              text: 'Error: Missing or invalid operation parameter',
            },
          ],
        }
        return
      }

      if (typeof a !== 'number') {
        yield {
          toolUseId: toolUse.toolUseId,
          status: 'error',
          content: [
            {
              type: 'toolResultTextContent',
              text: 'Error: Missing or invalid parameter "a" - must be a number',
            },
          ],
        }
        return
      }

      if (typeof b !== 'number') {
        yield {
          toolUseId: toolUse.toolUseId,
          status: 'error',
          content: [
            {
              type: 'toolResultTextContent',
              text: 'Error: Missing or invalid parameter "b" - must be a number',
            },
          ],
        }
        return
      }

      // Perform the calculation
      let result: number

      switch (operation) {
        case 'add':
          result = a + b
          break
        case 'subtract':
          result = a - b
          break
        case 'multiply':
          result = a * b
          break
        case 'divide':
          if (b === 0) {
            yield {
              toolUseId: toolUse.toolUseId,
              status: 'error',
              content: [
                {
                  type: 'toolResultTextContent',
                  text: 'Error: Division by zero is not allowed',
                },
              ],
            }
            return
          }
          result = a / b
          break
        default:
          yield {
            toolUseId: toolUse.toolUseId,
            status: 'error',
            content: [
              {
                type: 'toolResultTextContent',
                text: `Error: Unknown operation "${operation}". Supported operations: add, subtract, multiply, divide`,
              },
            ],
          }
          return
      }

      // Yield another progress event
      yield {
        type: 'toolStreamEvent',
        data: 'Calculation complete',
      }

      // Yield the final result
      yield {
        toolUseId: toolUse.toolUseId,
        status: 'success',
        content: [
          {
            type: 'toolResultTextContent',
            text: `The result of ${a} ${operation} ${b} is ${result}`,
          },
          {
            type: 'toolResultJsonContent',
            json: { operation, a, b, result },
          },
        ],
      }
    } catch (error) {
      // Handle any unexpected errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      yield {
        toolUseId: toolUse.toolUseId,
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
}
