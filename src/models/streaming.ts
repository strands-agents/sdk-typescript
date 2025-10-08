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
 * Can represent the start of a tool use.
 */
export type ContentBlockStart =
  | {
      /**
       * Information about a tool use that is starting.
       */
      toolUse: {
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
  | Record<string, never> // Empty object for non-tool-use content blocks

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
 * Can be text, tool use input, or reasoning content.
 */
export type ContentBlockDelta =
  | {
      /**
       * Incremental text content.
       */
      text: string
    }
  | {
      /**
       * Incremental tool use input (as a JSON string chunk).
       */
      toolUse: {
        /**
         * Partial JSON string representing the tool input.
         */
        input: string
      }
    }
  | {
      /**
       * Incremental reasoning content.
       */
      reasoningContent: {
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
 *       if ('text' in event.delta) {
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
  | ({
      type: 'messageStart'
    } & MessageStartEvent)
  | ({
      type: 'contentBlockStart'
    } & ContentBlockStartEvent)
  | ({
      type: 'contentBlockDelta'
    } & ContentBlockDeltaEvent)
  | ({
      type: 'contentBlockStop'
    } & ContentBlockStopEvent)
  | ({
      type: 'messageStop'
    } & MessageStopEvent)
  | ({
      type: 'metadata'
    } & MetadataEvent)
