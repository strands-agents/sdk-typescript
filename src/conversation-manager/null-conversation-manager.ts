/**
 * Null implementation of conversation management.
 *
 * This module provides a no-op conversation manager that does not modify
 * the conversation history. Useful for testing and scenarios where conversation
 * management is handled externally.
 */

import { Plugin } from '../plugins/plugin.js'

/**
 * A no-op conversation manager that does not modify the conversation history.
 */
export class NullConversationManager extends Plugin {
  /**
   * Unique identifier for this plugin.
   */
  get name(): string {
    return 'strands:null-conversation-manager'
  }

  // Uses default initAgent which registers no hooks
}
