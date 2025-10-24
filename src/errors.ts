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
 * Error thrown when stream aggregation fails due to malformed events,
 * unexpected stream termination, or invalid event sequences.
 */
export class StreamAggregationError extends Error {
  /**
   * Creates a new StreamAggregationError.
   *
   * @param message - Error message describing the aggregation failure
   */
  constructor(message: string) {
    super(message)
    this.name = 'StreamAggregationError'
  }
}
