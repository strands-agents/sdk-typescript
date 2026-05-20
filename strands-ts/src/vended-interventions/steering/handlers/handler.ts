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

import type { AfterModelCallEvent, BeforeToolCallEvent } from '../../../hooks/events.js'
import { InterventionHandler } from '../../../interventions/handler.js'
import { proceed, type Confirm, type Guide, type Proceed } from '../../../interventions/actions.js'
import type { LocalAgent } from '../../../types/agent.js'
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
 * Subclasses should override {@link evaluateToolCall} and
 * {@link evaluateModelOutput} to carry the narrow steering contract; the base
 * class wires these into the intervention lifecycle.
 */
export abstract class SteeringHandler extends InterventionHandler {
  abstract override readonly name: string

  private readonly _contextProviders: SteeringContextProvider[]

  constructor(config?: SteeringHandlerConfig) {
    super()
    this._contextProviders = config?.contextProviders ?? []
  }

  override registerHooks(agent: LocalAgent): void {
    for (const provider of this._contextProviders) {
      provider.registerHooks?.(agent)
    }
  }

  override async beforeToolCall(event: BeforeToolCallEvent): Promise<Proceed | Guide | Confirm> {
    return this.evaluateToolCall(event)
  }

  override async afterModelCall(event: AfterModelCallEvent): Promise<Proceed | Guide> {
    return this.evaluateModelOutput(event)
  }

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
