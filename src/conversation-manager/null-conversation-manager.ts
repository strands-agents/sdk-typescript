/**
 * Null implementation of conversation management.
 *
 * This module provides a no-op conversation manager that does not modify
 * the conversation history. Useful for testing and scenarios where conversation
 * management is handled externally.
 */

import type { JSONValue } from '../types/json.js'
import type { Message } from '../types/messages.js'
import type { HookRegistry } from '../hooks/registry.js'
import { ConversationManager } from './conversation-manager.js'

/**
 * A no-op conversation manager that does not modify the conversation history.
 * Extends ConversationManager but registers zero hooks.
 */
export class NullConversationManager extends ConversationManager {
  /**
   * Registers callbacks with the hook registry.
   * This implementation registers no hooks, providing a complete no-op behavior.
   *
   * @param _registry - The hook registry to register callbacks with (unused)
   */
  public registerCallbacks(_registry: HookRegistry): void {
    // No-op - register zero hooks
  }

  /**
   * Returns the current state of the null conversation manager.
   *
   * @returns A record containing the manager class name
   */
  public getState(): Record<string, JSONValue> {
    return {
      __name__: 'NullConversationManager',
    }
  }

  /**
   * Restores state from a previously saved session.
   * The null manager has no state to restore, so this always returns null.
   *
   * @param _state - The previously saved state (unused)
   * @returns null (no messages to prepend)
   */
  public restoreFromSession(_state: Record<string, JSONValue>): Message[] | null {
    return null
  }
}
