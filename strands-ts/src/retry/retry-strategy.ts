/**
 * Abstract base class for retry strategies.
 */

import { AfterInvocationEvent, AfterModelCallEvent } from '../hooks/events.js'
import type { Plugin } from '../plugins/plugin.js'
import type { LocalAgent } from '../types/agent.js'

/**
 * Abstract base class for retry strategies.
 *
 * A {@link RetryStrategy} is a {@link Plugin} that retries failed agent calls.
 * {@link RetryStrategy.retryModel} is abstract: every subclass must declare
 * how it handles model failures (even if only as an empty method body).
 *
 * Future retry topics (e.g. `retryTool`) will be added as non-abstract
 * methods with no-op defaults so that introducing a new topic does not
 * break existing external `RetryStrategy` subclasses.
 *
 * State reset: the base class registers `AfterInvocationEvent` and calls
 * {@link RetryStrategy.reset} so subclasses get a clean-slate hook at every
 * invocation boundary without re-implementing hook wiring. Subclasses with
 * state override `reset` (and typically call `super.reset()`).
 *
 * Single-agent attachment: retry strategies typically carry per-invocation
 * state (attempt counters, timers), so sharing one instance across two
 * agents would let their invocations trample each other. The base class
 * enforces this by remembering the first agent it's attached to and
 * throwing on attempts to attach to a different one. Stateless strategies
 * are unaffected (the guard only fires when the caller tries to share an
 * instance across agents, regardless of whether that instance has state).
 *
 * @example
 * ```typescript
 * class MyRetryStrategy extends ModelRetryStrategy {
 *   private _toolAttempts = 0
 *   override async retryTool(event: AfterToolCallEvent): Promise<void> {
 *     // custom tool retry logic
 *   }
 *   protected override reset(): void {
 *     super.reset()
 *     this._toolAttempts = 0
 *   }
 * }
 * ```
 */
export abstract class RetryStrategy implements Plugin {
  /**
   * A stable string identifier for this retry strategy.
   */
  abstract readonly name: string

  private _attachedAgent: LocalAgent | undefined

  /**
   * Handle a post-model-call event. Set `event.retry = true` (typically after
   * an `await sleep(delayMs)`) to request that the agent re-invoke the model.
   * Return without setting `event.retry` to let the error propagate.
   *
   * Subclasses that don't retry model calls should implement this as an
   * empty method — the {@link AfterModelCallEvent} hook is registered by
   * the base class regardless.
   */
  abstract retryModel(event: AfterModelCallEvent): void | Promise<void>

  /**
   * Reset any per-invocation state. Called on {@link AfterInvocationEvent}.
   * Subclasses with attempt counters or timers should override and clear
   * their state here (typically calling `super.reset()` first).
   */
  protected reset(): void {}

  initAgent(agent: LocalAgent): void {
    if (this._attachedAgent !== undefined && this._attachedAgent !== agent) {
      throw new Error(
        `${this.constructor.name}: instance is already attached to another agent. ` +
          'Create a separate instance per agent.'
      )
    }
    this._attachedAgent = agent

    agent.addHook(AfterModelCallEvent, (event) => this.retryModel(event))
    agent.addHook(AfterInvocationEvent, () => this.reset())
  }
}
