import type { AgentState } from '../agent/state.js'
import type { Message } from './messages.js'
import type { ModelStreamEvent } from '../models/streaming.js'
import { ToolStreamEvent } from '../tools/tool.js'
import type { ContentBlock } from './messages.js'
import type {
  BeforeInvocationEvent,
  AfterInvocationEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  BeforeToolsEvent,
  AfterToolsEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  MessageAddedEvent,
  ModelStreamEventHook,
} from '../hooks/events.js'

/**
 * Interface for objects that provide agent state.
 * Allows ToolContext to work with different agent types.
 */
export interface AgentData {
  /**
   * Agent state storage accessible to tools and application logic.
   */
  state: AgentState

  /**
   * The conversation history of messages between user and assistant.
   */
  messages: Message[]
}

/**
 * Result returned by the agent loop.
 */
export interface AgentResult {
  /**
   * Discriminator for agent result.
   */
  type: 'agentResult'

  /**
   * The stop reason from the final model response.
   */
  stopReason: string

  /**
   * The last message added to the messages array.
   */
  lastMessage: Message
}

/**
 * Union type representing all possible streaming events from an agent.
 * This includes model events, tool events, and agent-specific lifecycle events.
 *
 * This is a discriminated union where each event has a unique type field,
 * allowing for type-safe event handling using switch statements.
 *
 * Note: All agent lifecycle events are Hook Event instances, providing
 * consistent structure with agent reference and extensibility features.
 */
export type AgentStreamEvent =
  | ModelStreamEvent
  | ContentBlock
  | ToolStreamEvent
  | BeforeInvocationEvent
  | AfterInvocationEvent
  | BeforeModelCallEvent
  | AfterModelCallEvent
  | BeforeToolsEvent
  | AfterToolsEvent
  | BeforeToolCallEvent
  | AfterToolCallEvent
  | MessageAddedEvent
  | ModelStreamEventHook
  | AgentResult
