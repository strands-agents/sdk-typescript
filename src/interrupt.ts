/**
 * Human-in-the-loop interrupt system for agent workflows.
 *
 * Enables pausing agent execution mid-flow to request human input.
 * Hook callbacks can raise interrupts to pause the agent loop,
 * and the caller resumes by providing responses.
 *
 * Flow:
 * 1. Hook callback calls `event.interrupt(name, reason)` during BeforeToolCallEvent
 * 2. If not resuming, throws InterruptException to pause the agent loop
 * 3. Agent loop catches the exception, collects interrupts, stops with stopReason "interrupt"
 * 4. Caller provides responses and re-invokes the agent
 * 5. On resume, `event.interrupt()` returns the response instead of throwing
 */

/**
 * Represents an interrupt that can pause agent execution for human-in-the-loop workflows.
 */
export class Interrupt {
  readonly id: string
  readonly name: string
  readonly reason: unknown
  response: unknown

  constructor(data: { id: string; name: string; reason?: unknown; response?: unknown }) {
    this.id = data.id
    this.name = data.name
    this.reason = data.reason
    this.response = data.response
  }

  toJSON(): Record<string, unknown> {
    return { id: this.id, name: this.name, reason: this.reason, response: this.response }
  }

  static fromJSON(data: Record<string, unknown>): Interrupt {
    return new Interrupt({
      id: data.id as string,
      name: data.name as string,
      reason: data.reason,
      response: data.response,
    })
  }
}

/**
 * Exception raised when human input is required.
 * Thrown by `event.interrupt()` to pause the agent loop.
 */
export class InterruptException extends Error {
  readonly interrupt: Interrupt

  constructor(interrupt: Interrupt) {
    super(`Interrupt: ${interrupt.name}`)
    this.name = 'InterruptException'
    this.interrupt = interrupt
  }
}

/**
 * Content block for providing interrupt responses when resuming.
 */
export interface InterruptResponse {
  interruptId: string
  response: unknown
}

export interface InterruptResponseContent {
  interruptResponse: InterruptResponse
}

/**
 * Tracks the state of interrupt events raised during agent execution.
 * Interrupt state is cleared after resuming.
 *
 * @internal
 */
export class _InterruptState {
  interrupts: Map<string, Interrupt> = new Map()
  context: Record<string, unknown> = {}
  activated: boolean = false

  activate(): void {
    this.activated = true
  }

  deactivate(): void {
    this.interrupts = new Map()
    this.context = {}
    this.activated = false
  }

  /**
   * Configure the interrupt state if resuming from an interrupt event.
   * Matches interrupt responses to their corresponding interrupts.
   */
  resume(responses: InterruptResponseContent[]): void {
    if (!this.activated) return

    for (const content of responses) {
      const { interruptId, response } = content.interruptResponse
      const interrupt = this.interrupts.get(interruptId)
      if (!interrupt) {
        throw new Error(`No interrupt found for id: ${interruptId}`)
      }
      interrupt.response = response
    }

    this.context['responses'] = responses
  }

  toJSON(): Record<string, unknown> {
    const interrupts: Record<string, unknown> = {}
    for (const [id, interrupt] of this.interrupts) {
      interrupts[id] = interrupt.toJSON()
    }
    return { interrupts, context: this.context, activated: this.activated }
  }

  static fromJSON(data: Record<string, unknown>): _InterruptState {
    const state = new _InterruptState()
    const interrupts = data.interrupts as Record<string, Record<string, unknown>>
    for (const [id, interruptData] of Object.entries(interrupts)) {
      state.interrupts.set(id, Interrupt.fromJSON(interruptData))
    }
    state.context = (data.context as Record<string, unknown>) ?? {}
    state.activated = data.activated as boolean
    return state
  }
}

/**
 * Generate a deterministic interrupt ID from a tool use ID and interrupt name.
 * Uses Web Crypto API for browser compatibility.
 *
 * @internal
 */
export async function generateInterruptId(toolUseId: string, name: string): Promise<string> {
  const data = new TextEncoder().encode(name)
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data)
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
  return `v1:before_tool_call:${toolUseId}:${hash}`
}
