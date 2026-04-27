/**
 * Retry strategy for model invocations.
 *
 * Registered as a {@link Plugin}; hooks into {@link AfterModelCallEvent} to
 * retry failed model calls, and {@link AfterInvocationEvent} to reset per-
 * invocation state.
 */

import { AfterInvocationEvent, AfterModelCallEvent } from '../hooks/events.js'
import { ModelThrottledError } from '../errors.js'
import { logger } from '../logging/logger.js'
import type { Plugin } from '../plugins/plugin.js'
import type { LocalAgent } from '../types/agent.js'
import type { BackoffContext, BackoffStrategy } from './backoff-strategy.js'
import { ExponentialBackoff } from './backoff-strategy.js'

const DEFAULT_MAX_ATTEMPTS = 6
const DEFAULT_BACKOFF_BASE_MS = 4_000
const DEFAULT_BACKOFF_MAX_MS = 240_000

/**
 * Options for {@link ModelRetryStrategy}.
 */
export interface ModelRetryStrategyOptions {
  /**
   * Total model attempts before giving up and re-raising the error.
   * Must be \>= 1. Default {@link DEFAULT_MAX_ATTEMPTS}.
   */
  maxAttempts?: number
  /**
   * Backoff used to compute the delay between retries.
   * Default: `new ExponentialBackoff({ baseMs: DEFAULT_BACKOFF_BASE_MS, maxMs: DEFAULT_BACKOFF_MAX_MS })`.
   */
  backoff?: BackoffStrategy
}

/**
 * Retries failed model calls classified by the SDK as retryable.
 *
 * Today, only {@link ModelThrottledError} is treated as retryable. The set of
 * retryable errors may grow over time (e.g. transient server errors) without
 * requiring changes to this class's public API.
 *
 * State is per-invocation: the attempt counter and the last computed delay
 * reset on {@link AfterInvocationEvent}, and also after any successful model
 * call within an invocation.
 *
 * Hook precedence: {@link AfterModelCallEvent} fires hooks in reverse registration
 * order, so user-registered hooks run before this strategy. If a user hook sets
 * `event.retry = true` first, this strategy returns early and does not stack
 * additional backoff on top.
 *
 * Sharing: a given instance tracks its own attempt state and must not be shared
 * across multiple agents. Create a separate instance per agent.
 *
 * @example
 * ```ts
 * const agent = new Agent({
 *   model,
 *   modelRetryStrategy: new ModelRetryStrategy({ maxAttempts: 4 }),
 * })
 * ```
 */
export class ModelRetryStrategy implements Plugin {
  readonly name = 'strands:model-retry-strategy'

  private readonly _maxAttempts: number
  private readonly _backoff: BackoffStrategy

  private _currentAttempt = 0
  private _lastDelayMs: number | undefined
  private _firstFailureAt: number | undefined
  private _attachedAgent: LocalAgent | undefined

  constructor(opts: ModelRetryStrategyOptions = {}) {
    const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error(`ModelRetryStrategy: maxAttempts must be an integer >= 1 (got ${maxAttempts})`)
    }
    this._maxAttempts = maxAttempts
    this._backoff =
      opts.backoff ?? new ExponentialBackoff({ baseMs: DEFAULT_BACKOFF_BASE_MS, maxMs: DEFAULT_BACKOFF_MAX_MS })
  }

  initAgent(agent: LocalAgent): void {
    if (this._attachedAgent !== undefined && this._attachedAgent !== agent) {
      throw new Error(
        'ModelRetryStrategy: instance is already attached to another agent. ' +
          'Create a separate ModelRetryStrategy per agent.'
      )
    }
    this._attachedAgent = agent
    agent.addHook(AfterModelCallEvent, (event) => this._onAfterModelCall(event))
    agent.addHook(AfterInvocationEvent, () => this._resetState())
  }

  private async _onAfterModelCall(event: AfterModelCallEvent): Promise<void> {
    // Another hook already requested retry — don't stack a second delay on top.
    if (event.retry) return

    // Success: reset state for the next model call in this invocation.
    if (event.error === undefined) {
      this._resetState()
      return
    }

    if (!this._isRetryable(event.error)) return

    // _currentAttempt represents the attempt that just failed.
    this._currentAttempt += 1
    if (this._currentAttempt >= this._maxAttempts) {
      logger.debug(
        `current_attempt=<${this._currentAttempt}> max_attempts=<${this._maxAttempts}> | max retry attempts reached`
      )
      return
    }

    if (this._firstFailureAt === undefined) {
      this._firstFailureAt = Date.now()
    }

    // Per-error-class backoff selection is a future extension; today every
    // retryable error uses the single configured backoff.
    const delayMs = this._backoff.nextDelay(this._buildContext())

    logger.debug(
      `retry_delay_ms=<${delayMs}> attempt=<${this._currentAttempt}> max_attempts=<${this._maxAttempts}> ` +
        `| retryable model error, delaying before retry`
    )

    await sleep(delayMs)

    this._lastDelayMs = delayMs
    event.retry = true
  }

  private _buildContext(): BackoffContext {
    const ctx: BackoffContext = {
      attempt: this._currentAttempt,
      elapsedMs: this._firstFailureAt === undefined ? 0 : Date.now() - this._firstFailureAt,
    }
    if (this._lastDelayMs !== undefined) {
      ctx.lastDelayMs = this._lastDelayMs
    }
    return ctx
  }

  private _isRetryable(error: Error): boolean {
    return error instanceof ModelThrottledError
  }

  private _resetState(): void {
    this._currentAttempt = 0
    this._lastDelayMs = undefined
    this._firstFailureAt = undefined
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}
