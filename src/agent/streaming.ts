import type { ModelStreamEvent } from '../models/streaming'
import type { ToolStreamEvent } from '../tools/tool'
import type { ContentBlock, Message } from '../types/messages'

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
   * The tool use blocks that will be executed.
   */
  toolUseBlocks: ContentBlock[]
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
   * The tool result blocks from tool execution.
   */
  toolResultBlocks: ContentBlock[]
}

/**
 * Event emitted at the start of an agent loop iteration.
 */
export interface BeforeInvocationEvent {
  /**
   * Discriminator for before invocation events.
   */
  type: 'beforeInvocationEvent'

  /**
   * The current iteration number (starting from 0).
   */
  iteration: number
}

/**
 * Event emitted at the end of an agent loop iteration.
 */
export interface AfterInvocationEvent {
  /**
   * Discriminator for after invocation events.
   */
  type: 'afterInvocationEvent'

  /**
   * The current iteration number (starting from 0).
   */
  iteration: number
}
