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
 * Data interface for message start events.
 */
export interface ModelMessageStart {
  /**
   * The role of the message being started.
   */
  role: Role
}

/**
 * Event emitted when a new message starts in the stream.
 */
export class ModelMessageStartEvent implements ModelMessageStart {
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
  constructor({ role }: ModelMessageStart) {
    this.role = role
  }
}

/**
 * Data interface for content block start events.
 */
export interface ModelContentBlockStart {
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
export class ModelContentBlockStartEvent implements ModelContentBlockStart {
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
  constructor({ contentBlockIndex, start }: ModelContentBlockStart) {
    if (contentBlockIndex !== undefined) {
      this.contentBlockIndex = contentBlockIndex
    }
    if (start !== undefined) {
      this.start = start
    }
  }
}

/**
 * Data interface for content block delta events.
 */
export interface ModelContentBlockDelta {
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
export class ModelContentBlockDeltaEvent implements ModelContentBlockDelta {
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
  constructor({ contentBlockIndex, delta }: ModelContentBlockDelta) {
    if (contentBlockIndex !== undefined) {
      this.contentBlockIndex = contentBlockIndex
    }
    this.delta = delta
  }
}

/**
 * Data interface for content block stop events.
 */
export interface ModelContentBlockStop {
  /**
   * Index of the content block that stopped.
   */
  contentBlockIndex?: number
}

/**
 * Event emitted when a content block completes.
 */
export class ModelContentBlockStopEvent implements ModelContentBlockStop {
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
  constructor({ contentBlockIndex }: ModelContentBlockStop) {
    if (contentBlockIndex !== undefined) {
      this.contentBlockIndex = contentBlockIndex
    }
  }
}

/**
 * Data interface for message stop events.
 */
export interface ModelMessageStop {
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
export class ModelMessageStopEvent implements ModelMessageStop {
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
  constructor({ stopReason, additionalModelResponseFields }: ModelMessageStop) {
    if (stopReason !== undefined) {
      this.stopReason = stopReason
    }
    if (additionalModelResponseFields !== undefined) {
      this.additionalModelResponseFields = additionalModelResponseFields
    }
  }
}

/**
 * Data interface for metadata events.
 */
export interface ModelMetadata {
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
export class ModelMetadataEvent implements ModelMetadata {
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
  constructor({ usage, metrics, trace }: ModelMetadata) {
    if (usage !== undefined) {
      this.usage = usage
    }
    if (metrics !== undefined) {
      this.metrics = metrics
    }
    if (trace !== undefined) {
      this.trace = trace
    }
  }
}

/**
 * Information about a content block that is starting.
 * Currently only represents tool use starts.
 */
export type ContentBlockStart = ToolUseStart

/**
 * Data interface for tool use start.
 */
export interface ToolUse {
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
export class ToolUseStart implements ToolUse {
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
  constructor({ name, toolUseId }: ToolUse) {
    this.name = name
    this.toolUseId = toolUseId
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
 * Data interface for text delta.
 */
export interface Text {
  /**
   * Incremental text content.
   */
  text: string
}

/**
 * Text delta within a content block.
 * Represents incremental text content from the model.
 */
export class TextDelta implements Text {
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
  constructor({ text }: Text) {
    this.text = text
  }
}

/**
 * Data interface for tool use input delta.
 */
export interface ToolUseInput {
  /**
   * Partial JSON string representing the tool input.
   */
  input: string
}

/**
 * Tool use input delta within a content block.
 * Represents incremental tool input being generated.
 */
export class ToolUseInputDelta implements ToolUseInput {
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
  constructor({ input }: ToolUseInput) {
    this.input = input
  }
}

/**
 * Data interface for reasoning content delta.
 */
export interface ReasoningContent {
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
export class ReasoningContentDelta implements ReasoningContent {
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
  constructor({ text, signature, redactedContent }: ReasoningContent) {
    if (text !== undefined) {
      this.text = text
    }
    if (signature !== undefined) {
      this.signature = signature
    }
    if (redactedContent !== undefined) {
      this.redactedContent = redactedContent
    }
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
