import type { Tool, ToolContext, ToolSpec, ToolStreamEvent, ToolStreamGenerator } from './tool'
import type { JSONSchema } from '../types/json'
import { z } from 'zod'

/**
 * Configuration for creating a Zod-based tool.
 *
 * @typeParam TInput - Zod schema type for input validation
 */
export interface ToolConfig<TInput extends z.ZodType> {
  /** The name of the tool */
  name: string

  /** A description of what the tool does */
  description: string

  /** Zod schema for input validation and JSON schema generation */
  inputSchema: TInput

  /**
   * Callback function that implements the tool's functionality.
   *
   * @param input - Validated input matching the Zod schema
   * @param context - Optional execution context (abort signal, etc.)
   * @returns The result (can be a value, Promise, or AsyncGenerator)
   */
  callback: (
    input: z.infer<TInput>,
    context?: ToolContext
  ) => AsyncGenerator<unknown, unknown, never> | Promise<unknown> | unknown
}

/**
 * Creates a Tool from a Zod schema and callback function.
 *
 * The tool() function validates input against the schema and generates JSON schema
 * for model providers using Zod v4's built-in z.toJSONSchema() method.
 *
 * @example
 * ```typescript
 * import { tool } from '@strands-agents/sdk'
 * import { z } from 'zod'
 *
 * const calculator = tool({
 *   name: 'calculator',
 *   description: 'Performs basic arithmetic',
 *   inputSchema: z.object({
 *     operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
 *     a: z.number(),
 *     b: z.number()
 *   }),
 *   callback: (input) => {
 *     switch (input.operation) {
 *       case 'add': return input.a + input.b
 *       case 'subtract': return input.a - input.b
 *       case 'multiply': return input.a * input.b
 *       case 'divide': return input.a / input.b
 *     }
 *   }
 * })
 *
 * // Direct invocation
 * const result = await calculator.invoke({ operation: 'add', a: 5, b: 3 })
 *
 * // Agent usage
 * for await (const event of calculator.stream(context)) {
 *   console.log(event)
 * }
 * ```
 *
 * @typeParam TInput - Zod schema type for input validation
 * @param config - Tool configuration
 * @returns A Tool that implements the Tool interface
 */
export function tool<TInput extends z.ZodType>(config: ToolConfig<TInput>): Tool<z.infer<TInput>> {
  const { name, description, inputSchema, callback } = config

  // Build toolSpec with JSON schema from Zod v4
  const toolSpec: ToolSpec = {
    name,
    description,
    inputSchema: z.toJSONSchema(inputSchema) as JSONSchema,
  }

  // Create a tool object that implements Tool interface
  const toolWithInvoke: Tool<z.infer<TInput>> = {
    toolName: name,
    description,
    toolSpec,

    async *stream(toolContext: ToolContext): ToolStreamGenerator {
      try {
        // Validate input using Zod schema
        const validatedInput = inputSchema.parse(toolContext.toolUse.input)

        // Execute callback with validated input
        const result = callback(validatedInput, toolContext)

        // Handle different return types
        if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
          // AsyncGenerator - yield stream events for each value
          for await (const value of result as AsyncGenerator<unknown, unknown, undefined>) {
            const streamEvent: ToolStreamEvent = {
              type: 'toolStreamEvent',
              data: value,
            }
            yield streamEvent
          }
          // Return success result after generator completes
          return {
            toolUseId: toolContext.toolUse.toolUseId,
            status: 'success',
            content: [],
          }
        } else {
          // Regular value or Promise - return result
          const resolvedResult = await result
          return {
            toolUseId: toolContext.toolUse.toolUseId,
            status: 'success',
            content: [
              {
                type: 'toolResultTextContent',
                text: typeof resolvedResult === 'string' ? resolvedResult : JSON.stringify(resolvedResult),
              },
            ],
          }
        }
      } catch (error) {
        // Return error result
        return {
          toolUseId: toolContext.toolUse.toolUseId,
          status: 'error',
          content: [
            {
              type: 'toolResultTextContent',
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          error: error instanceof Error ? error : new Error(String(error)),
        }
      }
    },

    async invoke(input: z.infer<TInput>, context?: ToolContext): Promise<unknown> {
      // Validate input using Zod schema (throws on validation error)
      const validatedInput = inputSchema.parse(input)

      // Execute callback with validated input
      const result = callback(validatedInput, context)

      // Handle different return types
      if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
        // AsyncGenerator - consume and return final value
        let finalValue: unknown = undefined
        for await (const value of result as AsyncGenerator<unknown, unknown, undefined>) {
          finalValue = value
        }
        return finalValue
      } else {
        // Regular value or Promise - return directly
        return await result
      }
    },
  }

  return toolWithInvoke
}
