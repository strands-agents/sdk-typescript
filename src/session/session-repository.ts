/**
 * Abstract repository interface for session storage operations.
 *
 * Defines the contract for creating, reading, updating, and listing
 * sessions, agents, and messages in persistent storage.
 */

import type { SessionAgentData, SessionData, SessionMessageData } from '../types/session.js'

/**
 * Storage backend interface for session management.
 *
 * Implement this interface to provide custom storage backends
 * (e.g., database, cloud storage, in-memory).
 */
export interface SessionRepository {
  /**
   * Creates a new session.
   *
   * @param session - Session data to create
   * @returns The created session
   */
  createSession(session: SessionData): Promise<SessionData>

  /**
   * Reads a session by ID.
   *
   * @param sessionId - Session identifier
   * @returns Session data, or null if not found
   */
  readSession(sessionId: string): Promise<SessionData | null>

  /**
   * Creates a new agent record in a session.
   *
   * @param sessionId - Session identifier
   * @param sessionAgent - Agent data to create
   */
  createAgent(sessionId: string, sessionAgent: SessionAgentData): Promise<void>

  /**
   * Reads an agent record from a session.
   *
   * @param sessionId - Session identifier
   * @param agentId - Agent identifier
   * @returns Agent data, or null if not found
   */
  readAgent(sessionId: string, agentId: string): Promise<SessionAgentData | null>

  /**
   * Updates an existing agent record in a session.
   *
   * @param sessionId - Session identifier
   * @param sessionAgent - Updated agent data
   */
  updateAgent(sessionId: string, sessionAgent: SessionAgentData): Promise<void>

  /**
   * Creates a new message for an agent in a session.
   *
   * @param sessionId - Session identifier
   * @param agentId - Agent identifier
   * @param sessionMessage - Message data to create
   */
  createMessage(sessionId: string, agentId: string, sessionMessage: SessionMessageData): Promise<void>

  /**
   * Reads a message by ID.
   *
   * @param sessionId - Session identifier
   * @param agentId - Agent identifier
   * @param messageId - Message index
   * @returns Message data, or null if not found
   */
  readMessage(sessionId: string, agentId: string, messageId: number): Promise<SessionMessageData | null>

  /**
   * Updates an existing message.
   *
   * @param sessionId - Session identifier
   * @param agentId - Agent identifier
   * @param sessionMessage - Updated message data
   */
  updateMessage(sessionId: string, agentId: string, sessionMessage: SessionMessageData): Promise<void>

  /**
   * Lists messages for an agent with pagination.
   *
   * @param sessionId - Session identifier
   * @param agentId - Agent identifier
   * @param limit - Maximum number of messages to return (undefined for all)
   * @param offset - Number of messages to skip from the beginning
   * @returns Array of session messages
   */
  listMessages(
    sessionId: string,
    agentId: string,
    limit?: number | undefined,
    offset?: number | undefined
  ): Promise<SessionMessageData[]>

  /**
   * Creates a multi-agent state record in a session.
   *
   * @param sessionId - Session identifier
   * @param multiAgentId - Multi-agent orchestrator identifier
   * @param state - Serialized multi-agent state
   */
  createMultiAgent(sessionId: string, multiAgentId: string, state: Record<string, unknown>): Promise<void>

  /**
   * Reads a multi-agent state record from a session.
   *
   * @param sessionId - Session identifier
   * @param multiAgentId - Multi-agent orchestrator identifier
   * @returns Multi-agent state or null if not found
   */
  readMultiAgent(sessionId: string, multiAgentId: string): Promise<Record<string, unknown> | null>

  /**
   * Updates a multi-agent state record in a session.
   *
   * @param sessionId - Session identifier
   * @param multiAgentId - Multi-agent orchestrator identifier
   * @param state - Updated multi-agent state
   */
  updateMultiAgent(sessionId: string, multiAgentId: string, state: Record<string, unknown>): Promise<void>
}
