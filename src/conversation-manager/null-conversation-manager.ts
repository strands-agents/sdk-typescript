/**
 * Null implementation of conversation management.
 *
 * This module provides a no-op conversation manager that does not modify
 * the conversation history. Useful for testing and scenarios where conversation
 * management is handled externally.
 */

import type { Plugin } from '../plugins/plugin.js'
import type { AgentData } from '../types/agent.js'

/**
 * A no-op conversation manager that does not modify the conversation history.
 */
export class NullConversationManager implements Plugin {
  /**
   * Unique identifier for this plugin.
   */
  get name(): string {
    return 'strands:null-conversation-manager'
  }

  // No-op — does not register any hooks
  initAgent(_agent: AgentData): void {}
}
