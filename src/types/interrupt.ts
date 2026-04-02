/**
 * Interrupt-related type definitions for human-in-the-loop workflows.
 *
 * These types define the data structures used when invoking agents with
 * interrupt responses to resume execution.
 */

/**
 * Parameters for raising an interrupt.
 */
export interface InterruptParams {
  /**
   * User-defined name for the interrupt.
   * Must be unique within a single hook callback or tool execution.
   */
  name: string

  /**
   * User-provided reason for the interrupt.
   * Can be any value (string, object, etc.) to provide context to the user.
   */
  reason?: unknown
}

/**
 * User response to an interrupt.
 */
export interface InterruptResponse {
  /**
   * Unique identifier of the interrupt being responded to.
   */
  interruptId: string

  /**
   * User's response to the interrupt.
   * Can be any value that the hook or tool expects.
   */
  response: unknown
}

/**
 * Content block containing a user response to an interrupt.
 * Used when invoking an agent to resume from an interrupted state.
 */
export interface InterruptResponseContent {
  /**
   * The interrupt response data.
   */
  interruptResponse: InterruptResponse
}

/**
 * Type guard that checks whether a value is an {@link InterruptResponseContent}.
 */
export function isInterruptResponseContent(value: unknown): value is InterruptResponseContent {
  if (typeof value !== 'object' || value === null || !('interruptResponse' in value)) {
    return false
  }
  const { interruptResponse } = value as InterruptResponseContent
  return typeof interruptResponse === 'object' && interruptResponse !== null && 'interruptId' in interruptResponse
}
