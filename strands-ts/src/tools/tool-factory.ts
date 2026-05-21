import type { InvokableTool, ToolContext } from './tool.js'
import { Tool } from './tool.js'
import { FunctionTool } from './function-tool.js'
import type { FunctionToolConfig } from './function-tool.js'
import type { JSONValue } from '../types/json.js'
import { z } from 'zod'
import { ZodTool, type ZodToolConfig } from './zod-tool.js'

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
 * Configuration for creating a tool that reuses another tool's input schema.
 *
 * @typeParam TInput - Input type inferred from the source tool
 * @typeParam TReturn - Return type of the callback function
 */
interface DerivedToolConfig<TInput, TReturn extends JSONValue> {
  /** The unique name of the tool */
  name: string

  /** Human-readable description of the tool's purpose. Defaults to the source tool's description. */
  description?: string

  /** An existing tool whose input schema and types will be reused */
  inputSchema: InvokableTool<TInput, unknown>

  /** Function that implements the tool logic with typed input from the source tool */
  callback: (
    input: TInput,
    context?: ToolContext
  ) => AsyncGenerator<JSONValue, TReturn, never> | Promise<TReturn> | TReturn
}

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
 * Creates an InvokableTool from a JSON schema and callback function.
 *
 * @param config - Tool configuration with optional JSON schema
 * @returns An InvokableTool with unknown input
 */
export function tool(config: FunctionToolConfig): InvokableTool<unknown, JSONValue>

/**
 * Creates an InvokableTool that reuses another tool's input schema.
 * The callback receives the same typed input as the source tool.
 *
 * @typeParam TInput - Input type inferred from the source tool
 * @typeParam TReturn - Return type of the callback function
 * @param config - Tool configuration with a source tool as inputSchema
 * @returns An InvokableTool with input typed from the source tool
 */
export function tool<TInput, TReturn extends JSONValue = JSONValue>(
  config: DerivedToolConfig<TInput, TReturn>
): InvokableTool<TInput, TReturn>

/**
 * Creates an InvokableTool from a Zod schema, JSON schema, or existing tool.
 *
 * When a Zod schema is provided as `inputSchema`, input is validated at runtime and
 * the callback receives typed input. When an existing tool is provided as `inputSchema`,
 * the callback receives input typed from that tool's generic parameters. When a JSON
 * schema (or no schema) is provided, the callback receives `unknown` input with no
 * runtime validation.
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
 *
 * // With existing tool (typed from source tool)
 * const positiveCalculator = tool({
 *   name: 'positive_calculator',
 *   description: 'Adds two positive numbers',
 *   inputSchema: calculator,
 *   callback: (input) => {
 *     if (input.a < 0 || input.b < 0) throw new Error('No negatives')
 *     return calculator.invoke(input)
 *   },
 * })
 * ```
 *
 * @param config - Tool configuration
 * @returns An InvokableTool that implements the Tool interface with invoke() method
 */
export function tool(
  config: ZodToolConfig<z.ZodType | undefined, JSONValue> | FunctionToolConfig | DerivedToolConfig<unknown, JSONValue>
): InvokableTool<unknown, JSONValue> {
  if (config.inputSchema && config.inputSchema instanceof Tool) {
    const sourceTool = config.inputSchema

    if (sourceTool instanceof ZodTool) {
      return new ZodTool({
        name: config.name,
        description: config.description ?? sourceTool.description,
        inputSchema: sourceTool.inputSchema,
        callback: config.callback,
      } as ZodToolConfig<z.ZodType, JSONValue>)
    }

    return new FunctionTool({
      name: config.name,
      description: config.description ?? sourceTool.description,
      inputSchema: sourceTool.toolSpec.inputSchema,
      callback: config.callback,
    } as FunctionToolConfig)
  }

  if (config.inputSchema && isZodType(config.inputSchema)) {
    return new ZodTool(config as ZodToolConfig<z.ZodType, JSONValue>)
  }

  return new FunctionTool(config as FunctionToolConfig)
}
