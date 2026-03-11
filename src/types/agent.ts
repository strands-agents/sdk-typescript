import type { AppState } from '../app-state.js'
import type { Message, StopReason } from './messages.js'
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
  ModelStreamUpdateEvent,
  ContentBlockEvent,
  ModelMessageEvent,
  ToolResultEvent,
  ToolStreamUpdateEvent,
  AgentResultEvent,
  HookableEvent,
} from '../hooks/events.js'
import type { HookCallback, HookableEventConstructor, HookCleanup } from '../hooks/types.js'
import type { ToolRegistry } from '../registry/tool-registry.js'
import type { z } from 'zod'
import { AgentMetrics } from '../telemetry/meter.js'

/**
 * Interface for objects that provide agent state.
 * Allows ToolContext to work with different agent types.
 */
export interface AgentData {
  /**
   * App state storage accessible to tools and application logic.
   */
  state: AppState

  /**
   * The conversation history of messages between user and assistant.
   */
  messages: Message[]

  /**
   * The tool registry for registering tools with the agent.
   */
  readonly toolRegistry: ToolRegistry

  /**
   * Register a hook callback for a specific event type.
   *
   * @param eventType - The event class constructor to register the callback for
   * @param callback - The callback function to invoke when the event occurs
   * @returns Cleanup function that removes the callback when invoked
   */
  addHook<T extends HookableEvent>(eventType: HookableEventConstructor<T>, callback: HookCallback<T>): HookCleanup
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
   * The validated structured output from the LLM, if a schema was provided.
   * Type represents any validated Zod schema output.
   */
  readonly structuredOutput?: z.output<z.ZodType>

  /**
   * Aggregated metrics for the agent's loop execution.
   * Tracks cycle counts, token usage, tool execution stats, and model latency.
   */
  readonly metrics?: AgentMetrics

  constructor(data: {
    stopReason: StopReason
    lastMessage: Message
    metrics?: AgentMetrics
    structuredOutput?: z.output<z.ZodType>
  }) {
    this.stopReason = data.stopReason
    this.lastMessage = data.lastMessage
    if (data.metrics !== undefined) {
      this.metrics = data.metrics
    }
    if (data.structuredOutput !== undefined) {
      this.structuredOutput = data.structuredOutput
    }
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
 * Every member extends {@link HookableEvent} (which extends {@link StreamEvent}),
 * making all events both streamable and subscribable via hook callbacks.
 * Raw data objects from lower layers (model, tools) should be wrapped
 * in a StreamEvent subclass at the agent boundary rather than added directly.
 */
export type AgentStreamEvent =
  | ModelStreamUpdateEvent
  | ContentBlockEvent
  | ModelMessageEvent
  | ToolStreamUpdateEvent
  | ToolResultEvent
  | BeforeInvocationEvent
  | AfterInvocationEvent
  | BeforeModelCallEvent
  | AfterModelCallEvent
  | BeforeToolsEvent
  | AfterToolsEvent
  | BeforeToolCallEvent
  | AfterToolCallEvent
  | MessageAddedEvent
  | AgentResultEvent
