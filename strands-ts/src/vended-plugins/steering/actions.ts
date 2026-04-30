/**
 * Steering action types for steering evaluation results.
 *
 * Defines structured outcomes from steering handlers that determine how agent actions
 * should be handled. Steering actions enable modular prompting by providing just-in-time
 * feedback rather than front-loading all instructions in monolithic prompts.
 *
 * Action types:
 * - Proceed: allow execution to continue without intervention
 * - Guide: provide contextual guidance to redirect the agent
 * - Interrupt: pause execution for human input
 */

/**
 * Allow execution to continue without intervention.
 * The reason provides context for logging and debugging.
 */
export interface Proceed {
  readonly type: 'proceed'
  readonly reason: string
}

/**
 * Provide contextual guidance to redirect the agent.
 * The agent receives the reason as contextual feedback to help guide its behavior.
 */
export interface Guide {
  readonly type: 'guide'
  readonly reason: string
}

/**
 * Pause execution for human input via the interrupt system.
 * The human can approve or deny the operation.
 */
export interface Interrupt {
  readonly type: 'interrupt'
  readonly reason: string
}

/**
 * Steering actions valid for tool steering (steerBeforeTool).
 *
 * - Proceed: allow tool execution to continue
 * - Guide: cancel tool and provide feedback for alternative approaches
 * - Interrupt: pause for human input before tool execution
 */
export type ToolSteeringAction = Proceed | Guide | Interrupt

/**
 * Steering actions valid for model steering (steerAfterModel).
 *
 * - Proceed: accept model response without modification
 * - Guide: discard model response and retry with guidance
 */
export type ModelSteeringAction = Proceed | Guide
