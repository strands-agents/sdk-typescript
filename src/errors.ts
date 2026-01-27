/**
 * Error types for the Strands Agents TypeScript SDK.
 *
 * These error classes represent specific error conditions that can occur
 * during agent execution and model provider interactions.
 */

import type { Message } from './types/messages.js'

/**
 * Base exception class for all model-related errors.
 *
 * This class serves as the common base type for errors that originate from
 * model provider interactions. By catching ModelError, consumers can handle
 * all model-related errors uniformly while still having access to specific
 * error types through instanceof checks.
 */
export class ModelError extends Error {
  /**
   * Creates a new ModelError.
   *
   * @param message - Error message describing the model error
   * @param options - Optional error options including the cause
   */
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ModelError'
  }
}

/**
 * Error thrown when input exceeds the model's context window.
 *
 * This error indicates that the combined length of the input (prompt, messages,
 * system prompt, and tool definitions) exceeds the maximum context window size
 * supported by the model.
 */
export class ContextWindowOverflowError extends ModelError {
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
export class MaxTokensError extends ModelError {
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

/**
 * Error thrown when attempting to serialize a value that is not JSON-serializable.
 *
 * This error indicates that a value contains non-serializable types such as functions,
 * symbols, or undefined values that cannot be converted to JSON.
 */
export class JsonValidationError extends Error {
  /**
   * Creates a new JsonValidationError.
   *
   * @param message - Error message describing the validation failure
   */
  constructor(message: string) {
    super(message)
    this.name = 'JsonValidationError'
  }
}

/**
 * Error thrown when attempting to invoke an agent that is already processing an invocation.
 *
 * This error indicates that invoke() or stream() was called while the agent is already
 * executing. Agents can only process one invocation at a time to prevent state corruption.
 */
export class ConcurrentInvocationError extends Error {
  /**
   * Creates a new ConcurrentInvocationError.
   *
   * @param message - Error message describing the concurrent invocation attempt
   */
  constructor(message: string) {
    super(message)
    this.name = 'ConcurrentInvocationError'
  }
}

/**
 * Normalizes an unknown error value to an Error instance.
 *
 * This helper ensures that any thrown value (Error, string, number, etc.)
 * is converted to a proper Error object for consistent error handling.
 *
 * @param error - The error value to normalize
 * @returns An Error instance
 */
export function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
