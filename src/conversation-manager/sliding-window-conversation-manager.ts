/**
 * Sliding window conversation history management.
 *
 * This module provides a sliding window strategy for managing conversation history
 * that preserves tool usage pairs and avoids invalid window states.
 */

import { Message, TextBlock, ToolResultBlock } from '../types/messages.js'
import type { LocalAgent } from '../types/agent.js'
import { AfterInvocationEvent } from '../hooks/events.js'
import { ConversationManager, type ConversationManagerReduceOptions } from './conversation-manager.js'
import { logger } from '../logging/logger.js'

/**
 * Configuration for the sliding window conversation manager.
 */
export type SlidingWindowConversationManagerConfig = {
  /**
   * Maximum number of messages to keep in the conversation history.
   * Defaults to 40 messages.
   */
  windowSize?: number

  /**
   * Whether to truncate tool results when a message is too large for the model's context window.
   * Defaults to true.
   */
  shouldTruncateResults?: boolean
}

/**
 * Implements a sliding window strategy for managing conversation history.
 *
 * This class handles the logic of maintaining a conversation window that preserves
 * tool usage pairs and avoids invalid window states. When the message count exceeds
 * the window size, it will either truncate large tool results or remove the oldest
 * messages while ensuring tool use/result pairs remain valid.
 *
 * Registers hooks for:
 * - AfterInvocationEvent: Applies sliding window management after each invocation
 * - AfterModelCallEvent: Reduces context on overflow errors and requests retry (via super)
 */
export class SlidingWindowConversationManager extends ConversationManager {
  private readonly _windowSize: number
  private readonly _shouldTruncateResults: boolean

  /**
   * Unique identifier for this conversation manager.
   */
  readonly name = 'strands:sliding-window-conversation-manager'

  /**
   * Initialize the sliding window conversation manager.
   *
   * @param config - Configuration options for the sliding window manager.
   */
  constructor(config?: SlidingWindowConversationManagerConfig) {
    super()
    this._windowSize = config?.windowSize ?? 40
    this._shouldTruncateResults = config?.shouldTruncateResults ?? true
  }

  /**
   * Initialize the plugin by registering hooks with the agent.
   *
   * Registers:
   * - AfterInvocationEvent callback to apply sliding window management
   * - AfterModelCallEvent callback to handle context overflow and request retry (via super)
   *
   * @param agent - The agent to register hooks with
   */
  public override initAgent(agent: LocalAgent): void {
    super.initAgent(agent)

    agent.addHook(AfterInvocationEvent, (event) => {
      this._applyManagement(event.agent.messages)
    })
  }

  /**
   * Reduce the conversation history in response to a context overflow.
   *
   * Attempts to truncate large tool results first before falling back to message trimming.
   *
   * @param options - The reduction options
   * @returns `true` if the history was reduced, `false` otherwise
   */
  reduce({ agent, error }: ConversationManagerReduceOptions): boolean {
    return this._reduceContext(agent.messages, error)
  }

  /**
   * Apply the sliding window to the messages array to maintain a manageable history size.
   *
   * Called after every agent invocation. No-op if within the window size.
   *
   * @param messages - The message array to manage. Modified in-place.
   */
  private _applyManagement(messages: Message[]): void {
    if (messages.length <= this._windowSize) {
      return
    }

    this._reduceContext(messages, undefined)
  }

  /**
   * Trim the oldest messages to reduce the conversation context size.
   *
   * The method handles special cases where trimming the messages leads to:
   * - toolResult with no corresponding toolUse
   * - toolUse with no corresponding toolResult
   *
   * The strategy is:
   * 1. First, attempt to truncate large tool results if shouldTruncateResults is true
   * 2. If truncation is not possible or doesn't help, trim oldest messages
   * 3. When trimming, skip invalid trim points (toolResult at start, or toolUse without following toolResult)
   *
   * @param messages - The message array to reduce. Modified in-place.
   * @param _error - The error that triggered the context reduction, if any.
   * @returns `true` if any reduction occurred, `false` otherwise.
   */
  private _reduceContext(messages: Message[], _error?: Error): boolean {
    // Only truncate tool results when handling a context overflow error, not for window size enforcement
    const lastMessageIdxWithToolResults = this._findLastMessageWithToolResults(messages)
    if (_error && lastMessageIdxWithToolResults !== undefined && this._shouldTruncateResults) {
      const resultsTruncated = this._truncateToolResults(messages, lastMessageIdxWithToolResults)
      if (resultsTruncated) {
        return true
      }
    }

    // Try to trim messages when tool result cannot be truncated anymore
    // If the number of messages is less than the window_size, then we default to 2, otherwise, trim to window size
    let trimIndex = messages.length <= this._windowSize ? 2 : messages.length - this._windowSize

    // Find the next valid trim_index
    while (trimIndex < messages.length) {
      const oldestMessage = messages[trimIndex]
      if (!oldestMessage) {
        break
      }

      // Check if oldest message would be a toolResult (invalid - needs preceding toolUse)
      const hasToolResult = oldestMessage.content.some((block) => block.type === 'toolResultBlock')
      if (hasToolResult) {
        trimIndex++
        continue
      }

      // Check if oldest message would be a toolUse without immediately following toolResult
      const hasToolUse = oldestMessage.content.some((block) => block.type === 'toolUseBlock')
      if (hasToolUse) {
        // Check if next message has toolResult
        const nextMessage = messages[trimIndex + 1]
        const nextHasToolResult = nextMessage && nextMessage.content.some((block) => block.type === 'toolResultBlock')

        if (!nextHasToolResult) {
          // toolUse without following toolResult - invalid trim point
          trimIndex++
          continue
        }
      }

      // Valid trim point found
      break
    }

    // If no valid trim point was found, return false and let the caller handle it.
    // When windowSize is 0, trimIndex === messages.length is expected (remove all), so allow it through.
    if (trimIndex > messages.length || (trimIndex === messages.length && this._windowSize > 0)) {
      logger.warn(
        `window_size=<${this._windowSize}>, messages=<${messages.length}> | unable to trim conversation context, no valid trim point found`
      )
      return false
    }

    // trimIndex is guaranteed to be < messages.length here, so splice always removes at least one message
    messages.splice(0, trimIndex)
    return true
  }

  /**
   * Truncate tool results in a message to reduce context size.
   *
   * When a message contains tool results that are too large for the model's context window,
   * this function replaces the content of those tool results with a simple error message.
   *
   * @param messages - The conversation message history.
   * @param msgIdx - Index of the message containing tool results to truncate.
   * @returns True if any changes were made to the message, false otherwise.
   */
  private _truncateToolResults(messages: Message[], msgIdx: number): boolean {
    if (msgIdx >= messages.length || msgIdx < 0) {
      return false
    }

    const message = messages[msgIdx]
    if (!message) {
      return false
    }

    const toolResultTooLargeMessage = 'The tool result was too large!'
    let foundToolResultToTruncate = false

    // First, check if there's a tool result that needs truncation
    for (const block of message.content) {
      if (block.type === 'toolResultBlock') {
        const toolResultBlock = block as ToolResultBlock

        // Check if already truncated
        const firstContent = toolResultBlock.content[0]
        const contentText = firstContent && firstContent.type === 'textBlock' ? firstContent.text : ''

        if (toolResultBlock.status === 'error' && contentText === toolResultTooLargeMessage) {
          return false
        }

        foundToolResultToTruncate = true
        break
      }
    }

    if (!foundToolResultToTruncate) {
      return false
    }

    // Create new content array with truncated tool results
    const newContent = message.content.map((block) => {
      if (block.type === 'toolResultBlock') {
        const toolResultBlock = block as ToolResultBlock
        // Create new ToolResultBlock with truncated content
        return new ToolResultBlock({
          toolUseId: toolResultBlock.toolUseId,
          status: 'error',
          content: [new TextBlock(toolResultTooLargeMessage)],
        })
      }
      return block
    })

    // Replace the message in the array with a new message containing the modified content
    messages[msgIdx] = new Message({
      role: message.role,
      content: newContent,
    })

    return true
  }

  /**
   * Find the index of the last message containing tool results.
   *
   * This is useful for identifying messages that might need to be truncated to reduce context size.
   *
   * @param messages - The conversation message history.
   * @returns Index of the last message with tool results, or undefined if no such message exists.
   */
  private _findLastMessageWithToolResults(messages: Message[]): number | undefined {
    // Iterate backwards through all messages (from newest to oldest)
    for (let idx = messages.length - 1; idx >= 0; idx--) {
      const currentMessage = messages[idx]!

      const hasToolResult = currentMessage.content.some((block) => block.type === 'toolResultBlock')

      if (hasToolResult) {
        return idx
      }
    }

    return undefined
  }
}
