/**
 * Steering handler base class for providing contextual guidance to agents.
 *
 * Provides modular prompting through contextual guidance that appears when relevant,
 * rather than front-loading all instructions. Handlers integrate with the intervention
 * system to intercept actions and provide just-in-time feedback based on local context.
 *
 * Subclass {@link SteeringHandler} and override {@link beforeToolCall} and/or
 * {@link afterModelCall} from {@link InterventionHandler}.
 *
 * @example
 * ```typescript
 * class MySteeringHandler extends SteeringHandler {
 *   override async beforeToolCall(event) {
 *     if (event.toolUse.name === 'dangerous_tool') {
 *       return { type: 'guide', feedback: 'This tool requires extra caution.' }
 *     }
 *     return { type: 'proceed' }
 *   }
 * }
 *
 * const agent = new Agent({ tools: [...], interventions: [new MySteeringHandler()] })
 * ```
 */

import { InterventionHandler } from '../../../interventions/handler.js'
import { logger } from '../../../logging/logger.js'
import type { LocalAgent } from '../../../types/agent.js'
import type { SteeringContextData, SteeringContextProvider } from '../providers/context-provider.js'

/**
 * Configuration shared by all steering handlers.
 */
export interface SteeringHandlerConfig {
  /** Providers that supply evaluation context. */
  contextProviders?: SteeringContextProvider[]
  /**
   * Identifier for this handler instance. Defaults to `'strands:steering'`.
   * Override when attaching multiple steering handlers to the same agent —
   * `InterventionRegistry` rejects duplicate names.
   */
  name?: string
}

/**
 * Base class for steering handlers that provide contextual guidance to agents.
 *
 * Steering handlers accept context providers that track agent activity, and
 * use the accumulated context to make guidance decisions. The handler is an
 * {@link InterventionHandler} — pass it via `interventions:` on the agent.
 */
export abstract class SteeringHandler extends InterventionHandler {
  override readonly name: string

  private readonly _contextProviders: SteeringContextProvider[]

  constructor(config?: SteeringHandlerConfig) {
    super()
    this.name = config?.name ?? 'strands:steering'
    this._contextProviders = config?.contextProviders ?? []
    logger.debug(`handler_class=<${this.constructor.name}>, name=<${this.name}> | initialized`)
  }

  override async initAgent(agent: LocalAgent): Promise<void> {
    for (const provider of this._contextProviders) {
      await provider.initAgent(agent)
    }
  }

  /**
   * Collect context from all registered providers. Subclasses (and tests)
   * may call this to inspect the accumulated provider snapshots.
   */
  getSteeringContext(): SteeringContextData[] {
    return this._contextProviders.map((provider) => provider.context)
  }
}
