/**
 * Human-in-the-loop interrupt system for agent workflows.
 *
 * Provides the core primitives for pausing agent execution to collect human input.
 * Hook callbacks call `event.interrupt()` to raise an interrupt, which stops the agent
 * loop and returns the interrupts to the caller. The caller then resumes by invoking
 * the agent with interrupt responses mapped by ID.
 */

import type { InterruptResponseContent } from './types/interrupt.js'

/**
 * ISO OID namespace UUID for deterministic interrupt ID generation.
 * Matches Python SDK's uuid.NAMESPACE_OID (RFC 4122).
 */
export const UUID_NAMESPACE_OID = '6ba7b812-9dad-11d1-80b4-00c04fd430c8'

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
  readonly reason: unknown

  /**
   * Human response provided when resuming the agent after an interrupt.
   */
  response: unknown

  constructor(data: { id: string; name: string; reason?: unknown; response?: unknown }) {
    this.id = data.id
    this.name = data.name
    this.reason = data.reason ?? null
    this.response = data.response ?? null
  }

  /**
   * Serialize to a plain object for session management.
   *
   * @returns Plain object representation of this interrupt
   */
  toDict(): { id: string; name: string; reason: unknown; response: unknown } {
    return {
      id: this.id,
      name: this.name,
      reason: this.reason,
      response: this.response,
    }
  }

  /**
   * Create an Interrupt from a serialized plain object.
   *
   * @param data - Serialized interrupt data from `toDict()`
   * @returns New Interrupt instance
   */
  static fromDict(data: { id: string; name: string; reason?: unknown; response?: unknown }): Interrupt {
    return new Interrupt(data)
  }
}

/**
 * Exception raised when human input is required.
 *
 * Thrown by `event.interrupt()` to signal that the agent should pause execution.
 * The hook registry catches this and collects the interrupt for the caller.
 */
export class InterruptException extends Error {
  /**
   * The interrupt that triggered this exception.
   */
  readonly interrupt: Interrupt

  constructor(interrupt: Interrupt) {
    super(`Interrupt raised: ${interrupt.name}`)
    this.name = 'InterruptException'
    this.interrupt = interrupt
  }
}

/**
 * Serialized form of InterruptState for session persistence.
 */
export interface InterruptStateData {
  /**
   * Map of interrupt ID to serialized interrupt data.
   */
  interrupts: Record<string, { id: string; name: string; reason: unknown; response: unknown }>

  /**
   * Additional context associated with the interrupt event.
   */
  context: Record<string, unknown>

  /**
   * Whether the agent is in an interrupt state.
   */
  activated: boolean
}

/**
 * Tracks the state of interrupt events raised by hook callbacks.
 *
 * Manages the lifecycle of interrupts: creation, activation, resume with
 * user responses, and deactivation. State is cleared after resuming.
 */
export class InterruptState {
  /**
   * Active interrupts keyed by their unique ID.
   */
  interrupts: Map<string, Interrupt>

  /**
   * Additional context associated with the interrupt event (e.g. stored tool_use_message).
   */
  context: Record<string, unknown>

  /**
   * Whether the agent is currently in an interrupt state.
   */
  activated: boolean

  constructor() {
    this.interrupts = new Map()
    this.context = {}
    this.activated = false
  }

  /**
   * Activate the interrupt state.
   */
  activate(): void {
    this.activated = true
  }

  /**
   * Deactivate the interrupt state.
   *
   * Clears all interrupts and context.
   */
  deactivate(): void {
    this.interrupts = new Map()
    this.context = {}
    this.activated = false
  }

  /**
   * Configure the interrupt state when resuming from an interrupt event.
   *
   * Maps user responses to their corresponding interrupts by ID. If the
   * state is not activated, this is a no-op.
   *
   * @param prompt - User responses for resuming from interrupt
   * @throws TypeError if prompt is not an array of InterruptResponseContent
   * @throws Error if an interrupt ID in the response does not match any active interrupt
   */
  resume(prompt: unknown): void {
    if (!this.activated) {
      return
    }

    if (!Array.isArray(prompt)) {
      throw new TypeError(
        `prompt_type=<${typeof prompt}> | must resume from interrupt with list of interruptResponse's`
      )
    }

    // Validate all entries are InterruptResponseContent
    for (const content of prompt) {
      if (typeof content !== 'object' || content === null) {
        throw new TypeError(
          `content_types=<${typeof content}> | must resume from interrupt with list of interruptResponse's`
        )
      }
      const keys = Object.keys(content as Record<string, unknown>)
      const invalidKeys = keys.filter((key) => key !== 'interruptResponse')
      if (invalidKeys.length > 0) {
        throw new TypeError(
          `content_types=<${JSON.stringify(invalidKeys)}> | must resume from interrupt with list of interruptResponse's`
        )
      }
    }

    const contents = prompt as InterruptResponseContent[]
    for (const content of contents) {
      const interruptId = content.interruptResponse.interruptId
      const interruptResponse = content.interruptResponse.response

      const interrupt = this.interrupts.get(interruptId)
      if (interrupt === undefined) {
        throw new Error(`interrupt_id=<${interruptId}> | no interrupt found`)
      }

      interrupt.response = interruptResponse
    }

    this.context['responses'] = contents
  }

  /**
   * Serialize to a plain object for session management.
   *
   * @returns Serialized interrupt state
   */
  toDict(): InterruptStateData {
    const interrupts: Record<string, { id: string; name: string; reason: unknown; response: unknown }> = {}
    for (const [id, interrupt] of this.interrupts) {
      interrupts[id] = interrupt.toDict()
    }

    return {
      interrupts,
      context: this.context,
      activated: this.activated,
    }
  }

  /**
   * Create an InterruptState from serialized data.
   *
   * @param data - Serialized interrupt state from `toDict()`
   * @returns New InterruptState instance
   */
  static fromDict(data: InterruptStateData): InterruptState {
    const state = new InterruptState()
    for (const [id, interruptData] of Object.entries(data.interrupts)) {
      state.interrupts.set(id, Interrupt.fromDict(interruptData))
    }
    state.context = data.context
    state.activated = data.activated
    return state
  }
}
