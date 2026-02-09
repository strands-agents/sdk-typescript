/**
 * Repository-based session manager implementation.
 *
 * Implements core session logic and delegates storage operations
 * to a SessionRepository implementation.
 */

import type { AgentData } from '../types/agent.js'
import type { Message } from '../types/messages.js'
import type { SessionMessageData } from '../types/session.js'
import type { SessionRepository } from './session-repository.js'
import { SessionManager } from './session-manager.js'
import { SessionException } from '../errors.js'
import { AgentState } from '../agent/state.js'
import { InterruptState } from '../interrupt.js'
import type { InterruptStateData } from '../interrupt.js'
import type { MultiAgentBase } from '../multiagent/base.js'
import {
  createSession,
  createSessionAgent,
  createSessionMessage,
  sessionMessageToRecord,
  SESSION_TYPE_AGENT,
} from '../types/session.js'
import {
  Message as MessageClass,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  JsonBlock,
  contentBlockFromData,
} from '../types/messages.js'
import type { ContentBlock, ContentBlockData, ToolResultContent } from '../types/messages.js'
import type { JSONValue } from '../types/json.js'

/**
 * Configuration for RepositorySessionManager.
 */
export interface RepositorySessionManagerConfig {
  /**
   * Unique session identifier.
   */
  sessionId: string

  /**
   * Storage backend to use for persistence.
   * When omitted, the instance itself must implement SessionRepository
   * (used by FileSessionManager and S3SessionManager which are their own repositories).
   */
  sessionRepository?: SessionRepository | undefined
}

/**
 * Session manager that delegates storage to a SessionRepository.
 *
 * Provides core session lifecycle management: initialization, message
 * appending, agent syncing, and message redaction. Storage is handled
 * by the provided SessionRepository implementation.
 *
 * Subclasses that implement SessionRepository themselves (such as
 * FileSessionManager and S3SessionManager) can omit `sessionRepository`
 * from the config — the base class will use `this` as the repository.
 */
export class RepositorySessionManager extends SessionManager {
  /** @internal */
  protected readonly _sessionRepository: SessionRepository
  /** @internal */
  protected readonly _sessionId: string
  /** @internal */
  private readonly _latestAgentMessage: Map<string, SessionMessageData | null> = new Map()

  constructor(config: RepositorySessionManagerConfig) {
    super()
    // When no repository is provided, the subclass IS the repository (self-referential pattern).
    // This is safe because all repository methods exist on the prototype by construction time.
    this._sessionRepository =
      config.sessionRepository ?? (this as unknown as RepositorySessionManager & SessionRepository)
    this._sessionId = config.sessionId
  }

  /**
   * Ensures the session exists in storage, creating it if needed.
   * Called internally before first use.
   */
  private async _ensureSession(): Promise<void> {
    const existing = await this._sessionRepository.readSession(this._sessionId)
    if (existing === null) {
      const session = createSession(this._sessionId, SESSION_TYPE_AGENT)
      await this._sessionRepository.createSession(session)
    }
  }

  /**
   * Initializes an agent with session data.
   *
   * If the agent already exists in the session, restores its state,
   * conversation manager state, and message history. Otherwise, creates
   * a new agent entry and persists the agent's current messages.
   *
   * @param agent - Agent to initialize
   */
  async initialize(agent: AgentData): Promise<void> {
    await this._ensureSession()

    if (this._latestAgentMessage.has(agent.agentId)) {
      throw new SessionException('The `agentId` of an agent must be unique in a session.')
    }
    this._latestAgentMessage.set(agent.agentId, null)

    const sessionAgent = await this._sessionRepository.readAgent(this._sessionId, agent.agentId)

    if (sessionAgent === null) {
      const agentWithInterrupt = agent as unknown as { _interruptState?: InterruptState }
      const internalState: Record<string, unknown> = {}
      if (agentWithInterrupt._interruptState?.activated) {
        internalState.interruptState = agentWithInterrupt._interruptState.toDict()
      }
      const newSessionAgent = createSessionAgent(
        agent.agentId,
        agent.state.getAll(),
        agent.conversationManager.getState(),
        internalState
      )
      await this._sessionRepository.createAgent(this._sessionId, newSessionAgent)

      // Persist existing messages with sequential IDs
      let lastMessage: SessionMessageData | null = null
      for (const [i, message] of agent.messages.entries()) {
        const sessionMessage = createSessionMessage(message, i)
        await this._sessionRepository.createMessage(this._sessionId, agent.agentId, sessionMessage)
        lastMessage = sessionMessage
      }
      this._latestAgentMessage.set(agent.agentId, lastMessage)
    } else {
      // Restore agent state
      agent.state = new AgentState(sessionAgent.state)

      // Restore interrupt state
      if (sessionAgent._internalState?.interruptState) {
        const restoredState = InterruptState.fromDict(sessionAgent._internalState.interruptState as InterruptStateData)
        const agentWithRestore = agent as unknown as {
          _restoreInterruptState?: (s: InterruptState) => void
          _interruptState?: InterruptState
        }
        if (agentWithRestore._restoreInterruptState) {
          agentWithRestore._restoreInterruptState(restoredState)
        } else if (agentWithRestore._interruptState !== undefined) {
          agentWithRestore._interruptState = restoredState
        }
      }

      // Restore conversation manager state and get optional prepend messages
      const prependMessages = agent.conversationManager.restoreFromSession(sessionAgent.conversationManagerState) ?? []

      // List messages from session storage
      const removedMessageCount = this._getRemovedMessageCount(agent)
      const sessionMessages = await this._sessionRepository.listMessages(
        this._sessionId,
        agent.agentId,
        undefined,
        removedMessageCount
      )

      if (sessionMessages.length > 0) {
        this._latestAgentMessage.set(agent.agentId, sessionMessages[sessionMessages.length - 1] ?? null)
      }

      // Restore the agent's message array
      const restoredMessages = sessionMessages.map((sm) => recordToMessage(sessionMessageToRecord(sm)))
      agent.messages.length = 0
      for (const msg of [...prependMessages, ...restoredMessages]) {
        agent.messages.push(msg)
      }

      // Repair orphaned tool use/result pairs from corrupt or legacy sessions
      this._fixBrokenToolUse(agent.messages)
    }
  }

  /**
   * Appends a message to the agent's session storage.
   *
   * @param message - Message to persist
   * @param agent - Agent the message belongs to
   */
  async appendMessage(message: Message, agent: AgentData): Promise<void> {
    const latestMessage = this._latestAgentMessage.get(agent.agentId)
    const nextIndex = latestMessage !== undefined && latestMessage !== null ? latestMessage.messageId + 1 : 0

    const sessionMessage = createSessionMessage(message, nextIndex)
    this._latestAgentMessage.set(agent.agentId, sessionMessage)
    await this._sessionRepository.createMessage(this._sessionId, agent.agentId, sessionMessage)
  }

  /**
   * Syncs agent state and conversation manager state to session storage.
   *
   * @param agent - Agent to sync
   */
  async syncAgent(agent: AgentData): Promise<void> {
    const agentWithInterrupt = agent as unknown as { _interruptState?: InterruptState }
    const internalState: Record<string, unknown> = {}
    if (agentWithInterrupt._interruptState) {
      internalState.interruptState = agentWithInterrupt._interruptState.toDict()
    }
    const sessionAgent = createSessionAgent(
      agent.agentId,
      agent.state.getAll(),
      agent.conversationManager.getState(),
      internalState
    )
    await this._sessionRepository.updateAgent(this._sessionId, sessionAgent)
  }

  /**
   * Redacts the most recently appended message.
   *
   * @param redactMessage - Replacement message
   * @param agent - Agent to apply redaction to
   */
  async redactLatestMessage(redactMessage: Message, agent: AgentData): Promise<void> {
    const latestMessage = this._latestAgentMessage.get(agent.agentId)
    if (latestMessage === undefined || latestMessage === null) {
      throw new SessionException('No message to redact.')
    }

    latestMessage.redactMessage = {
      role: redactMessage.role,
      content: redactMessage.content.map((block) => {
        const result: Record<string, unknown> = { type: block.type }
        for (const [key, value] of Object.entries(block)) {
          if (key !== 'type') {
            result[key] = value
          }
        }
        return result
      }),
    }
    latestMessage.updatedAt = new Date().toISOString()
    await this._sessionRepository.updateMessage(this._sessionId, agent.agentId, latestMessage)
  }

  /**
   * Initializes multi-agent state from session, or creates a new entry.
   *
   * @param source - Multi-agent orchestrator source object
   */
  override async initializeMultiAgent(source: unknown): Promise<void> {
    await this._ensureSession()
    const multiAgent = source as MultiAgentBase
    const existing = await this._sessionRepository.readMultiAgent(this._sessionId, multiAgent.id)
    if (existing !== null) {
      multiAgent.deserializeState(existing)
    } else {
      await this._sessionRepository.createMultiAgent(this._sessionId, multiAgent.id, multiAgent.serializeState())
    }
  }

  /**
   * Syncs multi-agent state to session storage.
   *
   * @param source - Multi-agent orchestrator source object
   */
  override async syncMultiAgent(source: unknown): Promise<void> {
    const multiAgent = source as MultiAgentBase
    const state = multiAgent.serializeState()
    await this._sessionRepository.updateMultiAgent(this._sessionId, multiAgent.id, state)
  }

  /**
   * Repairs broken tool use/result pairs in restored message history.
   *
   * Handles two issues:
   * 1. Orphaned toolResult at the start of messages (from pagination truncation) — removed
   * 2. Orphaned toolUse without corresponding toolResult — error placeholder added
   *
   * The last message is deliberately not fixed; orphaned toolUse in the final
   * position is handled by the agent class during execution.
   *
   * @param messages - Message history to repair (mutated in place)
   * @returns Repaired message array
   */
  private _fixBrokenToolUse(messages: MessageClass[]): MessageClass[] {
    if (messages.length === 0) return messages

    // 1. Remove orphaned toolResult at the start
    const first = messages[0]!
    if (first.role === 'user' && first.content.some((block) => block.type === 'toolResultBlock')) {
      messages.shift()
    }

    // 2. Fix orphaned toolUse messages (all except the last message)
    for (let i = 0; i < messages.length; i++) {
      if (i + 1 >= messages.length) break // Skip last message

      const message = messages[i]!
      const hasToolUse = message.content.some((block) => block.type === 'toolUseBlock')
      if (!hasToolUse) continue

      const toolUseIds = message.content
        .filter((block): block is ToolUseBlock => block.type === 'toolUseBlock')
        .map((block) => block.toolUseId)

      const nextMessage = messages[i + 1]!
      const toolResultIds = new Set(
        nextMessage.content
          .filter((block): block is ToolResultBlock => block.type === 'toolResultBlock')
          .map((block) => block.toolUseId)
      )

      const missingIds = toolUseIds.filter((id) => !toolResultIds.has(id))

      if (missingIds.length > 0) {
        const errorResults = missingIds.map(
          (toolUseId) =>
            new ToolResultBlock({
              toolUseId,
              status: 'error',
              content: [new TextBlock('Tool was interrupted.')],
            })
        )

        if (toolResultIds.size > 0) {
          // Next message already has some toolResults — extend it
          ;(nextMessage.content as import('../types/messages.js').ContentBlock[]).push(...errorResults)
        } else {
          // Next message is not a toolResult message — insert one
          messages.splice(i + 1, 0, new MessageClass({ role: 'user', content: errorResults }))
        }
      }
    }

    return messages
  }

  /**
   * Gets the number of messages removed by the conversation manager.
   * Used as offset when listing messages from storage.
   */
  private _getRemovedMessageCount(agent: AgentData): number {
    const state = agent.conversationManager.getState()
    if (typeof state.removedMessageCount === 'number') {
      return state.removedMessageCount
    }
    return 0
  }
}

/**
 * Converts a flat content block record back to a ContentBlock instance.
 *
 * Handles both the flat format produced by messageToRecord and the nested ContentBlockData format.
 */
function recordToContentBlock(record: Record<string, unknown>): ContentBlock {
  const type = record.type as string | undefined

  if (type === 'toolUseBlock') {
    return new ToolUseBlock({
      name: record.name as string,
      toolUseId: record.toolUseId as string,
      input: record.input as JSONValue,
    })
  }

  if (type === 'toolResultBlock') {
    const contentArray = (record.content as Array<Record<string, unknown>>) ?? []
    const content: ToolResultContent[] = contentArray.map((item) => {
      if (item.type === 'textBlock' || 'text' in item) {
        return new TextBlock(item.text as string)
      }
      if (item.type === 'jsonBlock' || 'json' in item) {
        return new JsonBlock({ json: item.json as JSONValue })
      }
      throw new Error(`Unknown ToolResultContent type: ${JSON.stringify(item)}`)
    })

    return new ToolResultBlock({
      toolUseId: record.toolUseId as string,
      status: record.status as 'success' | 'error',
      content,
    })
  }

  // Fall back to contentBlockFromData for all other types (text, reasoning, cache, etc.)
  return contentBlockFromData(record as ContentBlockData)
}

/**
 * Converts a plain record back to a Message instance.
 */
function recordToMessage(record: Record<string, unknown>): MessageClass {
  const role = record.role as string
  const contentArray = record.content as Array<Record<string, unknown>>
  const contentBlocks = contentArray.map(recordToContentBlock)

  return new MessageClass({ role: role as 'user' | 'assistant', content: contentBlocks })
}
