import type { Role, StopReason } from '../types/messages.js'
import type { JSONValue } from '../types/json.js'

/**
 * ModelStreamEvent types for Model interactions.
 *
 * This module follows a pattern where <name>Data interfaces define the structure
 * for objects, while corresponding classes extend those interfaces with additional
 * functionality and type discrimination.
 */

/**
 * Union type representing all possible streaming events from a model provider.
 * This is a discriminated union where each event has a unique type field.
 *
 * This allows for type-safe event handling using switch statements.
 */
export type ModelStreamEvent =
  | ModelMessageStartEventData
  | ModelContentBlockStartEventData
  | ModelContentBlockDeltaEventData
  | ModelContentBlockStopEventData
  | ModelMessageStopEventData
  | ModelMetadataEventData

/**
 * Data for a message start event.
 */
export interface ModelMessageStartEventData {
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
 * Event emitted when a new message starts in the stream.
 */
export class ModelMessageStartEvent implements ModelMessageStartEventData {
  /**
   * Discriminator for message start events.
   */
  readonly type = 'modelMessageStartEvent' as const

  /**
   * The role of the message being started.
   */
  readonly role: Role

  constructor(data: ModelMessageStartEventData) {
    this.role = data.role
  }
}

/**
 * Data for a content block start event.
 */
export interface ModelContentBlockStartEventData {
  /**
   * Discriminator for content block start events.
   */
  type: 'modelContentBlockStartEvent'

  /**
   * Information about the content block being started.
   * Only present for tool use blocks.
   */
  start?: ContentBlockStart
}

/**
 * Event emitted when a new content block starts in the stream.
 */
export class ModelContentBlockStartEvent implements ModelContentBlockStartEventData {
  /**
   * Discriminator for content block start events.
   */
  readonly type = 'modelContentBlockStartEvent' as const

  /**
   * Information about the content block being started.
   * Only present for tool use blocks.
   */
  readonly start?: ContentBlockStart

  constructor(data: ModelContentBlockStartEventData) {
    if (data.start !== undefined) {
      this.start = data.start
    }
  }
}

/**
 * Data for a content block delta event.
 */
export interface ModelContentBlockDeltaEventData {
  /**
   * Discriminator for content block delta events.
   */
  type: 'modelContentBlockDeltaEvent'

  /**
   * The incremental content update.
   */
  delta: ContentBlockDelta
}

/**
 * Event emitted when there is new content in a content block.
 */
export class ModelContentBlockDeltaEvent implements ModelContentBlockDeltaEventData {
  /**
   * Discriminator for content block delta events.
   */
  readonly type = 'modelContentBlockDeltaEvent' as const

  /**
   * Index of the content block being updated.
   */
  readonly contentBlockIndex?: number

  /**
   * The incremental content update.
   */
  readonly delta: ContentBlockDelta

  constructor(data: ModelContentBlockDeltaEventData) {
    this.delta = data.delta
  }
}

/**
 * Data for a content block stop event.
 */
export interface ModelContentBlockStopEventData {
  /**
   * Discriminator for content block stop events.
   */
  type: 'modelContentBlockStopEvent'
}

/**
 * Event emitted when a content block completes.
 */
export class ModelContentBlockStopEvent implements ModelContentBlockStopEventData {
  /**
   * Discriminator for content block stop events.
   */
  readonly type = 'modelContentBlockStopEvent' as const

  constructor(_data: ModelContentBlockStopEventData) {}
}

/**
 * Data for a message stop event.
 */
export interface ModelMessageStopEventData {
  /**
   * Discriminator for message stop events.
   */
  type: 'modelMessageStopEvent'

  /**
   * Reason why generation stopped.
   */
  stopReason: StopReason

  /**
   * Additional provider-specific response fields.
   */
  additionalModelResponseFields?: JSONValue
}

/**
 * Event emitted when the message completes.
 */
export class ModelMessageStopEvent implements ModelMessageStopEventData {
  /**
   * Discriminator for message stop events.
   */
  readonly type = 'modelMessageStopEvent' as const

  /**
   * Reason why generation stopped.
   */
  readonly stopReason: StopReason

  /**
   * Additional provider-specific response fields.
   */
  readonly additionalModelResponseFields?: JSONValue

  constructor(data: ModelMessageStopEventData) {
    this.stopReason = data.stopReason
    if (data.additionalModelResponseFields !== undefined) {
      this.additionalModelResponseFields = data.additionalModelResponseFields
    }
  }
}

/**
 * Data for a metadata event.
 */
export interface ModelMetadataEventData {
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
 * Event containing metadata about the stream.
 * Includes usage statistics, performance metrics, and trace information.
 */
export class ModelMetadataEvent implements ModelMetadataEventData {
  /**
   * Discriminator for metadata events.
   */
  readonly type = 'modelMetadataEvent' as const

  /**
   * Token usage information.
   */
  readonly usage?: Usage

  /**
   * Performance metrics.
   */
  readonly metrics?: Metrics

  /**
   * Trace information for observability.
   */
  readonly trace?: unknown

  constructor(data: ModelMetadataEventData) {
    if (data.usage !== undefined) {
      this.usage = data.usage
    }
    if (data.metrics !== undefined) {
      this.metrics = data.metrics
    }
    if (data.trace !== undefined) {
      this.trace = data.trace
    }
  }
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

  /**
   * Reasoning signature from thinking models (e.g., Gemini).
   * Must be preserved and sent back to the model for multi-turn tool use.
   */
  reasoningSignature?: string
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
