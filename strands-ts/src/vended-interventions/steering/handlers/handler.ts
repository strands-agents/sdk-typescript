/**
 * Steering handler base class for providing contextual guidance to agents.
 *
 * Subclass {@link SteeringHandler} and override {@link evaluateToolCall} and/or
 * {@link evaluateModelOutput} — these carry the narrow steering contract
 * (Proceed | Guide | Confirm for tool calls, Proceed | Guide for model output).
 *
 * @example
 * ```typescript
 * class MySteeringHandler extends SteeringHandler {
 *   override readonly name = 'my-steering'
 *
 *   override async evaluateToolCall(event) {
 *     if (event.toolUse.name === 'dangerous_tool') {
 *       return guide('This tool requires extra caution.')
 *     }
 *     return proceed()
 *   }
 * }
 *
 * const agent = new Agent({ tools: [...], interventions: [new MySteeringHandler()] })
 * ```
 */

import type {
  AfterModelCallEvent,
  AfterToolCallEvent,
  BeforeInvocationEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
} from '../../../hooks/events.js'
import { InterventionHandler } from '../../../interventions/handler.js'
import { proceed, type Confirm, type Guide, type Proceed } from '../../../interventions/actions.js'
import type { SteeringContextData, SteeringContextProvider } from '../providers/context-provider.js'

type Awaitable<T> = T | Promise<T>

/**
 * Configuration shared by all steering handlers.
 */
export interface SteeringHandlerConfig {
  /** Providers that supply evaluation context. */
  contextProviders?: SteeringContextProvider[]
}

/**
 * Base class for steering handlers that provide contextual guidance to agents.
 *
 * Steering handlers accept context providers that observe agent activity, and
 * use the accumulated context to make guidance decisions. The handler is an
 * {@link InterventionHandler} — pass it via `interventions:` on the agent.
 *
 * Subclasses must declare a `name` (inherited as `abstract` from
 * {@link InterventionHandler}). When attaching multiple steering handlers to
 * one agent, ensure their names are distinct — `InterventionRegistry` rejects
 * duplicates.
 *
 * The intervention lifecycle methods (`beforeToolCall`, `afterModelCall`, etc.)
 * are reserved for feeding providers and delegating to the narrow steering
 * methods. Subclasses should override {@link evaluateToolCall} and
 * {@link evaluateModelOutput} instead.
 */
export abstract class SteeringHandler extends InterventionHandler {
  abstract override readonly name: string

  private readonly _contextProviders: SteeringContextProvider[]

  constructor(config?: SteeringHandlerConfig) {
    super()
    this._contextProviders = config?.contextProviders ?? []
  }

  // ---------------------------------------------------------------------------
  // Steering moments — feed providers, then delegate to the narrow evaluator.
  // ---------------------------------------------------------------------------

  override async beforeToolCall(event: BeforeToolCallEvent): Promise<Proceed | Guide | Confirm> {
    for (const p of this._contextProviders) await p.beforeToolCall?.(event)
    return this.evaluateToolCall(event)
  }

  override async afterModelCall(event: AfterModelCallEvent): Promise<Proceed | Guide> {
    for (const p of this._contextProviders) await p.afterModelCall?.(event)
    return this.evaluateModelOutput(event)
  }

  // ---------------------------------------------------------------------------
  // Observation moments — feed providers, always proceed.
  // ---------------------------------------------------------------------------

  override async beforeInvocation(event: BeforeInvocationEvent): Promise<Proceed> {
    for (const p of this._contextProviders) await p.beforeInvocation?.(event)
    return proceed()
  }

  override async afterToolCall(event: AfterToolCallEvent): Promise<Proceed> {
    for (const p of this._contextProviders) await p.afterToolCall?.(event)
    return proceed()
  }

  override async beforeModelCall(event: BeforeModelCallEvent): Promise<Proceed> {
    for (const p of this._contextProviders) await p.beforeModelCall?.(event)
    return proceed()
  }

  // ---------------------------------------------------------------------------
  // Subclass extension points — narrow steering contract.
  // ---------------------------------------------------------------------------

  /** Evaluate a pending tool call. Default: proceed. */
  protected evaluateToolCall(_event: BeforeToolCallEvent): Awaitable<Proceed | Guide | Confirm> {
    return proceed()
  }

  /** Evaluate the model's response. Default: proceed. */
  protected evaluateModelOutput(_event: AfterModelCallEvent): Awaitable<Proceed | Guide> {
    return proceed()
  }

  /**
   * Collect context from all registered providers. Subclasses (and tests)
   * may call this to inspect the accumulated provider snapshots.
   */
  getSteeringContext(): SteeringContextData[] {
    return this._contextProviders.map((provider) => provider.context)
  }
}
