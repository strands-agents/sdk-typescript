/**
 * Sliding window conversation history management.
 *
 * This module provides a sliding window strategy for managing conversation history
 * that preserves tool usage pairs and avoids invalid window states.
 */

import { ContextWindowOverflowError } from '../errors.js'
import { Message, TextBlock, ToolResultBlock } from '../types/messages.js'
import type { HookProvider } from '../hooks/types.js'
import type { HookRegistry } from '../hooks/registry.js'
import { AfterInvocationEvent, AfterModelCallEvent } from '../hooks/events.js'

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
 * As a HookProvider, it registers callbacks for:
 * - AfterInvocationEvent: Applies sliding window management after each invocation
 * - AfterModelCallEvent: Reduces context on overflow errors and requests retry
 */
export class SlidingWindowConversationManager implements HookProvider {
  private readonly _windowSize: number
  private readonly _shouldTruncateResults: boolean

  /**
   * Initialize the sliding window conversation manager.
   *
   * @param config - Configuration options for the sliding window manager.
   */
  constructor(config?: SlidingWindowConversationManagerConfig) {
    this._windowSize = config?.windowSize ?? 40
    this._shouldTruncateResults = config?.shouldTruncateResults ?? true
  }

  /**
   * Registers callbacks with the hook registry.
   *
   * Registers:
   * - AfterInvocationEvent callback to apply sliding window management
   * - AfterModelCallEvent callback to handle context overflow and request retry
   *
   * @param registry - The hook registry to register callbacks with
   */
  public registerCallbacks(registry: HookRegistry): void {
    // Apply sliding window management after each invocation
    registry.addCallback(AfterInvocationEvent, (event) => {
      this.applyManagement(event.agent.messages)
    })

    // Handle context overflow errors
    registry.addCallback(AfterModelCallEvent, (event) => {
      if (event.error instanceof ContextWindowOverflowError) {
        this.reduceContext(event.agent.messages, event.error)
        event.retry = true
      }
    })
  }

  /**
   * Apply the sliding window to the messages array to maintain a manageable history size.
   *
   * This method is called after every event loop cycle to apply a sliding window if the message
   * count exceeds the window size. If the number of messages is within the window size, no action
   * is taken.
   *
   * @param messages - The message array to manage. Modified in-place.
   */
  private applyManagement(messages: Message[]): void {
    if (messages.length <= this._windowSize) {
      return
    }

    this.reduceContext(messages)
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
   *
   * @throws ContextWindowOverflowError If the context cannot be reduced further,
   *         such as when the conversation is already minimal or when no valid trim point exists.
   */
  private reduceContext(messages: Message[], _error?: Error): void {
    // Only truncate tool results when handling a context overflow error, not for window size enforcement
    const lastMessageIdxWithToolResults = this.findLastMessageWithToolResults(messages)
    if (_error && lastMessageIdxWithToolResults !== undefined && this._shouldTruncateResults) {
      const resultsTruncated = this.truncateToolResults(messages, lastMessageIdxWithToolResults)
      if (resultsTruncated) {
        return
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

    // If we didn't find a valid trim_index, then we throw
    if (trimIndex >= messages.length) {
      throw new ContextWindowOverflowError('Unable to trim conversation context!')
    }

    // Overwrite message history
    messages.splice(0, trimIndex)
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
  private truncateToolResults(messages: Message[], msgIdx: number): boolean {
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
  private findLastMessageWithToolResults(messages: Message[]): number | undefined {
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
