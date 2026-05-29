import type { Stage } from './types.js'
import type {
  LocalAgent,
  AgentStreamEvent,
  InvocationState,
  InvokeArgs,
  InvokeOptions,
  AgentResult,
} from '../types/agent.js'
import type { Message, SystemPrompt, ToolResultBlock } from '../types/messages.js'
import type { ToolSpec, ToolChoice } from '../tools/types.js'
import type { StateStore } from '../state-store.js'
import type { StreamAggregatedResult } from '../models/model.js'
import type { ToolUseData } from '../hooks/events.js'
import type { Tool } from '../tools/tool.js'
import type { Interruptible } from '../interrupt.js'

/**
 * Creates a new middleware stage token.
 * The returned object is frozen and used as a Map key by the registry.
 *
 * @param name - Human-readable name for debugging/logging
 * @returns A frozen Stage object carrying the Context/Event/Result type parameters
 */
export function createStage<TContext, TEvent, TResult>(name: string): Stage<TContext, TEvent, TResult> {
  return Object.freeze({ name }) as Stage<TContext, TEvent, TResult>
}

/**
 * Context passed to model-stage middleware.
 * All inputs to the model call are explicit — middleware can inspect and transform
 * any of them by passing a modified context to next().
 */
export interface InvokeModelContext {
  /** The agent instance (escape hatch for advanced use cases). */
  readonly agent: LocalAgent
  /** The messages to send to the model. */
  readonly messages: Message[]
  /** System prompt to guide the model's behavior. */
  readonly systemPrompt?: SystemPrompt
  /** Tool specifications available to the model. */
  readonly toolSpecs: ToolSpec[]
  /** Controls how the model selects tools. */
  readonly toolChoice?: ToolChoice
  /** Runtime state for stateful model providers. */
  readonly modelState: StateStore
  /** Per-invocation state shared across hooks and tools. */
  readonly invocationState: InvocationState
}

/**
 * Result from model-stage middleware.
 * The return value of the async generator.
 */
export interface InvokeModelResult {
  /** The aggregated result from the model stream. */
  readonly result: StreamAggregatedResult
}

/**
 * Context passed to tool-stage middleware.
 * Contains everything needed to understand and potentially modify the tool call.
 */
export interface ExecuteToolContext extends Interruptible {
  /** The agent instance (escape hatch for advanced use cases). */
  readonly agent: LocalAgent
  /** The resolved tool implementation, or undefined if not found. */
  readonly tool: Tool | undefined
  /** The tool use request (name, toolUseId, input). */
  readonly toolUse: ToolUseData
  /** Per-invocation state shared across hooks and tools. */
  readonly invocationState: InvocationState
}

/**
 * Result from tool-stage middleware.
 * The return value of the async generator.
 */
export interface ExecuteToolResult {
  /** The tool result block from execution. */
  readonly result: ToolResultBlock
}

/**
 * Context passed to agent-stream-stage middleware.
 * Wraps the entire agent output stream at the outermost interception point.
 */
export interface AgentStreamContext extends Interruptible {
  /** The agent instance (escape hatch for advanced use cases). */
  readonly agent: LocalAgent
  /** The invocation arguments passed to agent.stream(). */
  readonly args: InvokeArgs
  /** Per-invocation options (cancel signal, structured output, etc.). */
  readonly options?: InvokeOptions
}

/**
 * Result from agent-stream-stage middleware.
 * The return value of the async generator.
 */
export interface AgentStreamResult {
  /** The final agent result from the stream. */
  readonly result: AgentResult
}

/**
 * Built-in stage wrapping core model invocation.
 * Middleware registered for this stage can rate-limit, cache, or transform model inputs.
 */
export const InvokeModelStage = createStage<InvokeModelContext, AgentStreamEvent, InvokeModelResult>('invokeModel')

/**
 * Built-in stage wrapping individual tool execution.
 * Middleware registered for this stage can add telemetry, validate inputs, or mock responses.
 */
export const ExecuteToolStage = createStage<ExecuteToolContext, AgentStreamEvent, ExecuteToolResult>('executeTool')

/**
 * Built-in stage wrapping the entire agent output stream.
 * Middleware registered for this stage can filter, transform, or inject events.
 */
export const AgentStreamStage = createStage<AgentStreamContext, AgentStreamEvent, AgentStreamResult>('agentStream')
