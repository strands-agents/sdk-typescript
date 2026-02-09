/**
 * Steering handler base class for providing contextual guidance to agents.
 *
 * Provides modular prompting through contextual guidance that appears when relevant,
 * rather than front-loading all instructions. Handlers integrate with the hooks system
 * to intercept actions and provide just-in-time feedback based on local context.
 *
 * @experimental This API is experimental and may change in future releases.
 */

import type { AgentData } from '../../../types/agent.js'
import type { Message, StopReason } from '../../../types/messages.js'
import { TextBlock, Message as MessageClass } from '../../../types/messages.js'
import type { HookProvider } from '../../../hooks/types.js'
import type { HookRegistry } from '../../../hooks/registry.js'
import { AfterModelCallEvent, BeforeToolCallEvent } from '../../../hooks/events.js'
import type { JSONValue } from '../../../types/json.js'

import { Guide, Interrupt, Proceed } from './action.js'
import type { ToolSteeringAction, ModelSteeringAction } from './action.js'
import { SteeringContext } from './context.js'
import type { SteeringContextCallback, SteeringContextProvider } from './context.js'

/**
 * Tool use data passed to steering evaluation methods.
 */
export interface SteeringToolUse {
  /**
   * Name of the tool being called.
   */
  name: string

  /**
   * Unique identifier for this tool use instance.
   */
  toolUseId: string

  /**
   * Input parameters for the tool.
   */
  input: JSONValue
}

/**
 * Base class for steering handlers that provide contextual guidance to agents.
 *
 * Steering handlers maintain local context and register hook callbacks to populate
 * context data as needed for guidance decisions. Subclass and override
 * `steerBeforeTool()` and/or `steerAfterModel()` to implement custom steering logic.
 * Both methods have default implementations that return Proceed.
 *
 * @experimental This API is experimental and may change in future releases.
 */
export abstract class SteeringHandler implements HookProvider {
  /**
   * Isolated context storage for this handler instance.
   */
  protected readonly steeringContext: SteeringContext

  private readonly _contextCallbacks: SteeringContextCallback[]

  constructor(config?: { contextProviders?: SteeringContextProvider[] }) {
    this.steeringContext = new SteeringContext()
    this._contextCallbacks = []

    // Collect callbacks from all providers
    for (const provider of config?.contextProviders ?? []) {
      this._contextCallbacks.push(...provider.contextProviders())
    }
  }

  /**
   * Registers hooks for steering guidance and context updates.
   *
   * @param registry - The hook registry to register callbacks with
   */
  registerCallbacks(registry: HookRegistry): void {
    // Register context update callbacks
    for (const callback of this._contextCallbacks) {
      registry.addCallback(callback.eventType, (event) => callback.update(event, this.steeringContext))
    }

    // Register tool steering guidance
    registry.addCallback(BeforeToolCallEvent, (event: BeforeToolCallEvent) => this._provideToolSteeringGuidance(event))

    // Register model steering guidance
    registry.addCallback(AfterModelCallEvent, (event: AfterModelCallEvent) => this._provideModelSteeringGuidance(event))
  }

  /**
   * Provides contextual guidance before tool execution.
   *
   * Override to implement custom tool steering logic. Access steering context
   * via `this.steeringContext`. Default implementation returns Proceed.
   *
   * @param params - Parameters for the steering evaluation
   * @returns Steering action indicating how to handle the tool execution
   */
  protected async steerBeforeTool(_params: {
    agent: AgentData
    toolUse: SteeringToolUse
  }): Promise<ToolSteeringAction> {
    return new Proceed({ reason: 'Default implementation: allowing tool execution' })
  }

  /**
   * Provides contextual guidance after model response.
   *
   * Override to implement custom model steering logic. Access steering context
   * via `this.steeringContext`. Default implementation returns Proceed.
   *
   * @param params - Parameters for the steering evaluation
   * @returns Steering action indicating how to handle the model response
   */
  protected async steerAfterModel(_params: {
    agent: AgentData
    message: Message
    stopReason: StopReason
  }): Promise<ModelSteeringAction> {
    return new Proceed({ reason: 'Default implementation: accepting model response' })
  }

  /**
   * Invokes tool steering and handles the resulting action.
   */
  private async _provideToolSteeringGuidance(event: BeforeToolCallEvent): Promise<void> {
    const toolName = event.toolUse.name

    let action: ToolSteeringAction
    try {
      action = await this.steerBeforeTool({ agent: event.agent, toolUse: event.toolUse })
    } catch {
      return
    }

    this._handleToolSteeringAction(action, event, toolName)
  }

  /**
   * Handles the steering action for tool calls by modifying tool execution flow.
   *
   * Proceed: Tool executes normally.
   * Guide: Tool cancelled with contextual feedback for agent to consider alternatives.
   * Interrupt: Pauses execution for human approval via the interrupt system.
   *   If human approves (response is truthy), tool proceeds. Otherwise, tool is cancelled.
   */
  private _handleToolSteeringAction(action: ToolSteeringAction, event: BeforeToolCallEvent, toolName: string): void {
    if (action instanceof Proceed) {
      // Tool call proceeds normally
    } else if (action instanceof Guide) {
      event.cancelTool = `Tool call cancelled. ${action.reason} You MUST follow this guidance immediately.`
    } else if (action instanceof Interrupt) {
      const response = event.interrupt(`steering_input_${toolName}`, action.reason)
      if (!response) {
        event.cancelTool = `Tool call cancelled. Human denied the operation: ${action.reason}`
      }
    } else {
      throw new Error(`Unknown steering action type for tool call: ${JSON.stringify(action)}`)
    }
  }

  /**
   * Invokes model steering and handles the resulting action.
   */
  private async _provideModelSteeringGuidance(event: AfterModelCallEvent): Promise<void> {
    // Only steer on successful model responses
    if (event.stopData === undefined) {
      return
    }

    let action: ModelSteeringAction
    try {
      action = await this.steerAfterModel({
        agent: event.agent,
        message: event.stopData.message,
        stopReason: event.stopData.stopReason,
      })
    } catch {
      return
    }

    this._handleModelSteeringAction(action, event)
  }

  /**
   * Handles the steering action for model responses by modifying response handling flow.
   *
   * Proceed: Model response accepted without modification.
   * Guide: Discard model response and retry with guidance message added to conversation.
   */
  private _handleModelSteeringAction(action: ModelSteeringAction, event: AfterModelCallEvent): void {
    if (action instanceof Proceed) {
      // Model response accepted without modification
    } else if (action instanceof Guide) {
      event.retry = true
      // Add guidance message to agent's conversation so model sees it on retry
      const guidanceMessage = new MessageClass({
        role: 'user',
        content: [new TextBlock(action.reason)],
      })
      event.agent.messages.push(guidanceMessage)
    } else {
      throw new Error(`Unknown steering action type for model response: ${JSON.stringify(action)}`)
    }
  }
}
