import type { ToolSpec, ToolUse, ToolResult } from '@/tools/types'

/**
 * Context provided to tool implementations during execution.
 * Contains framework-level state and information from the agent invocation.
 *
 * @example
 * ```typescript
 * const context: ToolContext = {
 *   invocationState: {
 *     userId: 'user-123',
 *     sessionId: 'session-456'
 *   }
 * }
 * ```
 */
export interface ToolContext {
  /**
   * Caller-provided state from agent invocation.
   * This allows passing context from the agent level down to tool execution.
   */
  invocationState: Record<string, unknown>
}

/**
 * Event yielded during tool execution to report streaming progress.
 * Tools can yield zero or more of these events before returning the final ToolResult.
 *
 * @example
 * ```typescript
 * const streamEvent: ToolStreamEvent = {
 *   type: 'toolStreamEvent',
 *   delta: 'Processing step 1...'
 * }
 * ```
 */
export interface ToolStreamEvent {
  /**
   * Discriminator for tool stream events.
   */
  type: 'toolStreamEvent'

  /**
   * Index of the content block being updated.
   * Useful for tracking multiple concurrent operations.
   */
  contentBlockIndex?: number

  /**
   * Incremental content update or progress message.
   */
  delta?: string
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
 *     console.log('Progress:', event.delta)
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
 *   async *stream(toolUse: ToolUse, toolContext: ToolContext): AsyncIterable<ToolExecutionEvent> {
 *     yield { type: 'toolStreamEvent', delta: 'Calculating...' }
 *
 *     const { operation, a, b } = toolUse.input
 *     const result = operation === 'add' ? a + b : a - b
 *
 *     yield {
 *       toolUseId: toolUse.toolUseId,
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
   * This should match the name in the toolSpec.
   */
  toolName: string

  /**
   * Human-readable description of what the tool does.
   * This helps the model understand when to use the tool.
   *
   * Note: This is also present in toolSpec.description, but having it as a
   * direct property provides convenient access.
   */
  description: string

  /**
   * OpenAPI JSON specification for the tool.
   * Defines the tool's name, description, and input schema.
   */
  toolSpec: ToolSpec

  /**
   * Executes the tool with streaming support.
   * Yields zero or more ToolStreamEvents during execution, then yields
   * exactly one ToolResult as the final event.
   *
   * @param toolUse - The tool use request from the model containing the tool name, ID, and input
   * @param toolContext - Context information including invocation state
   * @returns Async iterable of tool execution events
   *
   * @example
   * ```typescript
   * const toolUse = {
   *   name: 'calculator',
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
   *     console.log('Result:', event.status)
   *   }
   * }
   * ```
   */
  stream(toolUse: ToolUse, toolContext: ToolContext): AsyncIterable<ToolExecutionEvent>
}
