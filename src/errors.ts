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
 *
 * @example
 * ```typescript
 * try {
 *   await provider.stream(veryLongMessages)
 * } catch (error) {
 *   if (error instanceof ContextWindowOverflowError) {
 *     console.log('Input too long, need to reduce context')
 *   }
 * }
 * ```
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

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ContextWindowOverflowError)
    }
  }
}
