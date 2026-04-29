/**
 * Abstract base class for conversation history management.
 *
 * This module defines the ConversationManager abstraction, which provides a
 * domain-specific interface for managing an agent's conversation context.
 */

import type { Plugin } from '../plugins/plugin.js'
import type { LocalAgent } from '../types/agent.js'
import { AfterModelCallEvent, BeforeModelCallEvent } from '../hooks/events.js'
import { ContextWindowOverflowError } from '../errors.js'
import type { Model } from '../models/model.js'
import { logger } from '../logging/logger.js'
import { warnOnce } from '../logging/warn-once.js'

/**
 * Options passed to {@link ConversationManager.reduce}.
 */
export type ConversationManagerReduceOptions = {
  /**
   * The agent instance. Mutate `agent.messages` in place to reduce history.
   */
  agent: LocalAgent

  /**
   * The model instance that triggered the overflow. Used by conversation
   * managers that perform model-based reduction (e.g. summarization).
   */
  model: Model

  /**
   * The {@link ContextWindowOverflowError} that triggered this call.
   * `reduce` MUST remove enough history for the next model call to succeed,
   * or this error will propagate out of the agent loop uncaught.
   */
  error: ContextWindowOverflowError
}

/**
 * Options passed to {@link ConversationManager.reduceOnThreshold}.
 */
export type ConversationManagerThresholdOptions = {
  /**
   * The agent instance. Mutate `agent.messages` in place to reduce history.
   */
  agent: LocalAgent

  /**
   * The model instance for the upcoming call. Used by conversation
   * managers that perform model-based reduction (e.g. summarization).
   */
  model: Model
}

/**
 * Configuration for the conversation manager base class.
 */
export type ConversationManagerConfig = {
  /**
   * Ratio of context window usage that triggers proactive compression.
   * Value between 0 and 1 (e.g. 0.7 means compress when 70% of the context window is used).
   * When not set, proactive compression is disabled and only reactive overflow recovery is used.
   */
  threshold?: number
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
 * Optionally, a manager can enable proactive compression by setting `threshold` in the
 * config. When set, the base class registers a `BeforeModelCallEvent` hook that checks
 * projected input tokens against the model's context window limit and calls
 * {@link ConversationManager.reduceOnThreshold} when the threshold is exceeded.
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

  protected readonly _threshold: number | undefined

  constructor(config?: ConversationManagerConfig) {
    if (config?.threshold !== undefined && (config.threshold <= 0 || config.threshold > 1)) {
      throw new Error(`threshold must be between 0 (exclusive) and 1 (inclusive), got ${config.threshold}`)
    }
    this._threshold = config?.threshold
  }

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
   * @returns `true` if the history was reduced, `false` otherwise.
   *   May return a `Promise` for implementations that need async I/O (e.g. model calls).
   */
  abstract reduce(options: ConversationManagerReduceOptions): boolean | Promise<boolean>

  /**
   * Proactively reduce the conversation history before a model call.
   *
   * Called when projected input tokens exceed the configured threshold ratio
   * of the model's context window limit. Subclasses implement this to reduce
   * context before the model call, avoiding overflow errors.
   *
   * @param options - The threshold reduction options
   * @returns `true` if the history was reduced, `false` otherwise.
   *   May return a `Promise` for implementations that need async I/O.
   */
  reduceOnThreshold?(options: ConversationManagerThresholdOptions): boolean | Promise<boolean>

  /**
   * Initialize the conversation manager with the agent instance.
   *
   * Registers overflow recovery: when a {@link ContextWindowOverflowError} occurs,
   * calls {@link ConversationManager.reduce} and retries the model call if reduction succeeded.
   * If `reduce` returns `false`, the error propagates out of the agent loop uncaught.
   *
   * When `threshold` is configured and the subclass implements `reduceOnThreshold`,
   * also registers a `BeforeModelCallEvent` hook for proactive compression.
   *
   * Subclasses that override `initAgent` MUST call `super.initAgent(agent)` to
   * preserve overflow recovery and threshold behavior.
   *
   * @param agent - The agent to register hooks with
   */
  initAgent(agent: LocalAgent): void {
    agent.addHook(AfterModelCallEvent, async (event) => {
      if (event.error instanceof ContextWindowOverflowError) {
        if (await this.reduce({ agent: event.agent, model: event.model, error: event.error })) {
          event.retry = true
        }
      }
    })

    if (this._threshold !== undefined && !this.reduceOnThreshold) {
      logger.warn(
        `conversation_manager=<${this.name}> | threshold is configured but reduceOnThreshold is not implemented, proactive compression is disabled`
      )
    }

    if (this._threshold !== undefined && this.reduceOnThreshold) {
      agent.addHook(BeforeModelCallEvent, async (event) => {
        const contextWindowLimit = event.model.getConfig().contextWindowLimit
        if (contextWindowLimit === undefined) {
          warnOnce(
            logger,
            `conversation_manager=<${this.name}> | contextWindowLimit is not set on the model, proactive compression is disabled | set contextWindowLimit in your model config`
          )
          return
        }

        if (event.projectedInputTokens === undefined) {
          return
        }

        const ratio = event.projectedInputTokens / contextWindowLimit
        if (ratio >= this._threshold!) {
          logger.debug(
            `projected_tokens=<${event.projectedInputTokens}>, limit=<${contextWindowLimit}>, ratio=<${ratio.toFixed(2)}>, threshold=<${this._threshold}> | threshold exceeded, reducing context`
          )
          await this.reduceOnThreshold!({ agent: event.agent, model: event.model })
        }
      })
    }
  }
}
