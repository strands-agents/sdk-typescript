import type { AgentData, AgentResult } from '../types/agent.js'
import type { ContentBlock, Message, StopReason, ToolResultBlock } from '../types/messages.js'
import { type Tool, ToolStreamEvent } from '../tools/tool.js'
import type { JSONValue } from '../types/json.js'
import type { ModelStreamEvent } from '../models/streaming.js'

/**
 * Base class for all hook events.
 * Hook events are emitted at specific points in the agent lifecycle.
 */
export abstract class HookEvent {
  /**
   * @internal
   * Check if callbacks should be reversed for this event.
   * Used by HookRegistry for callback ordering.
   */
  _shouldReverseCallbacks(): boolean {
    return false
  }
}

/**
 * Event triggered when an agent has finished initialization.
 * Fired after the agent has been fully constructed and all built-in components have been initialized.
 */
export class InitializedEvent extends HookEvent {
  readonly type = 'initializedEvent' as const
  readonly agent: AgentData

  constructor(data: { agent: AgentData }) {
    super()
    this.agent = data.agent
  }
}

/**
 * Event triggered at the beginning of a new agent request.
 * Fired before any model inference or tool execution occurs.
 */
export class BeforeInvocationEvent extends HookEvent {
  readonly type = 'beforeInvocationEvent' as const
  readonly agent: AgentData

  constructor(data: { agent: AgentData }) {
    super()
    this.agent = data.agent
  }
}

/**
 * Event triggered at the end of an agent request.
 * Fired after all processing completes, regardless of success or error.
 * Uses reverse callback ordering for proper cleanup semantics.
 */
export class AfterInvocationEvent extends HookEvent {
  readonly type = 'afterInvocationEvent' as const
  readonly agent: AgentData

  constructor(data: { agent: AgentData }) {
    super()
    this.agent = data.agent
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}

/**
 * Event triggered when the framework adds a message to the conversation history.
 * Fired during the agent loop execution for framework-generated messages.
 * Does not fire for initial messages from AgentConfig or user input messages.
 */
export class MessageAddedEvent extends HookEvent {
  readonly type = 'messageAddedEvent' as const
  readonly agent: AgentData
  readonly message: Message

  constructor(data: { agent: AgentData; message: Message }) {
    super()
    this.agent = data.agent
    this.message = data.message
  }
}

/**
 * Event triggered just before a tool is executed.
 * Fired after tool lookup but before execution begins.
 */
export class BeforeToolCallEvent extends HookEvent {
  readonly type = 'beforeToolCallEvent' as const
  readonly agent: AgentData
  readonly toolUse: {
    name: string
    toolUseId: string
    input: JSONValue
  }
  readonly tool: Tool | undefined

  constructor(data: {
    agent: AgentData
    toolUse: { name: string; toolUseId: string; input: JSONValue }
    tool: Tool | undefined
  }) {
    super()
    this.agent = data.agent
    this.toolUse = data.toolUse
    this.tool = data.tool
  }
}

/**
 * Event triggered after a tool execution completes.
 * Fired after tool execution finishes, whether successful or failed.
 * Uses reverse callback ordering for proper cleanup semantics.
 */
export class AfterToolCallEvent extends HookEvent {
  readonly type = 'afterToolCallEvent' as const
  readonly agent: AgentData
  readonly toolUse: {
    name: string
    toolUseId: string
    input: JSONValue
  }
  readonly tool: Tool | undefined
  readonly result: ToolResultBlock
  readonly error?: Error

  /**
   * Optional flag that can be set by hook callbacks to request a retry of the tool call.
   * When set to true, the agent will re-execute the tool.
   */
  retry?: boolean

  constructor(data: {
    agent: AgentData
    toolUse: { name: string; toolUseId: string; input: JSONValue }
    tool: Tool | undefined
    result: ToolResultBlock
    error?: Error
  }) {
    super()
    this.agent = data.agent
    this.toolUse = data.toolUse
    this.tool = data.tool
    this.result = data.result
    if (data.error !== undefined) {
      this.error = data.error
    }
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}

/**
 * Event triggered just before the model is invoked.
 * Fired before sending messages to the model for inference.
 */
export class BeforeModelCallEvent extends HookEvent {
  readonly type = 'beforeModelCallEvent' as const
  readonly agent: AgentData

  constructor(data: { agent: AgentData }) {
    super()
    this.agent = data.agent
  }
}

/**
 * Response from a model invocation containing the message and stop reason.
 */
export interface ModelStopData {
  /**
   * The message returned by the model.
   */
  readonly message: Message
  /**
   * The reason the model stopped generating.
   */
  readonly stopReason: StopReason
}

/**
 * Event triggered after the model invocation completes.
 * Fired after the model finishes generating a response, whether successful or failed.
 * Uses reverse callback ordering for proper cleanup semantics.
 *
 * Note: stopData may be undefined if an error occurs before the model completes.
 */
export class AfterModelCallEvent extends HookEvent {
  readonly type = 'afterModelCallEvent' as const
  readonly agent: AgentData
  readonly stopData?: ModelStopData
  readonly error?: Error

  /**
   * Optional flag that can be set by hook callbacks to request a retry of the model call.
   * When set to true, the agent will retry the model invocation.
   */
  retry?: boolean

  constructor(data: { agent: AgentData; stopData?: ModelStopData; error?: Error }) {
    super()
    this.agent = data.agent
    if (data.stopData !== undefined) {
      this.stopData = data.stopData
    }
    if (data.error !== undefined) {
      this.error = data.error
    }
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}

/**
 * Event triggered for each streaming event from the model.
 * Wraps a {@link ModelStreamEvent} (transient streaming delta) during model inference.
 * Both yielded in the agent stream and hookable.
 *
 * This event wraps only {@link ModelStreamEvent} (transient streaming deltas — partial
 * data arriving while the model generates). Completed content blocks are handled
 * separately by {@link ContentBlockCompleteEvent} because they represent different
 * granularities: partial deltas vs fully assembled results.
 */
export class ModelStreamObserverEvent extends HookEvent {
  readonly type = 'modelStreamObserverEvent' as const
  readonly agent: AgentData
  readonly event: ModelStreamEvent

  constructor(data: { agent: AgentData; event: ModelStreamEvent }) {
    super()
    this.agent = data.agent
    this.event = data.event
  }
}

/**
 * Event triggered when a content block completes during model inference.
 * Wraps completed content blocks (TextBlock, ToolUseBlock, ReasoningBlock) from model streaming.
 * Both yielded in the agent stream and hookable.
 *
 * This is intentionally separate from {@link ModelStreamObserverEvent}. The model's
 * `streamAggregated()` yields two kinds of output: {@link ModelStreamEvent} (transient
 * streaming deltas — partial data arriving while the model generates) and
 * {@link ContentBlock} (fully assembled results after all deltas accumulate).
 * These represent different granularities with different semantics, so they are
 * wrapped in distinct event classes rather than combined into a single event.
 */
export class ContentBlockCompleteEvent extends HookEvent {
  readonly type = 'contentBlockCompleteEvent' as const
  readonly agent: AgentData
  readonly contentBlock: ContentBlock

  constructor(data: { agent: AgentData; contentBlock: ContentBlock }) {
    super()
    this.agent = data.agent
    this.contentBlock = data.contentBlock
  }
}

/**
 * Event triggered when the model completes a full message.
 * Wraps the assembled message and stop reason after model streaming finishes.
 */
export class ModelMessageEvent extends HookEvent {
  readonly type = 'modelMessageEvent' as const
  readonly agent: AgentData
  readonly message: Message
  readonly stopReason: StopReason

  constructor(data: { agent: AgentData; message: Message; stopReason: StopReason }) {
    super()
    this.agent = data.agent
    this.message = data.message
    this.stopReason = data.stopReason
  }
}

/**
 * Event triggered when a tool execution completes.
 * Wraps the tool result block after a tool finishes execution.
 */
export class ToolResultEvent extends HookEvent {
  readonly type = 'toolResultEvent' as const
  readonly agent: AgentData
  readonly toolResult: ToolResultBlock

  constructor(data: { agent: AgentData; toolResult: ToolResultBlock }) {
    super()
    this.agent = data.agent
    this.toolResult = data.toolResult
  }
}

/**
 * Event triggered for each streaming progress event from a tool during execution.
 * Wraps a {@link ToolStreamEvent} with agent context, keeping the tool authoring
 * interface unchanged — tools construct `ToolStreamEvent` without knowledge of agents
 * or hooks, and the agent layer wraps them at the boundary.
 *
 * Both yielded in the agent stream and hookable, consistent with
 * {@link ModelStreamObserverEvent} which wraps model streaming events the same way.
 */
export class ToolStreamObserverEvent extends HookEvent {
  readonly type = 'toolStreamObserverEvent' as const
  readonly agent: AgentData
  readonly toolStreamEvent: ToolStreamEvent

  constructor(data: { agent: AgentData; toolStreamEvent: ToolStreamEvent }) {
    super()
    this.agent = data.agent
    this.toolStreamEvent = data.toolStreamEvent
  }
}

/**
 * Event triggered as the final event in the agent stream.
 * Wraps the agent result containing the stop reason and last message.
 */
export class AgentResultEvent extends HookEvent {
  readonly type = 'agentResultEvent' as const
  readonly agent: AgentData
  readonly result: AgentResult

  constructor(data: { agent: AgentData; result: AgentResult }) {
    super()
    this.agent = data.agent
    this.result = data.result
  }
}

/**
 * Event triggered before executing tools.
 * Fired when the model returns tool use blocks that need to be executed.
 */
export class BeforeToolsEvent extends HookEvent {
  readonly type = 'beforeToolsEvent' as const
  readonly agent: AgentData
  readonly message: Message

  constructor(data: { agent: AgentData; message: Message }) {
    super()
    this.agent = data.agent
    this.message = data.message
  }
}

/**
 * Event triggered after all tools complete execution.
 * Fired after tool results are collected and ready to be added to conversation.
 * Uses reverse callback ordering for proper cleanup semantics.
 */
export class AfterToolsEvent extends HookEvent {
  readonly type = 'afterToolsEvent' as const
  readonly agent: AgentData
  readonly message: Message

  constructor(data: { agent: AgentData; message: Message }) {
    super()
    this.agent = data.agent
    this.message = data.message
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}
