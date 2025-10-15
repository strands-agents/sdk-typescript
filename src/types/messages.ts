import type { JSONValue } from '@/types/json'
import type { ToolResultContent } from '@/tools/types'

/**
 * A message in a conversation between user and assistant.
 * Each message has a role (user or assistant) and an array of content blocks.
 *
 * @example
 * ```typescript
 * const userMessage: Message = {
 *   role: 'user',
 *   content: [{ type: 'text', text: 'What is 2 + 2?' }]
 * }
 *
 * const assistantMessage: Message = {
 *   role: 'assistant',
 *   content: [
 *     { type: 'text', text: 'Let me calculate that for you.' },
 *     { type: 'toolUse', name: 'calculator', toolUseId: 'calc-1', input: { a: 2, b: 2 } }
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
 *   type: 'text',
 *   text: 'Hello, world!'
 * }
 *
 * // Tool use content block
 * const toolUseBlock: ContentBlock = {
 *   type: 'toolUse',
 *   name: 'calculator',
 *   toolUseId: 'calc-1',
 *   input: { a: 1, b: 2 }
 * }
 *
 * // Tool result content block
 * const toolResultBlock: ContentBlock = {
 *   type: 'toolResult',
 *   toolUseId: 'calc-1',
 *   status: 'success',
 *   content: [{ type: 'text', text: 'Result: 3' }]
 * }
 *
 * // Reasoning content block
 * const reasoningBlock: ContentBlock = {
 *   type: 'reasoning',
 *   text: 'Analyzing the problem...'
 * }
 *
 * // Type-safe handling
 * function handleBlock(block: ContentBlock) {
 *   switch (block.type) {
 *     case 'text':
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
  type: 'text'

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
  type: 'toolUse'

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
  type: 'toolResult'

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
  type: 'reasoning'

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
