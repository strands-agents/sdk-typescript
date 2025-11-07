import type { AgentState } from '../agent/state.js'
import type { Message } from './messages.js'
import type { JSONValue } from './json.js'

/**
 * Interface for objects that provide agent state.
 * Allows ToolContext to work with different agent types.
 *
 * @typeParam TState - Optional type for strongly typing state keys and values
 */
export interface AgentData<TState extends Record<string, JSONValue> = Record<string, JSONValue>> {
  /**
   * Agent state storage accessible to tools and application logic.
   */
  state: AgentState<TState>
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
