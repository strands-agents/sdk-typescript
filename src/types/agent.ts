import type { Message } from './messages.js'

/**
 * Result returned by the agent loop.
 */
export interface AgentResult {
  /**
   * The stop reason from the final model response.
   */
  stopReason: string

  /**
   * The last message added to the messages array.
   */
  lastMessage: Message
}
