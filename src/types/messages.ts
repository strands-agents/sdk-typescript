import type { JSONValue, ToolResultContent } from '@/tools/types'

/**
 * Role of a message in a conversation.
 * Can be either 'user' (human input) or 'assistant' (model response).
 */
export type Role = 'user' | 'assistant'

/**
 * Represents reasoning content that models may include in their responses.
 * This allows models to show their thought process.
 */
export interface ReasoningTextBlock {
  /**
   * The text content of the reasoning process.
   */
  text: string

  /**
   * A cryptographic signature for verification purposes.
   */
  signature?: string
}

/**
 * ToolUse represents a request to execute a tool.
 * This is a forward reference to the ToolUse type defined in tools/types.
 */
export interface ToolUse {
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
 * ToolResult represents the result of a tool execution.
 * This is a forward reference to the ToolResult type defined in tools/types.
 */
export interface ToolResult {
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
 * A block of content within a message.
 * Content blocks can contain text, tool usage requests, tool results, or reasoning content.
 *
 * @example
 * ```typescript
 * // Text content block
 * const textBlock: ContentBlock = { text: 'Hello, world!' }
 *
 * // Tool use content block
 * const toolUseBlock: ContentBlock = {
 *   toolUse: { name: 'calculator', toolUseId: 'calc-1', input: { a: 1, b: 2 } }
 * }
 *
 * // Tool result content block
 * const toolResultBlock: ContentBlock = {
 *   toolResult: {
 *     toolUseId: 'calc-1',
 *     status: 'success',
 *     content: [{ text: 'Result: 3' }]
 *   }
 * }
 *
 * // Reasoning content block
 * const reasoningBlock: ContentBlock = {
 *   reasoningContent: { text: 'Analyzing the problem...' }
 * }
 * ```
 */
export type ContentBlock =
  | {
      /**
       * Plain text content.
       */
      text: string
    }
  | {
      /**
       * A tool usage request from the model.
       */
      toolUse: ToolUse
    }
  | {
      /**
       * The result of a tool execution.
       */
      toolResult: ToolResult
    }
  | {
      /**
       * Reasoning or thinking content from the model.
       */
      reasoningContent: ReasoningTextBlock
    }

/**
 * A message in a conversation between user and assistant.
 * Each message has a role (user or assistant) and an array of content blocks.
 *
 * @example
 * ```typescript
 * const userMessage: Message = {
 *   role: 'user',
 *   content: [{ text: 'What is 2 + 2?' }]
 * }
 *
 * const assistantMessage: Message = {
 *   role: 'assistant',
 *   content: [
 *     { text: 'Let me calculate that for you.' },
 *     { toolUse: { name: 'calculator', toolUseId: 'calc-1', input: { a: 2, b: 2 } } }
 *   ]
 * }
 * ```
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
 * An array of messages representing a conversation.
 *
 * @example
 * ```typescript
 * const conversation: Messages = [
 *   { role: 'user', content: [{ text: 'Hello!' }] },
 *   { role: 'assistant', content: [{ text: 'Hi! How can I help you?' }] }
 * ]
 * ```
 */
export type Messages = Message[]
