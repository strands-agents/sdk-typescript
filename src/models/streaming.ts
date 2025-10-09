import type { Role, StopReason } from '@/types/messages'
import type { JSONValue } from '@/types/json'

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

/**
 * Event emitted when a new message starts in the stream.
 */
/**
 * Event emitted when a new message starts in the stream.
 */
export interface MessageStartEvent {
  /**
   * Discriminator for message start events.
   */
  type: 'messageStart'

  /**
   * The role of the message being started.
   */
  role: Role
}

/**
 * Information about a tool use that is starting.
 */
export interface ToolUseStart {
  /**
   * Discriminator for tool use start.
   */
  type: 'tool_use'

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
 * Information about other content blocks starting (e.g., text, reasoning).
 */
export interface GenericBlockStart {
  /**
   * Discriminator for generic content block start.
   */
  type: 'text' | 'reasoning'
}

/**
 * Information about a content block that is starting.
 * Can represent the start of a tool use or other content types.
 */
export type ContentBlockStart = ToolUseStart | GenericBlockStart

/**
 * Event emitted when a new content block starts in the stream.
 */
export interface ContentBlockStartEvent {
  /**
   * Discriminator for content block start events.
   */
  type: 'contentBlockStart'

  /**
   * Index of this content block within the message.
   */
  contentBlockIndex?: number

  /**
   * Information about the content block being started.
   */
  start?: ContentBlockStart
}

/**
 * Text delta within a content block.
 * Represents incremental text content from the model.
 */
export interface TextDelta {
  /**
   * Discriminator for text delta.
   */
  type: 'text'

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
  type: 'tool_use'

  /**
   * Partial JSON string representing the tool input.
   */
  input: string
}

/**
 * Reasoning content delta within a content block.
 * Represents incremental reasoning or thinking content.
 */
export interface ReasoningDelta {
  /**
   * Discriminator for reasoning delta.
   */
  type: 'reasoning'

  /**
   * Incremental reasoning text.
   */
  text?: string

  /**
   * Incremental signature data.
   */
  signature?: string
}

/**
 * A delta (incremental chunk) of content within a content block.
 * Can be text, tool use input, or reasoning content.
 *
 * This is a discriminated union following AWS Bedrock ContentBlockDelta specification.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ContentBlockDelta.html
 *
 * @example
 * ```typescript
 * // Text delta
 * const textDelta: ContentBlockDelta = {
 *   type: 'text',
 *   text: 'Hello, '
 * }
 *
 * // Tool use input delta
 * const toolDelta: ContentBlockDelta = {
 *   type: 'tool_use',
 *   input: '{"operation":'
 * }
 *
 * // Reasoning delta
 * const reasoningDelta: ContentBlockDelta = {
 *   type: 'reasoning',
 *   text: 'Let me think...'
 * }
 *
 * // Type-safe handling
 * function handleDelta(delta: ContentBlockDelta) {
 *   switch (delta.type) {
 *     case 'text':
 *       console.log(delta.text)
 *       break
 *     case 'tool_use':
 *       console.log(delta.input)
 *       break
 *     case 'reasoning':
 *       console.log(delta.text)
 *       break
 *   }
 * }
 * ```
 */
export type ContentBlockDelta = TextDelta | ToolUseInputDelta | ReasoningDelta

/**
 * Event emitted when there is new content in a content block.
 */
export interface ContentBlockDeltaEvent {
  /**
   * Discriminator for content block delta events.
   */
  type: 'contentBlockDelta'

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
export interface ContentBlockStopEvent {
  /**
   * Discriminator for content block stop events.
   */
  type: 'contentBlockStop'

  /**
   * Index of the content block that stopped.
   */
  contentBlockIndex?: number
}

/**
 * Event emitted when the message completes.
 */
export interface MessageStopEvent {
  /**
   * Discriminator for message stop events.
   */
  type: 'messageStop'

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
export interface MetadataEvent {
  /**
   * Discriminator for metadata events.
   */
  type: 'metadata'

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
 * Union type representing all possible streaming events from a model provider.
 * This is a discriminated union where each event has a unique type field.
 *
 * This allows for type-safe event handling using switch statements:
 *
 * @example
 * ```typescript
 * for await (const event of stream) {
 *   switch (event.type) {
 *     case 'messageStart':
 *       console.log('Message started:', event.role)
 *       break
 *     case 'contentBlockDelta':
 *       if (event.delta.type === 'text') {
 *         console.log('Content delta:', event.delta.text)
 *       }
 *       break
 *     case 'messageStop':
 *       console.log('Message stopped:', event.stopReason)
 *       break
 *   }
 * }
 * ```
 */
export type ModelProviderStreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageStopEvent
  | MetadataEvent
