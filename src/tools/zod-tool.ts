import type { InvokableTool, ToolContext, ToolStreamGenerator } from './tool.js'
import type { JSONSchema, JSONValue } from '../types/json.js'
import { FunctionTool } from './function-tool.js'
import { z } from 'zod'

/**
 * Configuration for creating a Zod-based tool.
 *
 * @typeParam TInput - Zod schema type for input validation
 * @typeParam TReturn - Return type of the callback function
 */
export interface ToolConfig<TInput extends z.ZodType, TReturn extends JSONValue = JSONValue> {
  /** The name of the tool */
  name: string

  /** A description of what the tool does (optional) */
  description?: string

  /** Zod schema for input validation and JSON schema generation */
  inputSchema: TInput

  /**
   * Callback function that implements the tool's functionality.
   *
   * @param input - Validated input matching the Zod schema
   * @param context - Optional execution context
   * @returns The result (can be a value, Promise, or AsyncGenerator)
   */
  callback: (
    input: z.infer<TInput>,
    context?: ToolContext
  ) => AsyncGenerator<unknown, TReturn, never> | Promise<TReturn> | TReturn
}

/**
 * Creates an InvokableTool from a Zod schema and callback function.
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
 * @typeParam TReturn - Return type of the callback function
 * @param config - Tool configuration
 * @returns An InvokableTool that implements the Tool interface with invoke() method
 */
export function tool<TInput extends z.ZodType, TReturn extends JSONValue = JSONValue>(
  config: ToolConfig<TInput, TReturn>
): InvokableTool<z.infer<TInput>, TReturn> {
  const { name, description = '', inputSchema, callback } = config

  // Generate JSON Schema from Zod and strip $schema property to reduce token usage
  const generatedSchema = z.toJSONSchema(inputSchema) as JSONSchema & { $schema?: string }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $schema, ...schemaWithoutMeta } = generatedSchema

  // Create a FunctionTool with a validation wrapper
  const functionTool = new FunctionTool({
    name,
    description,
    inputSchema: schemaWithoutMeta as JSONSchema,
    callback: (
      input: unknown,
      toolContext: ToolContext
    ): AsyncGenerator<JSONValue, JSONValue, never> | Promise<JSONValue> | JSONValue => {
      // Validate input using Zod schema (throws on validation error)
      const validatedInput = inputSchema.parse(input)
      // Execute user callback with validated input
      return callback(validatedInput, toolContext) as
        | AsyncGenerator<JSONValue, JSONValue, never>
        | Promise<JSONValue>
        | JSONValue
    },
  })

  // Create an invokable tool that extends the FunctionTool
  const invokableTool: InvokableTool<z.infer<TInput>, TReturn> = {
    toolName: functionTool.toolName,
    description: functionTool.description,
    toolSpec: functionTool.toolSpec,

    // Delegate stream to FunctionTool
    stream(toolContext: ToolContext): ToolStreamGenerator {
      return functionTool.stream(toolContext)
    },

    // Type-safe invoke method
    async invoke(input: z.infer<TInput>, context?: ToolContext): Promise<TReturn> {
      // Validate input using Zod schema (throws on validation error)
      const validatedInput = inputSchema.parse(input)

      // Execute callback with validated input
      const result = callback(validatedInput, context)

      // Handle different return types
      if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
        // AsyncGenerator - consume all yielded values and return the last one
        let lastValue: TReturn | undefined = undefined
        for await (const value of result as AsyncGenerator<unknown, TReturn, undefined>) {
          lastValue = value as TReturn
        }
        return lastValue as TReturn
      } else {
        // Regular value or Promise - return directly
        return await result
      }
    },
  }

  return invokableTool
}
