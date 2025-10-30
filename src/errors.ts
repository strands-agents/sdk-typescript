/**
 * Error types for the Strands Agents TypeScript SDK.
 *
 * These error classes represent specific error conditions that can occur
 * during agent execution and model provider interactions.
 */

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
   * Creates a new MaxTokensError.
   *
   * @param message - Error message describing the max tokens condition
   */
  constructor(message: string) {
    super(message)
    this.name = 'MaxTokensError'
  }
}
