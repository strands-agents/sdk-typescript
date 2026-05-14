/**
 * Direct tool calling support through agent.tool accessor.
 *
 * Enables method-style tool invocation without model inference:
 * ```typescript
 * const agent = new Agent({ tools: [myTool] })
 * const result = await agent.tool.calculator({ a: 5, b: 3 })
 * ```
 */

import type { JSONValue } from '../types/json.js'
import type { ToolResultBlock } from '../types/messages.js'
import { Message } from '../types/messages.js'
import { TextBlock, ToolUseBlock } from '../types/messages.js'
import type { Tool, ToolContext } from '../tools/tool.js'
import type { ToolUse } from '../tools/types.js'
import type { Agent } from './agent.js'
import { ConcurrentInvocationError, ToolNotFoundError } from '../errors.js'

/**
 * Options for direct tool call execution.
 */
export interface DirectToolCallOptions {
  /**
   * Whether to record this tool call in the agent's message history.
   * Defaults to `true`. Set to `false` to execute the tool without
   * affecting conversation context.
   */
  recordDirectToolCall?: boolean
}

/**
 * Type for the function returned by the Proxy get trap.
 * Represents a callable tool that accepts input and options.
 *
 * The Proxy guarantees a function is returned for every property access
 * (returned by the Proxy get trap). If the tool doesn't exist, the
 * returned function throws when called. This means `agent.tool.anyName`
 * is never `undefined` at runtime, even though TypeScript's index
 * signature suggests it might be.
 */
export type ToolCallerFn = (input?: JSONValue, options?: DirectToolCallOptions) => Promise<ToolResultBlock>

/**
 * The public type of the tool caller proxy.
 * Provides dynamic property access where each property is a callable tool function.
 */
export type ToolCallerProxy = Record<string, ToolCallerFn>

/**
 * Provides direct tool calling through the agent.
 *
 * Enables programmatic tool invocation without model inference via `agent.tool.toolName(input)`.
 * Tools are called directly, bypassing the model loop, and results are optionally
 * recorded in message history for context continuity.
 *
 * Supports underscore-to-hyphen normalization: `agent.tool.my_tool()` matches a tool named `my-tool`.
 *
 * @example
 * ```typescript
 * const agent = new Agent({ tools: [calculatorTool] })
 * const result = await agent.tool.calculator({ operation: 'add', a: 5, b: 3 })
 * console.log(result.status) // 'success'
 * ```
 *
 * @internal This class is not intended for direct instantiation by users.
 */
export class ToolCaller {
  private readonly _agent: Agent

  /**
   * Creates a ToolCaller proxy for the given agent.
   *
   * Encapsulates the Proxy cast so callers don't need to handle the
   * implementation detail that the constructor returns a Proxy, not
   * a plain ToolCaller instance.
   */
  static create(agent: Agent): ToolCallerProxy {
    return new ToolCaller(agent) as unknown as ToolCallerProxy
  }

  private constructor(agent: Agent) {
    this._agent = agent

    // Return a Proxy that intercepts property access to resolve tool names
    return new Proxy(this, {
      get(target: ToolCaller, prop: string | symbol, receiver: unknown): ToolCallerFn | unknown {
        // Pass through symbol properties (Symbol.toPrimitive, Symbol.iterator, etc.)
        // Uses Reflect.get for proper receiver forwarding.
        if (typeof prop === 'symbol') {
          return Reflect.get(target, prop, receiver)
        }

        // Prevent accidental thenable behavior — if a user writes `await agent.tool`
        // the JS runtime checks for `.then`. Without this guard, the Proxy would return
        // a callable that throws "Tool 'then' not found", which is confusing.
        if (prop === 'then') {
          return undefined
        }

        // Return a function that executes the named tool.
        // We intentionally do NOT fall through to `prop in target` here — that would
        // cause tool names that collide with inherited Object properties (e.g.,
        // 'constructor', 'toString', 'valueOf') to return the wrong value.
        return (input?: JSONValue, options?: DirectToolCallOptions): Promise<ToolResultBlock> => {
          return target._callTool(prop, input ?? {}, options)
        }
      },
    })
  }

  /**
   * Executes a tool by name with the given input.
   *
   * @param name - The tool name (supports underscore-to-hyphen normalization)
   * @param input - The input parameters for the tool
   * @param options - Optional configuration for this call
   * @returns The tool result
   */
  private async _callTool(name: string, input: JSONValue, options?: DirectToolCallOptions): Promise<ToolResultBlock> {
    const shouldRecord = options?.recordDirectToolCall ?? true

    // If recording, check that the agent is not currently invoking
    if (shouldRecord && this._agent.isInvoking) {
      throw new ConcurrentInvocationError(
        'Direct tool call cannot be made while the agent is in the middle of an invocation. ' +
          'Set recordDirectToolCall: false to allow direct tool calls during agent invocation.'
      )
    }

    // _findNormalizedToolName throws if the tool doesn't exist
    const normalizedName = this._findNormalizedToolName(name)
    const tool = this._agent.toolRegistry.get(normalizedName)!

    // Generate unique tool use ID
    const toolUseId = `tooluse_${globalThis.crypto.randomUUID()}`
    const toolUse: ToolUse = {
      toolUseId,
      name: normalizedName,
      input,
    }

    // Create tool context
    const toolContext: ToolContext = {
      toolUse,
      agent: this._agent,
      invocationState: {},
      interrupt: (): never => {
        throw new Error('Interrupts are not supported in direct tool calls')
      },
    }

    // Execute the tool
    const toolResult = await this._executeTool(tool, toolContext)

    // Record in message history if configured
    if (shouldRecord) {
      this._recordToolExecution(toolUse, toolResult)
    }

    return toolResult
  }

  /**
   * Executes a tool's stream generator and returns the final result.
   */
  private async _executeTool(tool: Tool, toolContext: ToolContext): Promise<ToolResultBlock> {
    const generator = tool.stream(toolContext)
    let result = await generator.next()
    while (!result.done) {
      // Consume stream events (discard them in direct call mode)
      result = await generator.next()
    }
    return result.value
  }

  /**
   * Finds the normalized tool name, supporting underscore-to-hyphen and
   * case-insensitive resolution.
   *
   * Resolution order:
   * 1. Exact match
   * 2. Underscore-to-hyphen substitution (e.g. `my_tool` → `my-tool`)
   * 3. Case-insensitive match
   *
   * @param name - The name to look up
   * @returns The actual registered tool name
   * @throws Error if no tool with the given name exists
   */
  private _findNormalizedToolName(name: string): string {
    // 1. Direct match
    if (this._agent.toolRegistry.get(name)) {
      return name
    }

    const tools = this._agent.toolRegistry.list()

    // 2. Underscore-to-hyphen normalization
    if (name.includes('_')) {
      const match = tools.find((t) => t.name.replace(/-/g, '_') === name)
      if (match) {
        return match.name
      }
    }

    // 3. Case-insensitive match
    const lowerName = name.toLowerCase()
    const caseMatch = tools.find((t) => t.name.toLowerCase() === lowerName)
    if (caseMatch) {
      return caseMatch.name
    }

    throw new ToolNotFoundError(name)
  }

  /**
   * Records a tool execution in the agent's message history.
   *
   * Creates a sequence of 3 messages that represent the tool execution:
   * 1. An assistant message with the ToolUseBlock (what was called and with what params)
   * 2. A user message with the ToolResultBlock (tool output)
   * 3. An assistant message acknowledging the result
   */
  private _recordToolExecution(toolUse: ToolUse, toolResult: ToolResultBlock): void {
    const filteredInput = this._filterToolParameters(toolUse.name, toolUse.input)

    // Create filtered tool use block for the assistant message
    const filteredToolUse = new ToolUseBlock({
      toolUseId: toolUse.toolUseId,
      name: toolUse.name,
      input: filteredInput,
    })

    // Create the message sequence — tool use block in assistant message,
    // tool result in user message. Input parameters only appear once in the
    // tool use block (not duplicated as text).
    const toolUseMsg = new Message({ role: 'assistant', content: [filteredToolUse] })
    const toolResultMsg = new Message({ role: 'user', content: [toolResult] })
    const assistantMsg = new Message({
      role: 'assistant',
      content: [new TextBlock(`agent.tool.${toolUse.name} was called.`)],
    })

    // Add to message history
    this._agent.messages.push(toolUseMsg, toolResultMsg, assistantMsg)
  }

  /**
   * Filters input parameters to only include those defined in the tool specification.
   */
  private _filterToolParameters(toolName: string, input: JSONValue): JSONValue {
    const tool = this._agent.toolRegistry.get(toolName)
    if (!tool?.toolSpec.inputSchema) {
      return input
    }

    const properties = (tool.toolSpec.inputSchema as { properties?: Record<string, unknown> }).properties
    if (!properties || typeof input !== 'object' || input === null || Array.isArray(input)) {
      return input
    }

    const filtered: Record<string, JSONValue> = {}
    for (const [key, value] of Object.entries(input as Record<string, JSONValue>)) {
      if (key in properties) {
        filtered[key] = value
      }
    }
    return filtered
  }
}
