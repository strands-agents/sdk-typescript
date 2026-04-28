/**
 * Steering handler base class for providing contextual guidance to agents.
 *
 * Provides modular prompting through contextual guidance that appears when relevant,
 * rather than front-loading all instructions. Handlers integrate with the hook system
 * to intercept actions and provide just-in-time feedback based on local context.
 *
 * Lifecycle:
 * 1. Context providers register hooks via initAgent
 * 2. BeforeToolCallEvent triggers steerBeforeTool() for tool steering
 * 3. AfterModelCallEvent triggers steerAfterModel() for model steering
 * 4. SteeringAction determines execution flow
 *
 * Subclass SteeringHandler and override steerBeforeTool() and/or steerAfterModel().
 * Both methods have default implementations that return Proceed.
 */

import { AfterModelCallEvent, BeforeToolCallEvent } from '../../../hooks/events.js'
import { logger } from '../../../logging/logger.js'
import type { Plugin } from '../../../plugins/plugin.js'
import type { LocalAgent } from '../../../types/agent.js'
import { Message, TextBlock } from '../../../types/messages.js'
import type { StopReason } from '../../../types/messages.js'
import type { ModelSteeringAction, ToolSteeringAction } from '../actions.js'
import type { SteeringContextData, SteeringProvider } from '../providers/provider.js'
import type { ToolUse } from '../../../tools/types.js'

/**
 * Base class for steering handlers that provide contextual guidance to agents.
 *
 * Steering handlers accept context providers that track agent activity,
 * and use the accumulated context to make guidance decisions.
 *
 * @example
 * ```typescript
 * class MySteeringHandler extends SteeringHandler {
 *   async steerBeforeTool(agent: LocalAgent, toolUse: ToolUse): Promise<ToolSteeringAction> {
 *     const context = this.getSteeringContext()
 *     if (toolUse.name === 'dangerous_tool') {
 *       return { type: 'guide', reason: 'This tool requires extra caution.' }
 *     }
 *     return { type: 'proceed', reason: 'Allowing tool execution.' }
 *   }
 * }
 * ```
 */
export abstract class SteeringHandler implements Plugin {
  readonly name: string = 'strands:steering'

  private readonly _contextProviders: SteeringProvider[]

  constructor(contextProviders?: SteeringProvider[]) {
    this._contextProviders = contextProviders ?? []
    logger.debug(`handler_class=<${this.constructor.name}> | initialized`)
  }

  initAgent(agent: LocalAgent): void {
    // Initialize context providers first so their hooks fire before steering evaluation
    for (const provider of this._contextProviders) {
      provider.initAgent(agent)
    }

    // Register tool steering hook
    agent.addHook(BeforeToolCallEvent, async (event) => {
      await this._provideToolSteeringGuidance(event)
    })

    // Register model steering hook
    agent.addHook(AfterModelCallEvent, async (event) => {
      await this._provideModelSteeringGuidance(event)
    })
  }

  /**
   * Collect context from all registered providers.
   *
   * @returns Array of context data objects from each provider
   */
  protected getSteeringContext(): SteeringContextData[] {
    return this._contextProviders.map((provider) => provider.context)
  }

  // ---------------------------------------------------------------------------
  // Hook handlers
  // ---------------------------------------------------------------------------

  private async _provideToolSteeringGuidance(event: BeforeToolCallEvent): Promise<void> {
    const toolName = event.toolUse.name
    logger.debug(`tool_name=<${toolName}> | providing tool steering guidance`)

    let action: ToolSteeringAction
    try {
      action = await this.steerBeforeTool(event.agent, event.toolUse)
    } catch (e) {
      logger.debug(`tool_name=<${toolName}>, error=<${e}> | tool steering handler guidance failed`)
      return
    }

    this._handleToolSteeringAction(action, event, toolName)
  }

  private _handleToolSteeringAction(action: ToolSteeringAction, event: BeforeToolCallEvent, toolName: string): void {
    switch (action.type) {
      case 'proceed':
        logger.debug(`tool_name=<${toolName}> | tool call proceeding`)
        break
      case 'guide':
        logger.debug(`tool_name=<${toolName}>, reason=<${action.reason}> | tool call guided`)
        event.cancel = `Tool call cancelled. ${action.reason} You MUST follow this guidance immediately.`
        break
      case 'interrupt':
        logger.debug(`tool_name=<${toolName}>, reason=<${action.reason}> | tool call requires human input`)
        // Treat interrupt as cancel until the TS SDK interrupt system is wired into BeforeToolCallEvent
        event.cancel = `Tool call paused for human review. ${action.reason}`
        break
      default:
        throw new Error(`Unknown steering action type for tool call: ${(action as { type: string }).type}`)
    }
  }

  private async _provideModelSteeringGuidance(event: AfterModelCallEvent): Promise<void> {
    logger.debug('providing model steering guidance')

    if (!event.stopData) {
      logger.debug('no stop data available | skipping model steering')
      return
    }

    let action: ModelSteeringAction
    try {
      action = await this.steerAfterModel(event.agent, event.stopData.message, event.stopData.stopReason)
    } catch (e) {
      logger.debug(`error=<${e}> | model steering handler guidance failed`)
      return
    }

    this._handleModelSteeringAction(action, event)
  }

  private _handleModelSteeringAction(action: ModelSteeringAction, event: AfterModelCallEvent): void {
    switch (action.type) {
      case 'proceed':
        logger.debug('model response proceeding')
        break
      case 'guide':
        logger.debug(`reason=<${action.reason}> | model response guided, retrying`)
        event.retry = true
        event.agent.messages.push(
          new Message({
            role: 'user',
            content: [new TextBlock(action.reason)],
          })
        )
        break
      default:
        throw new Error(`Unknown steering action type for model response: ${(action as { type: string }).type}`)
    }
  }

  // ---------------------------------------------------------------------------
  // Override points
  // ---------------------------------------------------------------------------

  /**
   * Provide contextual guidance before tool execution.
   *
   * Override this method to implement custom tool steering logic.
   * Use this.getSteeringContext() to access context from providers.
   *
   * @param agent - The agent instance
   * @param toolUse - The tool use object with name and arguments
   * @returns ToolSteeringAction indicating how to guide the tool execution
   */
  async steerBeforeTool(_agent: LocalAgent, _toolUse: ToolUse): Promise<ToolSteeringAction> {
    return { type: 'proceed', reason: 'Default implementation: allowing tool execution' }
  }

  /**
   * Provide contextual guidance after model response.
   *
   * Override this method to implement custom model steering logic.
   * Use this.getSteeringContext() to access context from providers.
   *
   * @param agent - The agent instance
   * @param message - The model's generated message
   * @param stopReason - The reason the model stopped generating
   * @returns ModelSteeringAction indicating how to handle the model response
   */
  async steerAfterModel(_agent: LocalAgent, _message: Message, _stopReason: StopReason): Promise<ModelSteeringAction> {
    return { type: 'proceed', reason: 'Default implementation: accepting model response' }
  }
}
