/**
 * Null implementation of conversation management.
 *
 * This module provides a no-op conversation manager that does not modify
 * the conversation history. Useful for testing and scenarios where conversation
 * management is handled externally.
 */

import type { HookProvider } from '../hooks/types.js'
import type { HookRegistry } from '../hooks/registry.js'

/**
 * A no-op conversation manager that does not modify the conversation history.
 * Implements HookProvider but registers zero hooks.
 */
export class NullConversationManager implements HookProvider {
  /**
   * Registers callbacks with the hook registry.
   * This implementation registers no hooks, providing a complete no-op behavior.
   *
   * @param _registry - The hook registry to register callbacks with (unused)
   */
  public registerCallbacks(_registry: HookRegistry): void {
    // No-op - register zero hooks
  }
}
