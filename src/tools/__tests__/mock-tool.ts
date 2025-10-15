import type { Tool, ToolContext, ToolExecutionEvent } from '@/tools/tool'
import type { ToolSpec, ToolUse } from '@/tools/types'

/**
 * Mock implementation of the Tool interface for testing purposes.
 * Implements a simple calculator that performs basic arithmetic operations.
 *
 * This serves as both a test fixture and a reference implementation
 * demonstrating how to properly implement the Tool interface.
 *
 * @example
 * ```typescript
 * const tool = new MockAgentTool()
 *
 * const toolUse = {
 *   name: 'mockCalculator',
 *   toolUseId: 'calc-123',
 *   input: { operation: 'add', a: 5, b: 3 }
 * }
 *
 * const context = { invocationState: {} }
 *
 * for await (const event of tool.stream(toolUse, context)) {
 *   if (event.type === 'toolStreamEvent') {
 *     console.log('Progress:', event.delta)
 *   } else {
 *     console.log('Result:', event.status, event.content)
 *   }
 * }
 * ```
 */
export class MockAgentTool implements Tool {
  /**
   * The unique name of the tool.
   */
  readonly toolName = 'mockCalculator'

  /**
   * Human-readable description of what the tool does.
   */
  readonly description = 'A simple calculator for testing that performs basic arithmetic operations'

  /**
   * OpenAPI JSON specification for the tool.
   */
  readonly toolSpec: ToolSpec = {
    name: 'mockCalculator',
    description: 'A simple calculator for testing that performs basic arithmetic operations',
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

  /**
   * Executes the calculator tool with streaming support.
   * Validates input, performs the calculation, and yields appropriate events.
   *
   * @param toolUse - The tool use request containing the operation and operands
   * @param toolContext - Context information including invocation state
   * @returns Async iterable of tool execution events
   */
  async *stream(toolUse: ToolUse, _toolContext: ToolContext): AsyncIterable<ToolExecutionEvent> {
    // Yield a progress event to demonstrate streaming
    yield {
      type: 'toolStreamEvent',
      delta: 'Starting calculation...',
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
        delta: 'Calculation complete',
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
