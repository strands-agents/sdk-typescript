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

import type { JSONValue } from './types/json.js'
import type { InterruptResponseContent } from './types/interrupt.js'

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
   * Additional context associated with the interrupt state.
   */
  context: Record<string, JSONValue>

  /**
   * Whether the agent is in an interrupted state.
   */
  activated: boolean
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
   * Additional context associated with the interrupt state.
   */
  private _context: Map<string, unknown>

  /**
   * Whether the agent is in an interrupted state.
   */
  private _activated: boolean

  constructor() {
    this._interrupts = new Map()
    this._context = new Map()
    this._activated = false
  }

  /**
   * Gets all interrupts.
   */
  get interrupts(): Map<string, Interrupt> {
    return this._interrupts
  }

  /**
   * Gets the context map.
   */
  get context(): Map<string, unknown> {
    return this._context
  }

  /**
   * Returns whether the agent is in an interrupted state.
   */
  get activated(): boolean {
    return this._activated
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
    this._context.clear()
    this._activated = false
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

    this._context.set('responses', responses)
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

    const context: Record<string, JSONValue> = {}
    for (const [key, value] of this._context) {
      context[key] = value as JSONValue
    }

    return {
      interrupts,
      context,
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

    for (const [key, value] of Object.entries(data.context)) {
      state._context.set(key, value)
    }

    return state
  }
}
