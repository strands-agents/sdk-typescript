/**
 * Abstract session manager interface for agent session persistence.
 *
 * A session manager persists conversation history, agent state, and conversation
 * manager state across agent interactions. It integrates with the agent lifecycle
 * through the hooks system.
 */

import type { AgentData } from '../types/agent.js'
import type { Message } from '../types/messages.js'
import type { HookProvider } from '../hooks/types.js'
import type { HookRegistry } from '../hooks/registry.js'
import { AgentInitializedEvent, AfterInvocationEvent, MessageAddedEvent } from '../hooks/events.js'
import {
  MultiAgentInitializedEvent,
  AfterNodeCallEvent,
  AfterMultiAgentInvocationEvent,
} from '../multiagent/hook-events.js'

/**
 * Abstract base class for session managers.
 *
 * Implements HookProvider to register callbacks for agent lifecycle events.
 * Subclasses must implement the core persistence operations: initialize,
 * appendMessage, syncAgent, and redactLatestMessage.
 */
export abstract class SessionManager implements HookProvider {
  /**
   * Registers hooks for persisting agent state to the session.
   *
   * @param registry - Hook registry to register callbacks with
   */
  registerCallbacks(registry: HookRegistry): void {
    // After agent initialization, restore state from session or create new session entry
    registry.addCallback(AgentInitializedEvent, (event: AgentInitializedEvent) => this.initialize(event.agent))

    // Persist each message added to the agent's conversation
    registry.addCallback(MessageAddedEvent, (event: MessageAddedEvent) =>
      this.appendMessage(event.message, event.agent)
    )

    // Sync agent state after each message in case state was updated
    registry.addCallback(MessageAddedEvent, (event: MessageAddedEvent) => this.syncAgent(event.agent))

    // Sync agent state after invocation to capture conversation manager state updates
    registry.addCallback(AfterInvocationEvent, (event: AfterInvocationEvent) => this.syncAgent(event.agent))

    // Multi-agent lifecycle hooks
    registry.addCallback(MultiAgentInitializedEvent, (event: MultiAgentInitializedEvent) =>
      this.initializeMultiAgent(event.source)
    )
    registry.addCallback(AfterNodeCallEvent, (event: AfterNodeCallEvent) => this.syncMultiAgent(event.source))
    registry.addCallback(AfterMultiAgentInvocationEvent, (event: AfterMultiAgentInvocationEvent) =>
      this.syncMultiAgent(event.source)
    )
  }

  /**
   * Initializes an agent with session data.
   * Restores agent state, conversation history, and conversation manager state from storage,
   * or creates a new session entry if none exists.
   *
   * @param agent - Agent to initialize
   */
  abstract initialize(agent: AgentData): Promise<void>

  /**
   * Appends a message to the agent's session storage.
   *
   * @param message - Message to persist
   * @param agent - Agent the message belongs to
   */
  abstract appendMessage(message: Message, agent: AgentData): Promise<void>

  /**
   * Serializes and syncs the agent's current state to session storage.
   *
   * @param agent - Agent to sync
   */
  abstract syncAgent(agent: AgentData): Promise<void>

  /**
   * Redacts the most recently appended message in session storage.
   *
   * @param redactMessage - Replacement message content
   * @param agent - Agent to apply the redaction to
   */
  abstract redactLatestMessage(redactMessage: Message, agent: AgentData): Promise<void>

  /**
   * Initializes multi-agent state from session, or creates a new entry.
   * Default is a no-op. Override in subclasses that support multi-agent persistence.
   *
   * @param _source - Multi-agent orchestrator source object
   */
  async initializeMultiAgent(_source: unknown): Promise<void> {}

  /**
   * Syncs multi-agent state to session storage.
   * Default is a no-op. Override in subclasses that support multi-agent persistence.
   *
   * @param _source - Multi-agent orchestrator source object
   */
  async syncMultiAgent(_source: unknown): Promise<void> {}
}
