/**
 * Abstract interface for conversation history management.
 *
 * This module provides the base class for implementing conversation management strategies
 * to control the size of message arrays, helping to manage memory usage, control context
 * length, and maintain relevant conversation state.
 */

import type { Message } from '../types/messages.js'

/**
 * Interface for conversation context that can be managed.
 *
 * This interface defines the minimal set of properties required by conversation managers
 * to perform their operations. Using an interface allows for backwards-compatible
 * API evolution and better decoupling from specific implementations.
 */
export interface ConversationContext {
  /**
   * The conversation history of messages that will be managed.
   * This array is modified in-place by conversation management operations.
   */
  messages: Message[]
}

/**
 * Abstract base class for managing conversation history.
 *
 * This class provides an interface for implementing conversation management strategies
 * to control the size of message arrays/conversation histories, helping to:
 *
 * - Manage memory usage
 * - Control context length
 * - Maintain relevant conversation state
 */
export abstract class ConversationManager {
  /**
   * Creates a new ConversationManager instance.
   */
  constructor() {}

  /**
   * Applies management strategy to the provided conversation context.
   *
   * Processes the conversation history to maintain appropriate size by modifying
   * the messages list in-place. Implementations should handle message pruning,
   * summarization, or other size management techniques to keep the conversation
   * context within desired bounds.
   *
   * @param context - The conversation context whose message history will be managed.
   *                  The messages array is modified in-place.
   */
  public abstract applyManagement(context: ConversationContext): void

  /**
   * Called when the model's context window is exceeded.
   *
   * This method should implement the specific strategy for reducing the window size
   * when a context overflow occurs. It is typically called after a ContextWindowOverflowError
   * is caught during model invocation.
   *
   * Implementations might use strategies such as:
   * - Removing the N oldest messages
   * - Summarizing older context
   * - Applying importance-based filtering
   * - Maintaining critical conversation markers
   *
   * @param context - The conversation context whose message history will be reduced.
   *                  The messages array is modified in-place.
   * @param error - The error that triggered the context reduction, if any.
   *
   * @throws ContextWindowOverflowError If the context cannot be reduced further,
   *         such as when the conversation is already minimal or when tool result
   *         messages cannot be properly converted.
   */
  public abstract reduceContext(context: ConversationContext, error?: Error): void
}
