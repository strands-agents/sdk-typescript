import type { AgentState } from '../agent/state.js'
import type { ConversationManager } from '../conversation-manager/conversation-manager.js'
import type { Interrupt } from '../interrupt.js'
import type { Message, StopReason } from './messages.js'
import type { ModelStreamEvent } from '../models/streaming.js'
import type { Usage, Metrics } from '../models/streaming.js'
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
  AgentInitializedEvent,
} from '../hooks/events.js'

/**
 * Interface for objects that provide agent state and identity.
 * Allows ToolContext and SessionManager to work with different agent types.
 */
export interface AgentData {
  /**
   * Unique identifier for the agent within a session.
   */
  agentId: string

  /**
   * Agent state storage accessible to tools and application logic.
   */
  state: AgentState

  /**
   * The conversation history of messages between user and assistant.
   */
  messages: Message[]

  /**
   * Conversation manager for managing message history.
   */
  conversationManager: ConversationManager
}

/**
 * Accumulated metrics from an agent invocation.
 */
export interface AgentResultMetrics {
  /**
   * Accumulated token usage across all model calls in this invocation.
   */
  accumulatedUsage?: Usage

  /**
   * Accumulated performance metrics across all model calls in this invocation.
   */
  accumulatedMetrics?: Metrics
}

/**
 * Result returned by the agent loop.
 */
export class AgentResult {
  readonly type = 'agentResult' as const

  /**
   * The stop reason from the final model response.
   */
  readonly stopReason: StopReason

  /**
   * The last message added to the messages array.
   */
  readonly lastMessage: Message

  /**
   * Validated structured output when a structured output schema was requested.
   * Present when the model successfully invoked the structured output tool.
   */
  readonly structuredOutput?: unknown

  /**
   * Accumulated usage and performance metrics from all model calls during this invocation.
   */
  readonly metrics: AgentResultMetrics | undefined

  /**
   * Interrupts that occurred during agent execution.
   * Present when `stopReason` is `'interrupt'`, containing the interrupts
   * that need human responses before the agent can resume.
   */
  readonly interrupts: Interrupt[]

  constructor(data: {
    stopReason: StopReason
    lastMessage: Message
    structuredOutput?: unknown
    metrics?: AgentResultMetrics
    interrupts?: Interrupt[]
  }) {
    this.stopReason = data.stopReason
    this.lastMessage = data.lastMessage
    this.structuredOutput = data.structuredOutput
    this.metrics = data.metrics
    this.interrupts = data.interrupts ?? []
  }

  /**
   * Extracts and concatenates all text content from the last message.
   * When interrupts are present, returns a summary of the interrupts.
   * When structuredOutput is present, returns its JSON string representation.
   * Otherwise includes text from TextBlock and ReasoningBlock content blocks.
   *
   * @returns The agent's response as a string.
   */
  public toString(): string {
    if (this.interrupts.length > 0) {
      return this.interrupts.map((i) => `Interrupt: ${i.name} (${i.id})`).join('\n')
    }

    if (this.structuredOutput !== undefined && this.structuredOutput !== null) {
      return JSON.stringify(this.structuredOutput)
    }

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
  | AgentInitializedEvent
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
