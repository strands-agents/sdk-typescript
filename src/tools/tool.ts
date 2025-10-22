import type { ToolSpec, ToolUse, ToolResult } from '@/tools/types'

/**
 * Context provided to tool implementations during execution.
 * Contains framework-level state and information from the agent invocation.
 *
 * @typeParam T - The type of invocation state, must extend Record\<string, unknown\>
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
 * Union type representing all possible events that can be yielded during tool execution.
 * Tools must yield zero or more ToolStreamEvents, then exactly one ToolResult as the final event.
 *
 * This is a discriminated union that allows type-safe event handling.
 *
 * @example
 * ```typescript
 * for await (const event of tool.stream(toolUse, context)) {
 *   if (event.type === 'toolStreamEvent') {
 *     console.log('Progress:', event.data)
 *   } else {
 *     // Must be ToolResult (final event)
 *     console.log('Result:', event.status)
 *   }
 * }
 * ```
 */
export type ToolExecutionEvent = ToolStreamEvent | ToolResult

/**
 * Interface for tool implementations.
 * Tools are used by agents to interact with their environment and perform specific actions.
 *
 * The Tool interface provides a streaming execution model where tools can yield
 * progress events during execution before returning a final result.
 *
 * @example
 * ```typescript
 * class CalculatorTool implements Tool {
 *   toolName = 'calculator'
 *   description = 'Performs basic arithmetic operations'
 *   toolSpec: ToolSpec = {
 *     name: 'calculator',
 *     description: 'Performs basic arithmetic operations',
 *     inputSchema: {
 *       type: 'object',
 *       properties: {
 *         operation: { type: 'string', enum: ['add', 'subtract'] },
 *         a: { type: 'number' },
 *         b: { type: 'number' }
 *       },
 *       required: ['operation', 'a', 'b']
 *     }
 *   }
 *
 *   async *stream(toolContext: ToolContext): AsyncGenerator<ToolStreamEvent, ToolResult, unknown> {
 *     yield { type: 'toolStreamEvent', data: 'Calculating...' }
 *
 *     const { operation, a, b } = toolContext.toolUse.input
 *     const result = operation === 'add' ? a + b : a - b
 *
 *     return {
 *       toolUseId: toolContext.toolUse.toolUseId,
 *       status: 'success',
 *       content: [{ type: 'toolResultTextContent', text: `Result: ${result}` }]
 *     }
 *   }
 * }
 * ```
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
  stream(toolContext: ToolContext): AsyncGenerator<ToolStreamEvent, ToolResult, unknown>
}
