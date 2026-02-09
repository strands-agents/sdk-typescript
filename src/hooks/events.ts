import { v5 as uuidv5 } from 'uuid'
import type { AgentData } from '../types/agent.js'
import type { ContentBlock, Message, StopReason, ToolResultBlock } from '../types/messages.js'
import type { Tool } from '../tools/tool.js'
import type { JSONValue } from '../types/json.js'
import type { ModelStreamEvent } from '../models/streaming.js'
import { Interrupt, InterruptException, type InterruptState, UUID_NAMESPACE_OID } from '../interrupt.js'

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
 *
 * Supports the interrupt system for human-in-the-loop workflows.
 * Hook callbacks can call `event.interrupt(name, reason)` to pause
 * agent execution and request human input.
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

  /**
   * When set by a hook callback, cancels the tool execution.
   * If set to a string, that string is used as the error message in the tool result.
   * If set to true, a default cancellation message is used.
   */
  cancelTool?: string | boolean

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

  /**
   * Trigger an interrupt to pause agent execution for human input.
   *
   * On first call, creates an Interrupt and throws InterruptException to pause execution.
   * On resume (when the interrupt already has a response), returns the human's response
   * so the callback can use it to make decisions.
   *
   * @param name - User-defined name for the interrupt. Must be unique across hook callbacks.
   * @param reason - Reason for raising the interrupt
   * @param response - Preemptive response if available
   * @returns The human's response when resuming from an interrupt state
   * @throws InterruptException when human input is required
   */
  interrupt(name: string, reason?: unknown, response?: unknown): unknown {
    const agentWithState = this.agent as unknown as { _interruptState?: InterruptState }
    if (agentWithState._interruptState === undefined) {
      throw new Error('interrupt() requires an Agent instance with interrupt state')
    }

    const interruptState = agentWithState._interruptState
    const id = `v1:before_tool_call:${this.toolUse.toolUseId}:${uuidv5(name, UUID_NAMESPACE_OID)}`

    let interrupt = interruptState.interrupts.get(id)
    if (interrupt === undefined) {
      interrupt = new Interrupt({ id, name, reason: reason ?? null, response: response ?? null })
      interruptState.interrupts.set(id, interrupt)
    }

    if (interrupt.response !== null) {
      return interrupt.response
    }

    throw new InterruptException(interrupt)
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
 * Allows hooks to observe individual streaming events during model inference.
 * Provides read-only access to streaming events.
 *
 * Currently private pending https://github.com/strands-agents/sdk-typescript/issues/288
 */
export class ModelStreamEventHook extends HookEvent {
  readonly type = 'modelStreamEventHook' as const
  readonly agent: AgentData
  readonly event: ModelStreamEvent | ContentBlock

  constructor(data: { agent: AgentData; event: ModelStreamEvent | ContentBlock }) {
    super()
    this.agent = data.agent
    this.event = data.event
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

/**
 * Event triggered when the agent is initialized for the first time.
 * Fired once per agent instance at the start of the first stream() call,
 * before the main agent loop begins. Used by session managers to restore state.
 */
export class AgentInitializedEvent extends HookEvent {
  readonly type = 'agentInitializedEvent' as const
  readonly agent: AgentData

  constructor(data: { agent: AgentData }) {
    super()
    this.agent = data.agent
  }
}
