/**
 * Steering action types for steering evaluation results.
 *
 * Defines structured outcomes from steering handlers that determine how agent actions
 * should be handled. Actions enable modular prompting by providing just-in-time feedback
 * rather than front-loading all instructions in monolithic prompts.
 *
 * @experimental This API is experimental and may change in future releases.
 */

/**
 * Allow execution to continue without intervention.
 *
 * The action proceeds as planned. The reason provides context
 * for logging and debugging purposes.
 *
 * @experimental This API is experimental and may change in future releases.
 */
export class Proceed {
  readonly type = 'proceed' as const
  readonly reason: string

  constructor(data: { reason: string }) {
    this.reason = data.reason
  }
}

/**
 * Provide contextual guidance to redirect the agent.
 *
 * The agent receives the reason as contextual feedback to help guide
 * its behavior. The specific handling depends on the steering context
 * (e.g., tool call vs. model response).
 *
 * @experimental This API is experimental and may change in future releases.
 */
export class Guide {
  readonly type = 'guide' as const
  readonly reason: string

  constructor(data: { reason: string }) {
    this.reason = data.reason
  }
}

/**
 * Pause execution for human input via the interrupt system.
 *
 * Execution is paused and human input is requested. The human can approve
 * or deny the operation, and their decision determines whether execution
 * continues or is cancelled.
 *
 * @experimental This API is experimental and may change in future releases.
 */
export class Interrupt {
  readonly type = 'interrupt' as const
  readonly reason: string

  constructor(data: { reason: string }) {
    this.reason = data.reason
  }
}

/**
 * Steering actions valid for tool steering (steerBeforeTool).
 *
 * - Proceed: Allow tool execution to continue
 * - Guide: Cancel tool and provide feedback for alternative approaches
 * - Interrupt: Pause for human input before tool execution
 *
 * @experimental This API is experimental and may change in future releases.
 */
export type ToolSteeringAction = Proceed | Guide | Interrupt

/**
 * Steering actions valid for model steering (steerAfterModel).
 *
 * - Proceed: Accept model response without modification
 * - Guide: Discard model response and retry with guidance
 *
 * @experimental This API is experimental and may change in future releases.
 */
export type ModelSteeringAction = Proceed | Guide
