import type { Role, StopReason } from '../types/messages'
import type { JSONValue } from '../types/json'

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
 * Data interface for message start events without the type discriminator.
 */
export interface ModelMessageStartEventData {
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

  /**
   * Creates a new ModelMessageStartEvent.
   *
   * @param data - The event data
   */
  constructor(data: ModelMessageStartEventData) {
    this.role = data.role
  }

  /**
   * Converts the event to a plain object for serialization.
   *
   * @returns Plain object representation
   */
  toJSON(): object {
    return {
      type: this.type,
      role: this.role,
    }
  }
}

/**
 * Data interface for content block start events without the type discriminator.
 */
export interface ModelContentBlockStartEventData {
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
 * Event emitted when a new content block starts in the stream.
 */
export class ModelContentBlockStartEvent implements ModelContentBlockStartEventData {
  /**
   * Discriminator for content block start events.
   */
  readonly type = 'modelContentBlockStartEvent' as const

  /**
   * Index of this content block within the message.
   */
  readonly contentBlockIndex?: number

  /**
   * Information about the content block being started.
   * Only present for tool use blocks.
   */
  readonly start?: ContentBlockStart

  /**
   * Creates a new ModelContentBlockStartEvent.
   *
   * @param data - The event data
   */
  constructor(data: ModelContentBlockStartEventData) {
    if (data.contentBlockIndex !== undefined) {
      this.contentBlockIndex = data.contentBlockIndex
    }
    if (data.start !== undefined) {
      this.start = data.start
    }
  }

  /**
   * Converts the event to a plain object for serialization.
   *
   * @returns Plain object representation
   */
  toJSON(): object {
    const result: Record<string, unknown> = {
      type: this.type,
    }
    if (this.contentBlockIndex !== undefined) {
      result.contentBlockIndex = this.contentBlockIndex
    }
    if (this.start !== undefined) {
      result.start = this.start && typeof this.start === 'object' && 'toJSON' in this.start ? this.start.toJSON() : this.start
    }
    return result
  }
}

/**
 * Data interface for content block delta events without the type discriminator.
 */
export interface ModelContentBlockDeltaEventData {
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

  /**
   * Creates a new ModelContentBlockDeltaEvent.
   *
   * @param data - The event data
   */
  constructor(data: ModelContentBlockDeltaEventData) {
    if (data.contentBlockIndex !== undefined) {
      this.contentBlockIndex = data.contentBlockIndex
    }
    this.delta = data.delta
  }

  /**
   * Converts the event to a plain object for serialization.
   *
   * @returns Plain object representation
   */
  toJSON(): object {
    const result: Record<string, unknown> = {
      type: this.type,
      delta: this.delta && typeof this.delta === 'object' && 'toJSON' in this.delta ? this.delta.toJSON() : this.delta,
    }
    if (this.contentBlockIndex !== undefined) {
      result.contentBlockIndex = this.contentBlockIndex
    }
    return result
  }
}

/**
 * Data interface for content block stop events without the type discriminator.
 */
export interface ModelContentBlockStopEventData {
  /**
   * Index of the content block that stopped.
   */
  contentBlockIndex?: number
}

/**
 * Event emitted when a content block completes.
 */
export class ModelContentBlockStopEvent implements ModelContentBlockStopEventData {
  /**
   * Discriminator for content block stop events.
   */
  readonly type = 'modelContentBlockStopEvent' as const

  /**
   * Index of the content block that stopped.
   */
  readonly contentBlockIndex?: number

  /**
   * Creates a new ModelContentBlockStopEvent.
   *
   * @param data - The event data
   */
  constructor(data: ModelContentBlockStopEventData) {
    if (data.contentBlockIndex !== undefined) {
      this.contentBlockIndex = data.contentBlockIndex
    }
  }

  /**
   * Converts the event to a plain object for serialization.
   *
   * @returns Plain object representation
   */
  toJSON(): object {
    const result: Record<string, unknown> = {
      type: this.type,
    }
    if (this.contentBlockIndex !== undefined) {
      result.contentBlockIndex = this.contentBlockIndex
    }
    return result
  }
}

/**
 * Data interface for message stop events without the type discriminator.
 */
export interface ModelMessageStopEventData {
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
  readonly stopReason?: StopReason

  /**
   * Additional provider-specific response fields.
   */
  readonly additionalModelResponseFields?: JSONValue

  /**
   * Creates a new ModelMessageStopEvent.
   *
   * @param data - The event data
   */
  constructor(data: ModelMessageStopEventData) {
    if (data.stopReason !== undefined) {
      this.stopReason = data.stopReason
    }
    if (data.additionalModelResponseFields !== undefined) {
      this.additionalModelResponseFields = data.additionalModelResponseFields
    }
  }

  /**
   * Converts the event to a plain object for serialization.
   *
   * @returns Plain object representation
   */
  toJSON(): object {
    const result: Record<string, unknown> = {
      type: this.type,
    }
    if (this.stopReason !== undefined) {
      result.stopReason = this.stopReason
    }
    if (this.additionalModelResponseFields !== undefined) {
      result.additionalModelResponseFields = this.additionalModelResponseFields
    }
    return result
  }
}

/**
 * Data interface for metadata events without the type discriminator.
 */
export interface ModelMetadataEventData {
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

  /**
   * Creates a new ModelMetadataEvent.
   *
   * @param data - The event data
   */
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

  /**
   * Converts the event to a plain object for serialization.
   *
   * @returns Plain object representation
   */
  toJSON(): object {
    const result: Record<string, unknown> = {
      type: this.type,
    }
    if (this.usage !== undefined) {
      result.usage = this.usage
    }
    if (this.metrics !== undefined) {
      result.metrics = this.metrics
    }
    if (this.trace !== undefined) {
      result.trace = this.trace
    }
    return result
  }
}

/**
 * Information about a content block that is starting.
 * Currently only represents tool use starts.
 */
export type ContentBlockStart = ToolUseStart

/**
 * Data interface for tool use start without the type discriminator.
 */
export interface ToolUseStartData {
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
 * Information about a tool use that is starting.
 */
export class ToolUseStart implements ToolUseStartData {
  /**
   * Discriminator for tool use start.
   */
  readonly type = 'toolUseStart' as const

  /**
   * The name of the tool being used.
   */
  readonly name: string

  /**
   * Unique identifier for this tool use.
   */
  readonly toolUseId: string

  /**
   * Creates a new ToolUseStart.
   *
   * @param data - The tool use start data
   */
  constructor(data: ToolUseStartData) {
    this.name = data.name
    this.toolUseId = data.toolUseId
  }

  /**
   * Converts the tool use start to a plain object for serialization.
   *
   * @returns Plain object representation
   */
  toJSON(): object {
    return {
      type: this.type,
      name: this.name,
      toolUseId: this.toolUseId,
    }
  }
}

/**
 * A delta (incremental chunk) of content within a content block.
 * Can be text, tool use input, or reasoning content.
 *
 * This is a discriminated union for type-safe delta handling.
 */
export type ContentBlockDelta = TextDelta | ToolUseInputDelta | ReasoningContentDelta

/**
 * Data interface for text delta without the type discriminator.
 */
export interface TextDeltaData {
  /**
   * Incremental text content.
   */
  text: string
}

/**
 * Text delta within a content block.
 * Represents incremental text content from the model.
 */
export class TextDelta implements TextDeltaData {
  /**
   * Discriminator for text delta.
   */
  readonly type = 'textDelta' as const

  /**
   * Incremental text content.
   */
  readonly text: string

  /**
   * Creates a new TextDelta.
   *
   * @param data - The text delta data
   */
  constructor(data: TextDeltaData) {
    this.text = data.text
  }

  /**
   * Converts the text delta to a plain object for serialization.
   *
   * @returns Plain object representation
   */
  toJSON(): object {
    return {
      type: this.type,
      text: this.text,
    }
  }
}

/**
 * Data interface for tool use input delta without the type discriminator.
 */
export interface ToolUseInputDeltaData {
  /**
   * Partial JSON string representing the tool input.
   */
  input: string
}

/**
 * Tool use input delta within a content block.
 * Represents incremental tool input being generated.
 */
export class ToolUseInputDelta implements ToolUseInputDeltaData {
  /**
   * Discriminator for tool use input delta.
   */
  readonly type = 'toolUseInputDelta' as const

  /**
   * Partial JSON string representing the tool input.
   */
  readonly input: string

  /**
   * Creates a new ToolUseInputDelta.
   *
   * @param data - The tool use input delta data
   */
  constructor(data: ToolUseInputDeltaData) {
    this.input = data.input
  }

  /**
   * Converts the tool use input delta to a plain object for serialization.
   *
   * @returns Plain object representation
   */
  toJSON(): object {
    return {
      type: this.type,
      input: this.input,
    }
  }
}

/**
 * Data interface for reasoning content delta without the type discriminator.
 */
export interface ReasoningContentDeltaData {
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
 * Reasoning content delta within a content block.
 * Represents incremental reasoning or thinking content.
 */
export class ReasoningContentDelta implements ReasoningContentDeltaData {
  /**
   * Discriminator for reasoning delta.
   */
  readonly type = 'reasoningContentDelta' as const

  /**
   * Incremental reasoning text.
   */
  readonly text?: string

  /**
   * Incremental signature data.
   */
  readonly signature?: string

  /**
   * Incremental redacted content data.
   */
  readonly redactedContent?: Uint8Array

  /**
   * Creates a new ReasoningContentDelta.
   *
   * @param data - The reasoning content delta data
   */
  constructor(data: ReasoningContentDeltaData) {
    if (data.text !== undefined) {
      this.text = data.text
    }
    if (data.signature !== undefined) {
      this.signature = data.signature
    }
    if (data.redactedContent !== undefined) {
      this.redactedContent = data.redactedContent
    }
  }

  /**
   * Converts the reasoning content delta to a plain object for serialization.
   *
   * @returns Plain object representation
   */
  toJSON(): object {
    const result: Record<string, unknown> = {
      type: this.type,
    }
    if (this.text !== undefined) {
      result.text = this.text
    }
    if (this.signature !== undefined) {
      result.signature = this.signature
    }
    if (this.redactedContent !== undefined) {
      result.redactedContent = this.redactedContent
    }
    return result
  }
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
