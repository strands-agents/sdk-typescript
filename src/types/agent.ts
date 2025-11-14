import type { AgentState } from '../agent/state.js'
import type { Message } from './messages.js'

/**
 * Interface for objects that provide agent state.
 * Allows ToolContext to work with different agent types.
 */
export interface AgentData {
  /**
   * Agent state storage accessible to tools and application logic.
   */
  state: AgentState
}

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
