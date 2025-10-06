import type { Role } from '@/types/messages'

/**
 * Reason why the model stopped generating content.
 *
 * - `content_filtered` - Content was filtered by safety mechanisms
 * - `end_turn` - Natural end of the model's turn
 * - `guardrail_intervened` - A guardrail policy stopped generation
 * - `max_tokens` - Maximum token limit was reached
 * - `stop_sequence` - A stop sequence was encountered
 * - `tool_use` - Model wants to use a tool
 */
export type StopReason =
  | 'content_filtered'
  | 'end_turn'
  | 'guardrail_intervened'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'

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
export interface MessageStartEvent {
  /**
   * The role of the message being started.
   */
  role: Role
}

/**
 * Information about a content block that is starting.
 */
export interface ContentBlockStart {
  /**
   * If this content block is a tool use, contains the tool information.
   */
  toolUse?: {
    /**
     * The name of the tool being used.
     */
    name: string

    /**
     * Unique identifier for this tool use.
     */
    toolUseId: string
  }
}

/**
 * Event emitted when a new content block starts in the stream.
 */
export interface ContentBlockStartEvent {
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
 * A delta (incremental chunk) of content within a content block.
 */
export interface ContentBlockDelta {
  /**
   * Incremental text content.
   */
  text?: string

  /**
   * Incremental tool use input (as a JSON string chunk).
   */
  toolUse?: {
    /**
     * Partial JSON string representing the tool input.
     */
    input: string
  }

  /**
   * Incremental reasoning content.
   */
  reasoningContent?: {
    /**
     * Incremental reasoning text.
     */
    text?: string

    /**
     * Incremental signature data.
     */
    signature?: string
  }
}

/**
 * Event emitted when there is new content in a content block.
 */
export interface ContentBlockDeltaEvent {
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
   * Index of the content block that stopped.
   */
  contentBlockIndex?: number
}

/**
 * Event emitted when the message completes.
 */
export interface MessageStopEvent {
  /**
   * Reason why generation stopped.
   */
  stopReason?: StopReason

  /**
   * Additional provider-specific response fields.
   */
  additionalModelResponseFields?: unknown
}

/**
 * Event containing metadata about the stream.
 * Includes usage statistics, performance metrics, and trace information.
 */
export interface MetadataEvent {
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
 * Union type representing all possible streaming events.
 * Each event type is wrapped in an object with a single discriminator property.
 *
 * This allows for type-safe event handling using discriminated unions:
 *
 * @example
 * ```typescript
 * for await (const event of stream) {
 *   if ('messageStart' in event) {
 *     console.log('Message started:', event.messageStart.role)
 *   } else if ('contentBlockDelta' in event) {
 *     console.log('Content delta:', event.contentBlockDelta.delta.text)
 *   } else if ('messageStop' in event) {
 *     console.log('Message stopped:', event.messageStop.stopReason)
 *   }
 * }
 * ```
 */
export type StreamEvent =
  | { messageStart: MessageStartEvent }
  | { contentBlockStart: ContentBlockStartEvent }
  | { contentBlockDelta: ContentBlockDeltaEvent }
  | { contentBlockStop: ContentBlockStopEvent }
  | { messageStop: MessageStopEvent }
  | { metadata: MetadataEvent }
