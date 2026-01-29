import type {
  ElicitResult,
  ElicitRequestParams,
  ClientRequest,
  ClientNotification,
} from '@modelcontextprotocol/sdk/types.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'

/**
 * Context provided to the elicitation callback from the MCP SDK.
 */
type ElicitationContext = RequestHandlerExtra<ClientRequest, ClientNotification>

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
