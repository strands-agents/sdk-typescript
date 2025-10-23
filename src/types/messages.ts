import type { JSONValue } from './json'
import type { ToolResultContent } from '../tools/types'

/**
 * A message in a conversation between user and assistant.
 * Each message has a role (user or assistant) and an array of content blocks.
 */
export interface Message {
  /**
   * The role of the message sender.
   */
  role: Role

  /**
   * Array of content blocks that make up this message.
   */
  content: ContentBlock[]
}

/**
 * Role of a message in a conversation.
 * Can be either 'user' (human input) or 'assistant' (model response).
 */
export type Role = 'user' | 'assistant'

/**
 * A block of content within a message.
 * Content blocks can contain text, tool usage requests, tool results, or reasoning content.
 *
 * This is a discriminated union where the `type` field determines the content format.
 */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ReasoningBlock

/**
 * Text content block within a message.
 */
export interface TextBlock {
  /**
   * Discriminator for text content.
   */
  type: 'textBlock'

  /**
   * Plain text content.
   */
  text: string
}

/**
 * Tool use content block within a message.
 */
export interface ToolUseBlock {
  /**
   * Discriminator for tool use content.
   */
  type: 'toolUseBlock'

  /**
   * The name of the tool to execute.
   */
  name: string

  /**
   * Unique identifier for this tool use instance.
   */
  toolUseId: string

  /**
   * The input parameters for the tool.
   * This can be any JSON-serializable value.
   */
  input: JSONValue
}

/**
 * Tool result content block within a message.
 */
export interface ToolResultBlock {
  /**
   * Discriminator for tool result content.
   */
  type: 'toolResultBlock'

  /**
   * The ID of the tool use that this result corresponds to.
   */
  toolUseId: string

  /**
   * Status of the tool execution.
   */
  status: 'success' | 'error'

  /**
   * The content returned by the tool.
   */
  content: ToolResultContent[]
}

/**
 * Reasoning content block within a message.
 */
export interface ReasoningBlock {
  /**
   * Discriminator for reasoning content.
   */
  type: 'reasoningBlock'

  /**
   * The text content of the reasoning process.
   */
  text?: string

  /**
   * A cryptographic signature for verification purposes.
   */
  signature?: string

  /**
   * The redacted content of the reasoning process.
   */
  redactedContent?: Uint8Array
}

/**
 * Reason why the model stopped generating content.
 *
 * - `contentFiltered` - Content was filtered by safety mechanisms
 * - `endTurn` - Natural end of the model's turn
 * - `guardrailIntervened` - A guardrail policy stopped generation
 * - `maxTokens` - Maximum token limit was reached
 * - `stopSequence` - A stop sequence was encountered
 * - `toolUse` - Model wants to use a tool
 */
export type StopReason =
  | 'contentFiltered'
  | 'endTurn'
  | 'guardrailIntervened'
  | 'maxTokens'
  | 'stopSequence'
  | 'toolUse'
  | 'modelContextWindowExceeded'
  | string

/**
 * System prompt for guiding model behavior.
 * Can be a simple string or an array of content blocks for advanced caching.
 *
 * @example
 * ```typescript
 * // Simple string
 * const prompt: SystemPrompt = 'You are a helpful assistant'
 *
 * // Array with caching
 * const prompt: SystemPrompt = [
 *   { type: 'text', text: 'You are a helpful assistant' },
 *   { type: 'text', text: largeContextDocument },
 *   { type: 'cachePoint', cacheType: 'default' }
 * ]
 * ```
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_SystemContentBlock.html
 */
export type SystemPrompt = string | SystemContentBlock[]

/**
 * A block of content within a system prompt.
 * Supports text content and cache points for prompt caching.
 *
 * This is a discriminated union where the `type` field determines the block format.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_SystemContentBlock.html
 */
export type SystemContentBlock = SystemTextBlock | SystemCachePointBlock

/**
 * Text content block in a system prompt.
 */
export interface SystemTextBlock {
  /**
   * Discriminator for text content.
   */
  type: 'text'

  /**
   * The text content of the system prompt.
   */
  text: string
}

/**
 * Cache point block in a system prompt.
 * Marks a position in the system prompt where caching should occur.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
 */
export interface SystemCachePointBlock {
  /**
   * Discriminator for cache point.
   */
  type: 'cachePoint'

  /**
   * The cache type (e.g., 'default', 'ephemeral').
   */
  cacheType: string
}
