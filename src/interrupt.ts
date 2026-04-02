/**
 * Human-in-the-loop interrupt system for agent workflows.
 *
 * This module provides the core classes for implementing interrupts that can pause
 * agent execution to collect user input, confirmation, or clarification.
 *
 * Interrupt Flow:
 * 1. Hook or tool calls `event.interrupt()` or `context.interrupt()`
 * 2. If resuming (response exists), the response is returned
 * 3. Otherwise, `InterruptError` is thrown to halt execution
 * 4. Agent returns with `stopReason: 'interrupt'` and `interrupts` array
 * 5. User resumes by invoking agent with `interruptResponse` content blocks
 * 6. On resume, `interrupt()` returns the user's response
 */

import type { InterruptResponseContent } from './types/interrupt.js'
import {
  contentBlockFromData,
  Message,
  ToolResultBlock,
  type ContentBlockData,
  type MessageData,
} from './types/messages.js'

/**
 * Represents an interrupt that can pause agent execution for human-in-the-loop workflows.
 */
export class Interrupt {
  /**
   * Unique identifier for this interrupt.
   */
  readonly id: string

  /**
   * User-defined name for the interrupt.
   */
  readonly name: string

  /**
   * User-provided reason for raising the interrupt.
   */
  readonly reason?: unknown

  /**
   * Human response provided when resuming the agent after an interrupt.
   */
  response?: unknown

  constructor(data: { id: string; name: string; reason?: unknown; response?: unknown }) {
    this.id = data.id
    this.name = data.name
    if (data.reason !== undefined) {
      this.reason = data.reason
    }
    if (data.response !== undefined) {
      this.response = data.response
    }
  }

  /**
   * Serializes the interrupt to a JSON-compatible object.
   */
  toJSON(): { id: string; name: string; reason?: unknown; response?: unknown } {
    return {
      id: this.id,
      name: this.name,
      ...(this.reason !== undefined && { reason: this.reason }),
      ...(this.response !== undefined && { response: this.response }),
    }
  }

  /**
   * Creates an Interrupt instance from a JSON object.
   *
   * @param data - JSON data to deserialize
   * @returns Interrupt instance
   */
  static fromJSON(data: { id: string; name: string; reason?: unknown; response?: unknown }): Interrupt {
    return new Interrupt(data)
  }
}

/**
 * Error thrown when human input is required to continue agent execution.
 * This error is caught by the agent loop to trigger an interrupt stop.
 */
export class InterruptError extends Error {
  /**
   * The interrupt that caused this error.
   */
  readonly interrupt: Interrupt

  constructor(interrupt: Interrupt) {
    super(`Interrupt raised: ${interrupt.name}`)
    this.name = 'InterruptError'
    this.interrupt = interrupt
  }
}

/**
 * Data format for serialized interrupt state.
 */
export interface InterruptStateData {
  /**
   * Map of interrupt IDs to interrupt data.
   */
  interrupts: Record<string, { id: string; name: string; reason?: unknown; response?: unknown }>

  /**
   * Resume responses that were provided when resuming from an interrupt.
   */
  resumeResponses?: InterruptResponseContent[]

  /**
   * Whether the agent is in an interrupted state.
   */
  activated: boolean
}

/**
 * Pending tool execution state stored when an interrupt occurs mid-execution.
 * Contains all data needed to resume tool execution without re-calling the model.
 */
export interface PendingToolExecution {
  /**
   * The assistant message containing tool use blocks.
   * Serialized as MessageData for storage.
   */
  assistantMessageData: unknown

  /**
   * Tool results that were completed before the interrupt.
   * Maps toolUseId to serialized ToolResultBlock data.
   */
  completedToolResults: Record<string, unknown>
}

/**
 * Tracks the state of interrupt events raised during agent execution.
 *
 * Interrupt state is cleared after resuming.
 */
export class InterruptState {
  /**
   * Map of interrupt IDs to Interrupt instances.
   */
  private _interrupts: Map<string, Interrupt>

  /**
   * Resume responses provided when resuming from an interrupt.
   */
  private _resumeResponses: InterruptResponseContent[] | undefined

  /**
   * Whether the agent is in an interrupted state.
   */
  private _activated: boolean

  /**
   * Pending tool execution state for resume.
   * When an interrupt occurs during tool execution, this stores the
   * assistant message and completed tool results so we can resume
   * without re-calling the model.
   */
  private _pendingToolExecution: PendingToolExecution | undefined

  constructor() {
    this._interrupts = new Map()
    this._resumeResponses = undefined
    this._activated = false
    this._pendingToolExecution = undefined
  }

  /**
   * Gets all interrupts.
   */
  get interrupts(): Map<string, Interrupt> {
    return this._interrupts
  }

  /**
   * Gets the resume responses provided when resuming from an interrupt.
   */
  get resumeResponses(): InterruptResponseContent[] | undefined {
    return this._resumeResponses
  }

  /**
   * Returns whether the agent is in an interrupted state.
   */
  get activated(): boolean {
    return this._activated
  }

  /**
   * Gets the pending tool execution state.
   */
  get pendingToolExecution(): PendingToolExecution | undefined {
    return this._pendingToolExecution
  }

  /**
   * Gets the pending tool execution state with reconstructed Message and ToolResultBlock objects.
   * Returns undefined if there is no pending execution.
   *
   * @returns Object containing the assistant message and map of completed tool results,
   *          or undefined if no pending execution exists.
   */
  getPendingExecution(): { assistantMessage: Message; completedToolResults: Map<string, ToolResultBlock> } | undefined {
    if (!this._pendingToolExecution) {
      return undefined
    }

    const assistantMessage = Message.fromMessageData(this._pendingToolExecution.assistantMessageData as MessageData)

    const completedToolResults = new Map<string, ToolResultBlock>()
    for (const [toolUseId, resultData] of Object.entries(this._pendingToolExecution.completedToolResults)) {
      const block = contentBlockFromData(resultData as ContentBlockData)
      if (block.type === 'toolResultBlock') {
        completedToolResults.set(toolUseId, block)
      }
    }

    return { assistantMessage, completedToolResults }
  }

  /**
   * Sets the pending tool execution state.
   * Called when an interrupt occurs during tool execution.
   */
  setPendingToolExecution(pending: PendingToolExecution): void {
    this._pendingToolExecution = pending
  }

  /**
   * Clears the pending tool execution state.
   * Called when resuming completes or when starting fresh.
   */
  clearPendingToolExecution(): void {
    this._pendingToolExecution = undefined
  }

  /**
   * Returns the list of interrupts as an array.
   */
  getInterruptsList(): Interrupt[] {
    return Array.from(this._interrupts.values())
  }

  /**
   * Activates the interrupt state.
   * Called when an interrupt is raised.
   */
  activate(): void {
    this._activated = true
  }

  /**
   * Deactivates the interrupt state and clears all interrupts and context.
   * Called when resuming completes successfully.
   */
  deactivate(): void {
    this._interrupts.clear()
    this._resumeResponses = undefined
    this._activated = false
    this._pendingToolExecution = undefined
  }

  /**
   * Configures the interrupt state for resuming from an interrupt.
   * Populates interrupt responses from the provided content blocks.
   *
   * @param responses - Array of interrupt response content blocks
   * @throws TypeError if in interrupt state but responses are invalid
   * @throws Error if an interrupt ID is not found
   */
  resume(responses: InterruptResponseContent[]): void {
    if (!this._activated) {
      return
    }

    for (const content of responses) {
      const interruptId = content.interruptResponse.interruptId
      const response = content.interruptResponse.response

      const interrupt = this._interrupts.get(interruptId)
      if (!interrupt) {
        throw new Error(`interrupt_id=<${interruptId}> | no interrupt found`)
      }

      interrupt.response = response
    }

    this._resumeResponses = responses
  }

  /**
   * Gets or creates an interrupt with the given ID.
   * If the interrupt already exists, returns it (potentially with a response).
   * If not found by ID but an interrupt with the same name has a response,
   * the response is inherited to support resume across model calls.
   *
   * @param id - Unique identifier for the interrupt
   * @param name - User-defined name for the interrupt
   * @param reason - Optional reason for the interrupt
   * @returns The interrupt (may have a response if resuming)
   */
  getOrCreateInterrupt(id: string, name: string, reason?: unknown): Interrupt {
    // First check for exact ID match
    let interrupt = this._interrupts.get(id)
    if (interrupt) {
      return interrupt
    }

    // If not found by ID but we're resuming, check for a matching interrupt by name
    // that has a response (from a previous tool use ID). This allows resume to work
    // even when the model returns a different tool use ID.
    if (this._activated) {
      for (const existingInterrupt of this._interrupts.values()) {
        if (existingInterrupt.name === name && existingInterrupt.response !== undefined) {
          // Create a new interrupt with the new ID but inherit the response
          interrupt = new Interrupt({ id, name, reason })
          interrupt.response = existingInterrupt.response
          this._interrupts.set(id, interrupt)
          return interrupt
        }
      }
    }

    // Create new interrupt
    interrupt = new Interrupt({ id, name, reason })
    this._interrupts.set(id, interrupt)
    return interrupt
  }

  /**
   * Serializes the interrupt state to a JSON-compatible object.
   */
  toJSON(): InterruptStateData {
    const interrupts: Record<string, { id: string; name: string; reason?: unknown; response?: unknown }> = {}
    for (const [id, interrupt] of this._interrupts) {
      interrupts[id] = interrupt.toJSON()
    }

    return {
      interrupts,
      ...(this._resumeResponses && { resumeResponses: this._resumeResponses }),
      activated: this._activated,
    }
  }

  /**
   * Creates an InterruptState instance from a JSON object.
   *
   * @param data - JSON data to deserialize
   * @returns InterruptState instance
   */
  static fromJSON(data: InterruptStateData): InterruptState {
    const state = new InterruptState()
    state._activated = data.activated

    for (const [id, interruptData] of Object.entries(data.interrupts)) {
      state._interrupts.set(id, Interrupt.fromJSON(interruptData))
    }

    if (data.resumeResponses) {
      state._resumeResponses = data.resumeResponses as InterruptResponseContent[]
    }

    return state
  }
}
