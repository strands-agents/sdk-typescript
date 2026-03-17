/**
 * Abstract base class for conversation history management.
 *
 * This module defines the ConversationManager abstraction, which provides a
 * domain-specific interface for managing an agent's conversation context.
 */

import type { Plugin } from '../plugins/plugin.js'
import type { LocalAgent } from '../types/agent.js'
import { AfterModelCallEvent } from '../hooks/events.js'
import { ContextWindowOverflowError } from '../errors.js'

/**
 * Options passed to {@link ConversationManager.reduce}.
 */
export type ConversationManagerReduceOptions = {
  /**
   * The agent instance. Mutate `agent.messages` in place to reduce history.
   */
  agent: LocalAgent

  /**
   * The {@link ContextWindowOverflowError} that triggered this call.
   * `reduce` MUST remove enough history for the next model call to succeed,
   * or this error will propagate out of the agent loop uncaught.
   */
  error: ContextWindowOverflowError
}

/**
 * Abstract base class for conversation history management strategies.
 *
 * The primary responsibility of a ConversationManager is overflow recovery: when the
 * model returns a {@link ContextWindowOverflowError}, {@link ConversationManager.reduce}
 * is called and MUST reduce the history enough for the next model call to succeed.
 * If `reduce` returns `false` (no reduction performed), the error propagates out of
 * the agent loop uncaught. This makes `reduce` a critical operation — implementations
 * must be able to make meaningful progress when called with `error` set.
 *
 * Optionally, a manager can also do proactive management (e.g. trimming after every
 * invocation to stay within a window) by overriding `initAgent`, calling
 * `super.initAgent(agent)` to preserve overflow recovery, then registering additional hooks.
 *
 * @example
 * ```typescript
 * class Last10MessagesManager extends ConversationManager {
 *   readonly name = 'my:last-10-messages'
 *
 *   reduce({ agent }: ReduceOptions): boolean {
 *     if (agent.messages.length <= 10) return false
 *     agent.messages.splice(0, agent.messages.length - 10)
 *     return true
 *   }
 * }
 * ```
 */
export abstract class ConversationManager implements Plugin {
  /**
   * A stable string identifier for this conversation manager.
   */
  abstract readonly name: string

  /**
   * Reduce the conversation history.
   *
   * Called automatically when a {@link ContextWindowOverflowError} occurs (with `error` set).
   *
   * This is a critical call: the implementation MUST remove enough history for the next model call to succeed.
   * Returning `false` means no reduction was possible, and the {@link ContextWindowOverflowError} will
   * propagate out of the agent loop.
   *
   * Implementations should mutate `agent.messages` in place and return `true` if any reduction
   * was performed, `false` otherwise.
   *
   * @param options - The reduction options
   * @returns `true` if the history was reduced, `false` otherwise
   */
  abstract reduce(options: ConversationManagerReduceOptions): boolean

  /**
   * Initialize the conversation manager with the agent instance.
   *
   * Registers overflow recovery: when a {@link ContextWindowOverflowError} occurs,
   * calls {@link ConversationManager.reduce} and retries the model call if reduction succeeded.
   * If `reduce` returns `false`, the error propagates out of the agent loop uncaught.
   *
   * Subclasses that need proactive management MUST call `super.initAgent(agent)` to
   * preserve this overflow recovery behavior.
   *
   * @param agent - The agent to register hooks with
   */
  initAgent(agent: LocalAgent): void {
    agent.addHook(AfterModelCallEvent, (event) => {
      if (event.error instanceof ContextWindowOverflowError) {
        if (this.reduce({ agent: event.agent, error: event.error })) {
          event.retry = true
        }
      }
    })
  }
}
