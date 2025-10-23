import type { JSONValue } from './json'
import type { ToolResultContent } from '../tools/types'

/**
 * A message in a conversation between user and assistant.
 * Each message has a role (user or assistant) and an array of content blocks.
 *
 * @example
 * ```typescript
 * const userMessage: Message = {
 *   role: 'user',
 *   content: [{ type: 'textBlock', text: 'What is 2 + 2?' }]
 * }
 *
 * const assistantMessage: Message = {
 *   role: 'assistant',
 *   content: [
 *     { type: 'textBlock', text: 'Let me calculate that for you.' },
 *     { type: 'toolUseBlock', name: 'calculator', toolUseId: 'calc-1', input: { a: 2, b: 2 } }
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
 * Role of a message in a conversation.
 * Can be either 'user' (human input) or 'assistant' (model response).
 */
export type Role = 'user' | 'assistant'

/**
 * A block of content within a message.
 * Content blocks can contain text, tool usage requests, tool results, or reasoning content.
 *
 * This is a discriminated union where the `type` field determines the content format.
 *
 * @example
 * ```typescript
 * // Text content block
 * const textBlock: ContentBlock = {
 *   type: 'textBlock',
 *   text: 'Hello, world!'
 * }
 *
 * // Tool use content block
 * const toolUseBlock: ContentBlock = {
 *   type: 'toolUseBlock',
 *   name: 'calculator',
 *   toolUseId: 'calc-1',
 *   input: { a: 1, b: 2 }
 * }
 *
 * // Tool result content block
 * const toolResultBlock: ContentBlock = {
 *   type: 'toolResultBlock',
 *   toolUseId: 'calc-1',
 *   status: 'success',
 *   content: [{ type: 'textBlock', text: 'Result: 3' }]
 * }
 *
 * // Reasoning content block
 * const reasoningBlock: ContentBlock = {
 *   type: 'reasoningBlock',
 *   text: 'Analyzing the problem...'
 * }
 *
 * // Type-safe handling
 * function handleBlock(block: ContentBlock) {
 *   switch (block.type) {
 *     case 'textBlock':
 *       console.log(block.text)
 *       break
 *     case 'toolUse':
 *       console.log(`Using tool: ${block.name}`)
 *       break
 *     case 'toolResult':
 *       console.log(`Tool result: ${block.status}`)
 *       break
 *     case 'reasoning':
 *       console.log(`Reasoning: ${block.text}`)
 *       break
 *   }
 * }
 * ```
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
