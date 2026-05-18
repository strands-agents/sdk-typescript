/**
 * Steering handler base class for providing contextual guidance to agents.
 *
 * Provides modular prompting through contextual guidance that appears when relevant,
 * rather than front-loading all instructions. Handlers integrate with the intervention
 * system to intercept actions and provide just-in-time feedback based on local context.
 *
 * Subclass {@link SteeringHandler} and override {@link steerBeforeTool} and/or
 * {@link steerAfterModel}. Both methods have default implementations that return Proceed.
 *
 * @example
 * ```typescript
 * class MySteeringHandler extends SteeringHandler {
 *   override async steerBeforeTool(agent, toolUse) {
 *     if (toolUse.name === 'dangerous_tool') {
 *       return { type: 'guide', feedback: 'This tool requires extra caution.' }
 *     }
 *     return { type: 'proceed' }
 *   }
 * }
 *
 * const agent = new Agent({ tools: [...], interventions: [new MySteeringHandler()] })
 * ```
 */

import type { AfterModelCallEvent, BeforeToolCallEvent } from '../../../hooks/events.js'
import { InterventionHandler } from '../../../interventions/handler.js'
import type { Confirm, Guide, Proceed } from '../../../interventions/actions.js'
import { logger } from '../../../logging/logger.js'
import type { LocalAgent } from '../../../types/agent.js'
import type { Message, StopReason } from '../../../types/messages.js'
import type { ToolUse } from '../../../tools/types.js'
import type { SteeringContextData, SteeringContextProvider } from '../providers/context-provider.js'

/** Steering decisions valid before tool execution. */
export type ToolSteeringAction = Proceed | Guide | Confirm

/** Steering decisions valid after a model response. */
export type ModelSteeringAction = Proceed | Guide

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

  override async beforeToolCall(event: BeforeToolCallEvent): Promise<ToolSteeringAction> {
    return this.steerBeforeTool(event.agent, event.toolUse)
  }

  override async afterModelCall(event: AfterModelCallEvent): Promise<ModelSteeringAction> {
    if (!event.stopData) {
      logger.debug('no stop data available | skipping model steering')
      return { type: 'proceed' }
    }
    return this.steerAfterModel(event.agent, event.stopData.message, event.stopData.stopReason)
  }

  /**
   * Provide contextual guidance before tool execution. Override to customize.
   * Default implementation proceeds.
   */
  async steerBeforeTool(_agent: LocalAgent, _toolUse: ToolUse): Promise<ToolSteeringAction> {
    return { type: 'proceed' }
  }

  /**
   * Provide contextual guidance after a model response. Override to customize.
   * Default implementation proceeds.
   */
  async steerAfterModel(_agent: LocalAgent, _message: Message, _stopReason: StopReason): Promise<ModelSteeringAction> {
    return { type: 'proceed' }
  }
}
