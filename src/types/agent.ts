import type { StateStore } from '../state-store.js'
import type { ContentBlock, ContentBlockData, Message, MessageData, StopReason } from './messages.js'
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
  StreamEvent,
} from '../hooks/events.js'
import type { HookCallback, HookableEventConstructor, HookCleanup } from '../hooks/types.js'
import type { ToolRegistry } from '../registry/tool-registry.js'
import type { z } from 'zod'
import { AgentMetrics } from '../telemetry/meter.js'

/**
 * Arguments for invoking an agent.
 *
 * Supports multiple input formats:
 * - `string` - User text input (wrapped in TextBlock, creates user Message)
 * - `ContentBlock[]` | `ContentBlockData[]` - Array of content blocks (creates single user Message)
 * - `Message[]` | `MessageData[]` - Array of messages (appends all to conversation)
 */
export type InvokeArgs = string | ContentBlock[] | ContentBlockData[] | Message[] | MessageData[]

/**
 * Options for a single agent invocation.
 */
export interface InvokeOptions {
  /**
   * Zod schema for structured output validation, overriding the constructor-provided schema for this invocation only.
   */
  structuredOutputSchema?: z.ZodSchema
}

/**
 * Interface for agents that support request-response invocation.
 *
 * Both `Agent` (full orchestration agent) and `A2AAgent` (remote agent proxy)
 * implement this interface, enabling polymorphic usage across the SDK.
 */
export interface InvokableAgent {
  /**
   * The unique identifier of the agent instance.
   */
  readonly id: string

  /**
   * The name of the agent.
   */
  readonly name?: string

  /**
   * Optional description of what the agent does.
   */
  readonly description?: string

  /**
   * Invokes the agent and returns the final result.
   *
   * @param args - Arguments for invoking the agent
   * @param options - Optional invocation options (e.g. structured output schema)
   * @returns Promise that resolves to the final AgentResult
   */
  invoke(args: InvokeArgs, options?: InvokeOptions): Promise<AgentResult>

  /**
   * Streams the agent execution, yielding events and returning the final result.
   *
   * @param args - Arguments for invoking the agent
   * @param options - Optional invocation options (e.g. structured output schema)
   * @returns Async generator that yields stream events and returns AgentResult
   */
  stream(args: InvokeArgs, options?: InvokeOptions): AsyncGenerator<StreamEvent, AgentResult, undefined>
}

/**
 * Interface for agents with locally accessible state, messages, tools, and hooks.
 * Used by ToolContext and hook events that need access to agent internals.
 */
export interface LocalAgent {
  /**
   * App state storage accessible to tools and application logic.
   */
  appState: StateStore

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
