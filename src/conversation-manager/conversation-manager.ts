/**
 * Abstract base class for conversation managers.
 *
 * Provides a common interface for managing conversation history and supporting
 * session persistence through state serialization and restoration.
 */

import type { JSONValue } from '../types/json.js'
import type { Message } from '../types/messages.js'
import type { HookProvider } from '../hooks/types.js'
import type { HookRegistry } from '../hooks/registry.js'

/**
 * Abstract base class for conversation managers.
 *
 * All conversation managers must extend this class to support session persistence.
 * The `getState()` and `restoreFromSession()` methods enable session managers to
 * save and restore conversation manager state across sessions.
 */
export abstract class ConversationManager implements HookProvider {
  /**
   * Registers hook callbacks with the agent's hook registry.
   *
   * @param registry - The hook registry to register callbacks with
   */
  abstract registerCallbacks(registry: HookRegistry): void

  /**
   * Returns the current state of the conversation manager as a serializable object.
   * Used by session managers to persist conversation manager state.
   *
   * @returns A JSON-serializable record representing the current state
   */
  abstract getState(): Record<string, JSONValue>

  /**
   * Restores conversation manager state from a previously saved session.
   * Returns messages that should be prepended to the conversation history
   * (e.g., a summary message), or null if no messages need to be prepended.
   *
   * @param state - The previously saved state to restore from
   * @returns Messages to prepend to conversation history, or null
   */
  abstract restoreFromSession(state: Record<string, JSONValue>): Message[] | null
}
