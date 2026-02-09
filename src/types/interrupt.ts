/**
 * Interrupt-related type definitions for human-in-the-loop workflows.
 *
 * Defines the response format used when resuming an agent from an interrupt state.
 * Users construct InterruptResponseContent objects mapping interrupt IDs to responses,
 * then pass them as the prompt to resume agent execution.
 */

/**
 * User response to an interrupt.
 */
export interface InterruptResponse {
  /**
   * Unique identifier for the interrupt being responded to.
   */
  interruptId: string

  /**
   * User response to the interrupt.
   */
  response: unknown
}

/**
 * Content block containing a user response to an interrupt.
 *
 * Used as the prompt format when resuming an agent from an interrupt state.
 */
export interface InterruptResponseContent {
  /**
   * User response to an interrupt event.
   */
  interruptResponse: InterruptResponse
}

/**
 * Type guard to check if a value is an array of InterruptResponseContent.
 *
 * Used by the agent to determine whether an invocation prompt is a resume
 * from an interrupt state.
 *
 * @param value - The value to check
 * @returns True if the value is a valid InterruptResponseContent array
 */
export function isInterruptResponseArray(value: unknown): value is InterruptResponseContent[] {
  if (!Array.isArray(value)) {
    return false
  }

  if (value.length === 0) {
    return false
  }

  return value.every(
    (item: unknown) =>
      typeof item === 'object' &&
      item !== null &&
      'interruptResponse' in item &&
      typeof (item as InterruptResponseContent).interruptResponse === 'object' &&
      (item as InterruptResponseContent).interruptResponse !== null &&
      'interruptId' in (item as InterruptResponseContent).interruptResponse &&
      typeof (item as InterruptResponseContent).interruptResponse.interruptId === 'string'
  )
}
