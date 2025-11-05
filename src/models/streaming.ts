import type { Role, StopReason } from '../types/messages.js'
import type { JSONValue } from '../types/json.js'

/**
 * Union type representing all possible streaming events from a model provider.
 * This is a discriminated union where each event has a unique type field.
 *
 * This allows for type-safe event handling using switch statements.
 */
export type ModelStreamEvent =
  | ModelMessageStartEvent
  | ModelContentBlockStartEvent
  | ModelContentBlockDeltaEvent
  | ModelContentBlockStopEvent
  | ModelMessageStopEvent
  | ModelMetadataEvent

/**
 * Event emitted when a new message starts in the stream.
 */
export interface ModelMessageStartEvent {
  /**
   * Discriminator for message start events.
   */
  type: 'modelMessageStartEvent'

  /**
   * The role of the message being started.
   */
  role: Role
}

/**
 * Event emitted when a new content block starts in the stream.
 */
export interface ModelContentBlockStartEvent {
  /**
   * Discriminator for content block start events.
   */
  type: 'modelContentBlockStartEvent'

  /**
   * Index of this content block within the message.
   */
  contentBlockIndex?: number

  /**
   * Information about the content block being started.
   * Only present for tool use blocks.
   */
  start?: ContentBlockStart
}

/**
 * Event emitted when there is new content in a content block.
 */
export interface ModelContentBlockDeltaEvent {
  /**
   * Discriminator for content block delta events.
   */
  type: 'modelContentBlockDeltaEvent'

  /**
   * Index of the content block being updated.
   */
  contentBlockIndex?: number

  /**
   * The incremental content update.
   */
  delta: ContentBlockDelta
}

/**
 * Event emitted when a content block completes.
 */
export interface ModelContentBlockStopEvent {
  /**
   * Discriminator for content block stop events.
   */
  type: 'modelContentBlockStopEvent'

  /**
   * Index of the content block that stopped.
   */
  contentBlockIndex?: number
}

/**
 * Event emitted when the message completes.
 */
export interface ModelMessageStopEvent {
  /**
   * Discriminator for message stop events.
   */
  type: 'modelMessageStopEvent'

  /**
   * Reason why generation stopped.
   */
  stopReason?: StopReason

  /**
   * Additional provider-specific response fields.
   */
  additionalModelResponseFields?: JSONValue
}

/**
 * Event containing metadata about the stream.
 * Includes usage statistics, performance metrics, and trace information.
 */
export interface ModelMetadataEvent {
  /**
   * Discriminator for metadata events.
   */
  type: 'modelMetadataEvent'

  /**
   * Token usage information.
   */
  usage?: Usage

  /**
   * Performance metrics.
   */
  metrics?: Metrics

  /**
   * Trace information for observability.
   */
  trace?: unknown
}

/**
 * Information about a content block that is starting.
 * Currently only represents tool use starts.
 */
export type ContentBlockStart = ToolUseStart

/**
 * Information about a tool use that is starting.
 */
export interface ToolUseStart {
  /**
   * Discriminator for tool use start.
   */
  type: 'toolUseStart'

  /**
   * The name of the tool being used.
   */
  name: string

  /**
   * Unique identifier for this tool use.
   */
  toolUseId: string
}

/**
 * A delta (incremental chunk) of content within a content block.
 * Can be text, tool use input, or reasoning content.
 *
 * This is a discriminated union for type-safe delta handling.
 */
export type ContentBlockDelta = TextDelta | ToolUseInputDelta | ReasoningContentDelta

/**
 * Text delta within a content block.
 * Represents incremental text content from the model.
 */
export interface TextDelta {
  /**
   * Discriminator for text delta.
   */
  type: 'textDelta'

  /**
   * Incremental text content.
   */
  text: string
}

/**
 * Tool use input delta within a content block.
 * Represents incremental tool input being generated.
 */
export interface ToolUseInputDelta {
  /**
   * Discriminator for tool use input delta.
   */
  type: 'toolUseInputDelta'

  /**
   * Partial JSON string representing the tool input.
   */
  input: string
}

/**
 * Reasoning content delta within a content block.
 * Represents incremental reasoning or thinking content.
 */
export interface ReasoningContentDelta {
  /**
   * Discriminator for reasoning delta.
   */
  type: 'reasoningContentDelta'

  /**
   * Incremental reasoning text.
   */
  text?: string

  /**
   * Incremental signature data.
   */
  signature?: string

  /**
   * Incremental redacted content data.
   */
  redactedContent?: Uint8Array
}

/**
 * Token usage statistics for a model invocation.
 * Tracks input, output, and total tokens, plus cache-related metrics.
 */
export interface Usage {
  /**
   * Number of tokens in the input (prompt).
   */
  inputTokens: number

  /**
   * Number of tokens in the output (completion).
   */
  outputTokens: number

  /**
   * Total number of tokens (input + output).
   */
  totalTokens: number

  /**
   * Number of input tokens read from cache.
   * This can reduce latency and cost.
   */
  cacheReadInputTokens?: number

  /**
   * Number of input tokens written to cache.
   * These tokens can be reused in future requests.
   */
  cacheWriteInputTokens?: number
}

/**
 * Performance metrics for a model invocation.
 */
export interface Metrics {
  /**
   * Latency in milliseconds.
   */
  latencyMs: number
}
