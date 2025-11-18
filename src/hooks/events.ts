import type { AgentData } from '../types/agent.js'
import type { Message, ToolResultBlock } from '../types/messages.js'
import type { Tool } from '../tools/tool.js'
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
 * Event triggered after the model invocation completes.
 * Fired after the model finishes generating a response, whether successful or failed.
 * Uses reverse callback ordering for proper cleanup semantics.
 */
export class AfterModelCallEvent extends HookEvent {
  readonly type = 'afterModelCallEvent' as const
  readonly agent: AgentData
  readonly message: Message
  readonly stopReason: string
  readonly error?: Error

  constructor(data: { agent: AgentData; message: Message; stopReason: string; error?: Error }) {
    super()
    this.agent = data.agent
    this.message = data.message
    this.stopReason = data.stopReason
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
 * Allows hooks to observe individual streaming events during model inference.
 * Provides read-only access to streaming events.
 */
export class ModelStreamEventHook extends HookEvent {
  readonly type = 'modelStreamEventHook' as const
  readonly agent: AgentData
  readonly event: ModelStreamEvent

  constructor(data: { agent: AgentData; event: ModelStreamEvent }) {
    super()
    this.agent = data.agent
    this.event = data.event
  }
}
