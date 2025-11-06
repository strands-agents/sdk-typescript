/**
 * Error types for the Strands Agents TypeScript SDK.
 *
 * These error classes represent specific error conditions that can occur
 * during agent execution and model provider interactions.
 */

import type { Message } from './types/messages.js'

/**
 * Error thrown when input exceeds the model's context window.
 *
 * This error indicates that the combined length of the input (prompt, messages,
 * system prompt, and tool definitions) exceeds the maximum context window size
 * supported by the model.
 */
export class ContextWindowOverflowError extends Error {
  /**
   * Creates a new ContextWindowOverflowError.
   *
   * @param message - Error message describing the context overflow
   */
  constructor(message: string) {
    super(message)
    this.name = 'ContextWindowOverflowError'
  }
}

/**
 * Error thrown when the model reaches its maximum token limit during generation.
 *
 * This error indicates that the model stopped generating content because it reached
 * the maximum number of tokens allowed for the response. This is an unrecoverable
 * state that requires intervention, such as reducing the input size or adjusting
 * the max tokens parameter.
 */
export class MaxTokensError extends Error {
  /**
   * The partial assistant message that was generated before hitting the token limit.
   * This can be useful for understanding what the model was trying to generate.
   */
  public readonly partialMessage: Message

  /**
   * Creates a new MaxTokensError.
   *
   * @param message - Error message describing the max tokens condition
   * @param partialMessage - The partial assistant message generated before the limit
   */
  constructor(message: string, partialMessage: Message) {
    super(message)
    this.name = 'MaxTokensError'
    this.partialMessage = partialMessage
  }
}
