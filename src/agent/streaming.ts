import type { ModelStreamEvent } from '../models/streaming.js'
import type { ToolStreamEvent } from '../tools/tool.js'
import type { ContentBlock, Message } from '../types/messages.js'

/**
 * Union type representing all possible streaming events from an agent.
 * This includes model events, tool events, and agent-specific lifecycle events.
 *
 * This is a discriminated union where each event has a unique type field,
 * allowing for type-safe event handling using switch statements.
 */
export type AgentStreamEvent =
  | ModelStreamEvent
  | ContentBlock
  | ToolStreamEvent
  | BeforeModelEvent
  | AfterModelEvent
  | BeforeToolsEvent
  | AfterToolsEvent
  | BeforeInvocationEvent
  | AfterInvocationEvent

/**
 * Event emitted before invoking the model provider.
 */
export interface BeforeModelEvent {
  /**
   * Discriminator for before model events.
   */
  type: 'beforeModelEvent'

  /**
   * The messages that will be sent to the model.
   */
  messages: Message[]
}

/**
 * Event emitted after the model provider completes.
 */
export interface AfterModelEvent {
  /**
   * Discriminator for after model events.
   */
  type: 'afterModelEvent'

  /**
   * The assistant message returned by the model.
   */
  message: Message

  /**
   * The stop reason from the model response.
   */
  stopReason: string
}

/**
 * Event emitted before executing tools.
 */
export interface BeforeToolsEvent {
  /**
   * Discriminator for before tools events.
   */
  type: 'beforeToolsEvent'

  /**
   * The assistant message containing tool use blocks.
   */
  message: Message
}

/**
 * Event emitted after all tools complete execution.
 */
export interface AfterToolsEvent {
  /**
   * Discriminator for after tools events.
   */
  type: 'afterToolsEvent'

  /**
   * The user message containing tool results that will be added to the message array.
   */
  message: Message
}

/**
 * Event emitted at the start of the agent loop (before any iterations).
 */
export interface BeforeInvocationEvent {
  /**
   * Discriminator for before invocation events.
   */
  type: 'beforeInvocationEvent'
}

/**
 * Event emitted at the end of the agent loop (after all iterations complete).
 */
export interface AfterInvocationEvent {
  /**
   * Discriminator for after invocation events.
   */
  type: 'afterInvocationEvent'

  /**
   * Optional error that caused the loop to terminate.
   * Present if the loop is completing due to an exception.
   */
  error?: Error
}
