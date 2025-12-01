import type { InvokableTool, ToolContext, ToolStreamGenerator } from './tool.js'
import { Tool } from './tool.js'
import type { ToolSpec } from './types.js'
import type { JSONSchema, JSONValue } from '../types/json.js'
import { FunctionTool } from './function-tool.js'
import { z, ZodVoid } from 'zod'

/**
 * Helper type to infer input type from Zod schema or default to never.
 */
type ZodInferred<TInput> = TInput extends z.ZodType ? z.infer<TInput> : never

/**
 * Configuration for creating a Zod-based tool.
 *
 * @typeParam TInput - Zod schema type for input validation
 * @typeParam TReturn - Return type of the callback function
 */
export interface ToolConfig<TInput extends z.ZodType | undefined, TReturn extends JSONValue = JSONValue> {
  /** The name of the tool */
  name: string

  /** A description of what the tool does (optional) */
  description?: string

  /**
   * Zod schema for input validation and JSON schema generation.
   * If omitted or z.void(), the tool takes no input parameters.
   */
  inputSchema?: TInput

  /**
   * Callback function that implements the tool's functionality.
   *
   * @param input - Validated input matching the Zod schema
   * @param context - Optional execution context
   * @returns The result (can be a value, Promise, or AsyncGenerator)
   */
  callback: (
    input: ZodInferred<TInput>,
    context?: ToolContext
  ) => AsyncGenerator<unknown, TReturn, never> | Promise<TReturn> | TReturn
}

/**
 * Internal implementation of a Zod-based tool.
 * Extends Tool abstract class and implements InvokableTool interface.
 */
class ZodTool<TInput extends z.ZodType | undefined, TReturn extends JSONValue = JSONValue>
  extends Tool
  implements InvokableTool<ZodInferred<TInput>, TReturn>
{
  /**
   * Internal FunctionTool for delegating stream operations.
   */
  private readonly _functionTool: FunctionTool

  /**
   * Zod schema for input validation.
   * Note: undefined is normalized to z.void() in constructor, so this is always defined.
   */
  private readonly _inputSchema: z.ZodType

  /**
   * User callback function.
   */
  private readonly _callback: (
    input: ZodInferred<TInput>,
    context?: ToolContext
  ) => AsyncGenerator<unknown, TReturn, never> | Promise<TReturn> | TReturn

  constructor(config: ToolConfig<TInput, TReturn>) {
    super()
    const { name, description = '', inputSchema, callback } = config

    // Normalize undefined to z.void() to simplify logic throughout
    this._inputSchema = inputSchema ?? z.void()
    this._callback = callback

    let generatedSchema: JSONSchema

    // Handle z.void() - use default empty object schema
    if (this._inputSchema instanceof ZodVoid) {
      generatedSchema = {
        type: 'object',
        properties: {},
        additionalProperties: false,
      }
    } else {
      // Generate JSON Schema from Zod and strip $schema property to reduce token usage
      const schema = z.toJSONSchema(this._inputSchema) as JSONSchema & { $schema?: string }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { $schema, ...schemaWithoutMeta } = schema
      generatedSchema = schemaWithoutMeta as JSONSchema
    }

    // Create a FunctionTool with a validation wrapper
    this._functionTool = new FunctionTool({
      name,
      description,
      inputSchema: generatedSchema,
      callback: (
        input: unknown,
        toolContext: ToolContext
      ): AsyncGenerator<JSONValue, JSONValue, never> | Promise<JSONValue> | JSONValue => {
        // Only validate if schema is not z.void() (after normalization, it's never undefined)
        const validatedInput = this._inputSchema instanceof ZodVoid ? input : this._inputSchema.parse(input)
        // Execute user callback with validated input
        return callback(validatedInput as ZodInferred<TInput>, toolContext) as
          | AsyncGenerator<JSONValue, JSONValue, never>
          | Promise<JSONValue>
          | JSONValue
      },
    })
  }

  /**
   * The unique name of the tool.
   */
  get name(): string {
    return this._functionTool.name
  }

  /**
   * Human-readable description of what the tool does.
   */
  get description(): string {
    return this._functionTool.description
  }

  /**
   * OpenAPI JSON specification for the tool.
   */
  get toolSpec(): ToolSpec {
    return this._functionTool.toolSpec
  }

  /**
   * Executes the tool with streaming support.
   * Delegates to internal FunctionTool implementation.
   *
   * @param toolContext - Context information including the tool use request and invocation state
   * @returns Async generator that yields ToolStreamEvents and returns a ToolResultBlock
   */
  stream(toolContext: ToolContext): ToolStreamGenerator {
    return this._functionTool.stream(toolContext)
  }

  /**
   * Invokes the tool directly with type-safe input and returns the unwrapped result.
   *
   * Unlike stream(), this method:
   * - Returns the raw result (not wrapped in ToolResult)
   * - Consumes async generators and returns only the final value
   * - Lets errors throw naturally (not wrapped in error ToolResult)
   *
   * @param input - The input parameters for the tool
   * @param context - Optional tool execution context
   * @returns The unwrapped result
   */
  async invoke(input: ZodInferred<TInput>, context?: ToolContext): Promise<TReturn> {
    // Only validate if schema is not z.void() (after normalization, it's never undefined)
    const validatedInput = this._inputSchema instanceof ZodVoid ? input : this._inputSchema.parse(input)

    // Execute callback with validated input
    const result = this._callback(validatedInput as ZodInferred<TInput>, context)

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
  }
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
 * // Tool with input parameters
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
 * // Tool without input (omit inputSchema)
 * const getStatus = tool({
 *   name: 'getStatus',
 *   description: 'Gets system status',
 *   callback: () => ({ status: 'operational', uptime: 99.9 })
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
export function tool<TInput extends z.ZodType | undefined, TReturn extends JSONValue = JSONValue>(
  config: ToolConfig<TInput, TReturn>
): InvokableTool<ZodInferred<TInput>, TReturn> {
  return new ZodTool(config)
}
