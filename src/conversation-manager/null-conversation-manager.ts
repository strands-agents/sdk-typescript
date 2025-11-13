/**
 * Null implementation of conversation management.
 *
 * This module provides a no-op conversation manager that does not modify
 * the conversation history, useful for testing and scenarios where conversation
 * management is handled externally.
 */

import { ContextWindowOverflowError } from '../errors.js'
import type { Agent } from '../agent/agent.js'
import { ConversationManager } from './conversation-manager.js'

/**
 * A no-op conversation manager that does not modify the conversation history.
 *
 */
export class NullConversationManager extends ConversationManager {
  /**
   * Does nothing to the conversation history.
   *
   * @param _agent - The agent whose conversation history will remain unmodified.
   */
  public applyManagement(_agent: Agent): void {
    // No-op
  }

  /**
   * Does not reduce context and raises an exception.
   *
   * If an error is provided, re-throws it. Otherwise, throws a new
   * ContextWindowOverflowError indicating that the context window has
   * overflowed and cannot be reduced.
   *
   * @param _agent - The agent whose conversation history will remain unmodified.
   * @param error - The error that triggered the context reduction, if any.
   *
   * @throws Error The provided error if one was given.
   * @throws ContextWindowOverflowError If no error was provided.
   */
  public reduceContext(_agent: Agent, error?: Error): void {
    if (error) {
      throw error
    } else {
      throw new ContextWindowOverflowError('Context window overflowed!')
    }
  }
}
