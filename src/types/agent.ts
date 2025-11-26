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
export class AgentResult {
  readonly type = 'agentResult' as const

  /**
   * The stop reason from the final model response.
   */
  readonly stopReason: string

  /**
   * The last message added to the messages array.
   */
  readonly lastMessage: Message

  constructor(data: { stopReason: string; lastMessage: Message }) {
    this.stopReason = data.stopReason
    this.lastMessage = data.lastMessage
  }

  /**
   * Extracts and concatenates all text content from the last message.
   * Includes text from TextBlock and ReasoningBlock content blocks.
   *
   * @returns The agent's last message as a string, with multiple blocks joined by newlines.
   */
  public toString(): string {
    const textParts: string[] = []

    for (const block of this.lastMessage.content) {
      switch (block.type) {
        case 'textBlock':
          textParts.push(block.text)
          break
        case 'reasoningBlock':
          if (block.text) {
            // Add indentation to reasoning content
            const indentedText = block.text.replace(/\n/g, '\n   ')
            textParts.push(`💭 Reasoning:\n   ${indentedText}`)
          }
          break
        default:
          console.debug(`Skipping content block type: ${block.type}`)
          break
      }
    }

    return textParts.join('\n')
  }
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
