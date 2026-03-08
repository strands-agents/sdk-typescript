import type { InvokableTool, ToolContext, ToolStreamGenerator } from './tool.js'
import { Tool } from './tool.js'
import { FunctionTool } from './function-tool.js'
import type { FunctionToolCallback } from './function-tool.js'
import type { ToolSpec } from './types.js'
import type { JSONSchema, JSONValue } from '../types/json.js'
import { z } from 'zod'
import { ZodTool, type ZodToolConfig } from './zod-tool.js'

/**
 * Configuration for creating a JSON-schema-based tool.
 *
 * @typeParam TReturn - Return type of the callback function
 */
export interface JsonToolConfig<TReturn extends JSONValue = JSONValue> {
  /** The name of the tool */
  name: string

  /** A description of what the tool does (optional) */
  description?: string

  /**
   * JSON Schema defining the expected input structure.
   * If omitted, defaults to an empty object schema.
   */
  inputSchema?: JSONSchema

  /**
   * Callback function that implements the tool's functionality.
   *
   * @param input - Raw input (not validated)
   * @param context - Optional execution context
   * @returns The result (can be a value, Promise, or AsyncGenerator)
   */
  callback: (
    input: unknown,
    context?: ToolContext
  ) => AsyncGenerator<unknown, TReturn, never> | Promise<TReturn> | TReturn
}

/**
 * Internal wrapper that adds invoke() support on top of FunctionTool.
 */
class JsonTool<TReturn extends JSONValue = JSONValue> extends Tool implements InvokableTool<unknown, TReturn> {
  private readonly _functionTool: FunctionTool
  private readonly _callback: JsonToolConfig<TReturn>['callback']

  constructor(config: JsonToolConfig<TReturn>) {
    super()
    this._callback = config.callback
    this._functionTool = new FunctionTool({
      name: config.name,
      description: config.description ?? '',
      ...(config.inputSchema && { inputSchema: config.inputSchema }),
      callback: config.callback as FunctionToolCallback,
    })
  }

  get name(): string {
    return this._functionTool.name
  }

  get description(): string {
    return this._functionTool.description
  }

  get toolSpec(): ToolSpec {
    return this._functionTool.toolSpec
  }

  stream(toolContext: ToolContext): ToolStreamGenerator {
    return this._functionTool.stream(toolContext)
  }

  async invoke(input: unknown, context?: ToolContext): Promise<TReturn> {
    const result = this._callback(input, context)

    if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
      let lastValue: TReturn | undefined = undefined
      for await (const value of result as AsyncGenerator<unknown, TReturn, undefined>) {
        lastValue = value as TReturn
      }
      return lastValue as TReturn
    } else {
      return (await result) as TReturn
    }
  }
}

/**
 * Checks whether a value is a Zod schema type.
 *
 * @param value - The value to check
 * @returns True if the value is a Zod schema
 */
function isZodType(value: unknown): value is z.ZodType {
  return value instanceof z.ZodType
}

/**
 * Creates an InvokableTool from a JSON schema and callback function.
 *
 * @typeParam TReturn - Return type of the callback function
 * @param config - Tool configuration with JSON schema
 * @returns An InvokableTool with unknown input and typed output
 */
export function tool<TReturn extends JSONValue = JSONValue>(
  config: JsonToolConfig<TReturn>
): InvokableTool<unknown, TReturn>

/**
 * Creates an InvokableTool from a Zod schema and callback function.
 *
 * @typeParam TInput - Zod schema type for input validation
 * @typeParam TReturn - Return type of the callback function
 * @param config - Tool configuration with Zod schema
 * @returns An InvokableTool with typed input and output
 */
export function tool<TInput extends z.ZodType, TReturn extends JSONValue = JSONValue>(
  config: ZodToolConfig<TInput, TReturn>
): InvokableTool<z.infer<TInput>, TReturn>

/**
 * Creates an InvokableTool from either a Zod schema or JSON schema configuration.
 *
 * When a Zod schema is provided as `inputSchema`, input is validated at runtime and
 * the callback receives typed input. When a JSON schema (or no schema) is provided,
 * the callback receives `unknown` input with no runtime validation.
 *
 * @example
 * ```typescript
 * import { tool } from '@strands-agents/sdk'
 * import { z } from 'zod'
 *
 * // With Zod schema (typed + validated)
 * const calculator = tool({
 *   name: 'calculator',
 *   description: 'Adds two numbers',
 *   inputSchema: z.object({ a: z.number(), b: z.number() }),
 *   callback: (input) => input.a + input.b,
 * })
 *
 * // With JSON schema (untyped, no validation)
 * const greeter = tool({
 *   name: 'greeter',
 *   description: 'Greets a person',
 *   inputSchema: {
 *     type: 'object',
 *     properties: { name: { type: 'string' } },
 *     required: ['name'],
 *   },
 *   callback: (input) => `Hello, ${(input as { name: string }).name}!`,
 * })
 * ```
 *
 * @param config - Tool configuration
 * @returns An InvokableTool that implements the Tool interface with invoke() method
 */
export function tool(
  config: ZodToolConfig<z.ZodType | undefined, JSONValue> | JsonToolConfig<JSONValue>
): InvokableTool<unknown, JSONValue> {
  if (config.inputSchema && isZodType(config.inputSchema)) {
    return new ZodTool(config as ZodToolConfig<z.ZodType, JSONValue>)
  }

  return new JsonTool(config as JsonToolConfig<JSONValue>)
}
