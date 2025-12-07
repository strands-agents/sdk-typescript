import type { JSONSchema, JSONValue } from './json.js'

/**
 * Context information for elicitation requests provided by the MCP SDK.
 *
 * This object contains session metadata and capabilities from the MCP transport layer:
 * - `sessionId`: Session identifier (for HTTP transports)
 * - `authInfo`: Authentication information (for OAuth flows)
 * - `sendNotification`: Function to send notifications to the server
 * - Other transport-specific metadata
 */
export type ElicitationContext = unknown

/**
 * Parameters passed to the elicitation callback when the server requests user input.
 */
export interface ElicitRequestParams {
  /**
   * Message to display to the user explaining what input is needed.
   */
  message: string

  /**
   * Optional JSON Schema defining the structure of the expected input.
   */
  requestedSchema?: JSONSchema
}

/**
 * Result returned by the elicitation callback to indicate user's response.
 */
export interface ElicitResult {
  /**
   * Action taken by the user.
   * - 'accept': User provided input and wants to continue
   * - 'decline': User declined to provide input
   * - 'cancel': User wants to cancel the entire operation
   */
  action: 'accept' | 'decline' | 'cancel'

  /**
   * Optional content provided by the user when action is 'accept'.
   */
  content?: Record<string, JSONValue>
}

/**
 * Callback function invoked when an MCP server requests additional input during tool execution.
 *
 * @param context - Context information about the elicitation request
 * @param params - Parameters including the message and optional schema
 * @returns A promise that resolves with the user's response
 *
 * @example
 * ```typescript
 * const elicitationCallback: ElicitationCallback = async (_context, params) => {
 *   console.log(`Server is asking: ${params.message}`)
 *   const userInput = await getUserInput()
 *   return {
 *     action: 'accept',
 *     content: { response: userInput }
 *   }
 * }
 * ```
 */
export type ElicitationCallback = (context: ElicitationContext, params: ElicitRequestParams) => Promise<ElicitResult>
