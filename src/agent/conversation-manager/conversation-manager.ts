/**
 * Abstract interface for conversation history management.
 *
 * This module provides the base class for implementing conversation management strategies
 * to control the size of message arrays, helping to manage memory usage, control context
 * length, and maintain relevant conversation state.
 */

import type { Agent } from '../agent.js'

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
   * The number of messages that have been removed from the agent's messages array.
   * These represent messages provided by the user or model that have been removed,
   * not messages included by the conversation manager through something like summarization.
   */
  public removedMessageCount: number

  /**
   * Creates a new ConversationManager instance.
   */
  constructor() {
    this.removedMessageCount = 0
  }

  /**
   * Applies management strategy to the provided agent.
   *
   * Processes the conversation history to maintain appropriate size by modifying
   * the messages list in-place. Implementations should handle message pruning,
   * summarization, or other size management techniques to keep the conversation
   * context within desired bounds.
   *
   * @param agent - The agent whose conversation history will be managed.
   *                This list is modified in-place.
   */
  public abstract applyManagement(agent: Agent): void

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
   * @param agent - The agent whose conversation history will be reduced.
   *                This list is modified in-place.
   * @param error - The error that triggered the context reduction, if any.
   *
   * @throws ContextWindowOverflowError If the context cannot be reduced further,
   *         such as when the conversation is already minimal or when tool result
   *         messages cannot be properly converted.
   */
  public abstract reduceContext(agent: Agent, error?: Error): void
}
