import type { ToolSpec, ToolUse, ToolResult } from './types.js'

export type { ToolSpec } from './types.js'

/**
 * Context provided to tool implementations during execution.
 * Contains framework-level state and information from the agent invocation.
 *
 * @typeParam T - Optional type for strongly typing invocationState. Callers can pass any object
 *               as invocationState (including references), but it must be a dictionary/object.
 *               T allows strong typing when desired, while Record\<string, unknown\> accepts any object.
 *
 * @example
 * ```typescript
 * interface MyState {
 *   userId: string
 *   sessionId: string
 * }
 *
 * const context: ToolContext<MyState> = {
 *   invocationState: {
 *     userId: 'user-123',
 *     sessionId: 'session-456'
 *   }
 * }
 * ```
 */
export interface ToolContext<T extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * The tool use request that triggered this tool execution.
   * Contains the tool name, toolUseId, and input parameters.
   */
  toolUse: ToolUse

  /**
   * Caller-provided state from agent invocation.
   * This allows passing context from the agent level down to tool execution.
   */
  invocationState: T
}

/**
 * Event yielded during tool execution to report streaming progress.
 * Tools can yield zero or more of these events before returning the final ToolResult.
 *
 * @example
 * ```typescript
 * const streamEvent: ToolStreamEvent = {
 *   type: 'toolStreamEvent',
 *   data: 'Processing step 1...'
 * }
 *
 * // Or with structured data
 * const streamEvent: ToolStreamEvent = {
 *   type: 'toolStreamEvent',
 *   data: { progress: 50, message: 'Halfway complete' }
 * }
 * ```
 */
export interface ToolStreamEvent {
  /**
   * Discriminator for tool stream events.
   */
  type: 'toolStreamEvent'

  /**
   * Caller-provided data for the progress update.
   * Can be any type of data the tool wants to report.
   */
  data?: unknown
}

/**
 * Type alias for the async generator returned by tool stream methods.
 * Yields ToolStreamEvents during execution and returns a ToolResult.
 */
export type ToolStreamGenerator = AsyncGenerator<ToolStreamEvent, ToolResult, never>

/**
 * Interface for tool implementations.
 * Tools are used by agents to interact with their environment and perform specific actions.
 *
 * The Tool interface provides a streaming execution model where tools can yield
 * progress events during execution before returning a final result.
 *
 * Most implementations should use FunctionTool rather than implementing this interface directly.
 */
export interface Tool {
  /**
   * The unique name of the tool.
   * This MUST match the name in the toolSpec.
   */
  toolName: string

  /**
   * Human-readable description of what the tool does.
   * This helps the model understand when to use the tool.
   *
   * This MUST match the description in the toolSpec.description.
   */
  description: string

  /**
   * OpenAPI JSON specification for the tool.
   * Defines the tool's name, description, and input schema.
   */
  toolSpec: ToolSpec

  /**
   * Executes the tool with streaming support.
   * Yields zero or more ToolStreamEvents during execution, then returns
   * exactly one ToolResult as the final value.
   *
   * @param toolContext - Context information including the tool use request and invocation state
   * @returns Async generator that yields ToolStreamEvents and returns a ToolResult
   *
   * @example
   * ```typescript
   * const context = {
   *   toolUse: {
   *     name: 'calculator',
   *     toolUseId: 'calc-123',
   *     input: { operation: 'add', a: 5, b: 3 }
   *   },
   *   invocationState: {}
   * }
   *
   * // The return value is only accessible via explicit .next() calls
   * const generator = tool.stream(context)
   * for await (const event of generator) {
   *   // Only yields are captured here
   *   console.log('Progress:', event.data)
   * }
   * // Or manually handle the return value:
   * let result = await generator.next()
   * while (!result.done) {
   *   console.log('Progress:', result.value.data)
   *   result = await generator.next()
   * }
   * console.log('Final result:', result.value.status)
   * ```
   */
  stream(toolContext: ToolContext): ToolStreamGenerator
}

/**
 * Extended tool interface that supports direct invocation with type-safe input and output.
 * This interface is useful for testing and standalone tool execution.
 *
 * @typeParam TInput - Type for the tool's input parameters
 * @typeParam TReturn - Type for the tool's return value
 */
export interface InvokableTool<TInput, TReturn> extends Tool {
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
  invoke(input: TInput, context?: ToolContext): Promise<TReturn>
}
