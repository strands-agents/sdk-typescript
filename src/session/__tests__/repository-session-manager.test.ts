import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RepositorySessionManager } from '../repository-session-manager.js'
import type { SessionRepository } from '../session-repository.js'
import type { SessionData, SessionAgentData, SessionMessageData } from '../../types/session.js'
import { SessionException } from '../../errors.js'
import { Message, TextBlock, ToolUseBlock, ToolResultBlock } from '../../types/messages.js'
import { AgentState } from '../../agent/state.js'
import { NullConversationManager } from '../../conversation-manager/null-conversation-manager.js'
import { SlidingWindowConversationManager } from '../../conversation-manager/sliding-window-conversation-manager.js'
import type { AgentData } from '../../types/agent.js'
import type { JSONValue } from '../../types/json.js'
import { InterruptState } from '../../interrupt.js'

/**
 * In-memory SessionRepository for testing.
 * Stores all data in maps to isolate tests from I/O.
 */
class InMemoryRepository implements SessionRepository {
  sessions = new Map<string, SessionData>()
  agents = new Map<string, SessionAgentData>()
  messages = new Map<string, SessionMessageData>()
  multiAgents = new Map<string, Record<string, unknown>>()

  private _agentKey(sessionId: string, agentId: string): string {
    return `${sessionId}:${agentId}`
  }

  private _messageKey(sessionId: string, agentId: string, messageId: number): string {
    return `${sessionId}:${agentId}:${messageId}`
  }

  private _multiAgentKey(sessionId: string, multiAgentId: string): string {
    return `${sessionId}:${multiAgentId}`
  }

  async createSession(session: SessionData): Promise<SessionData> {
    this.sessions.set(session.sessionId, session)
    return session
  }

  async readSession(sessionId: string): Promise<SessionData | null> {
    return this.sessions.get(sessionId) ?? null
  }

  async createAgent(sessionId: string, agent: SessionAgentData): Promise<void> {
    this.agents.set(this._agentKey(sessionId, agent.agentId), agent)
  }

  async readAgent(sessionId: string, agentId: string): Promise<SessionAgentData | null> {
    return this.agents.get(this._agentKey(sessionId, agentId)) ?? null
  }

  async updateAgent(sessionId: string, agent: SessionAgentData): Promise<void> {
    const key = this._agentKey(sessionId, agent.agentId)
    if (!this.agents.has(key)) {
      throw new SessionException(`Agent ${agent.agentId} does not exist`)
    }
    this.agents.set(key, agent)
  }

  async createMessage(sessionId: string, agentId: string, message: SessionMessageData): Promise<void> {
    this.messages.set(this._messageKey(sessionId, agentId, message.messageId), message)
  }

  async readMessage(sessionId: string, agentId: string, messageId: number): Promise<SessionMessageData | null> {
    return this.messages.get(this._messageKey(sessionId, agentId, messageId)) ?? null
  }

  async updateMessage(sessionId: string, agentId: string, message: SessionMessageData): Promise<void> {
    const key = this._messageKey(sessionId, agentId, message.messageId)
    if (!this.messages.has(key)) {
      throw new SessionException(`Message ${message.messageId} does not exist`)
    }
    this.messages.set(key, message)
  }

  async listMessages(
    sessionId: string,
    agentId: string,
    limit?: number | undefined,
    offset?: number | undefined
  ): Promise<SessionMessageData[]> {
    const prefix = `${sessionId}:${agentId}:`
    const messages = [...this.messages.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value)
      .sort((a, b) => a.messageId - b.messageId)

    const startOffset = offset ?? 0
    if (limit !== undefined) {
      return messages.slice(startOffset, startOffset + limit)
    }
    return messages.slice(startOffset)
  }

  async createMultiAgent(sessionId: string, multiAgentId: string, state: Record<string, unknown>): Promise<void> {
    this.multiAgents.set(this._multiAgentKey(sessionId, multiAgentId), state)
  }

  async readMultiAgent(sessionId: string, multiAgentId: string): Promise<Record<string, unknown> | null> {
    return this.multiAgents.get(this._multiAgentKey(sessionId, multiAgentId)) ?? null
  }

  async updateMultiAgent(sessionId: string, multiAgentId: string, state: Record<string, unknown>): Promise<void> {
    const key = this._multiAgentKey(sessionId, multiAgentId)
    if (!this.multiAgents.has(key)) {
      throw new SessionException(`Multi-agent ${multiAgentId} does not exist`)
    }
    this.multiAgents.set(key, state)
  }
}

function createMockAgent(agentId: string, messages: Message[] = []): AgentData {
  return {
    agentId,
    state: new AgentState(),
    messages,
    conversationManager: new NullConversationManager(),
  }
}

describe('RepositorySessionManager', () => {
  const sessionId = 'test-session'
  let repo: InMemoryRepository

  beforeEach(() => {
    repo = new InMemoryRepository()
  })

  function createManager(): RepositorySessionManager {
    return new RepositorySessionManager({ sessionId, sessionRepository: repo })
  }

  describe('initialize', () => {
    it('creates session if it does not exist', async () => {
      const manager = createManager()
      const agent = createMockAgent('agent-1')

      await manager.initialize(agent)

      expect(repo.sessions.has(sessionId)).toBe(true)
    })

    it('uses existing session if present', async () => {
      const manager = createManager()
      const now = new Date().toISOString()
      await repo.createSession({ sessionId, sessionType: 'AGENT', createdAt: now, updatedAt: now })

      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      // Should not throw or duplicate
      expect(repo.sessions.size).toBe(1)
    })

    it('creates new agent entry for unknown agent', async () => {
      const manager = createManager()
      const agent = createMockAgent('agent-1')

      await manager.initialize(agent)

      const savedAgent = await repo.readAgent(sessionId, 'agent-1')
      expect(savedAgent).not.toBeNull()
      expect(savedAgent!.agentId).toBe('agent-1')
    })

    it('persists existing agent messages on first initialization', async () => {
      const manager = createManager()
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Hello')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Hi there')] }),
      ]
      const agent = createMockAgent('agent-1', messages)

      await manager.initialize(agent)

      const stored = await repo.listMessages(sessionId, 'agent-1')
      expect(stored).toHaveLength(2)
      expect(stored[0]!.messageId).toBe(0)
      expect(stored[1]!.messageId).toBe(1)
    })

    it('restores agent state from existing session', async () => {
      const manager = createManager()

      // First: create an agent session with some state and messages
      const now = new Date().toISOString()
      await repo.createSession({ sessionId, sessionType: 'AGENT', createdAt: now, updatedAt: now })
      await repo.createAgent(sessionId, {
        agentId: 'agent-1',
        state: { savedKey: 'savedValue' },
        conversationManagerState: {},
        _internalState: {},
        createdAt: now,
        updatedAt: now,
      })
      await repo.createMessage(sessionId, 'agent-1', {
        message: { role: 'user', content: [{ type: 'textBlock', text: 'Saved message' }] },
        messageId: 0,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })

      // Initialize a fresh agent — should restore state and messages
      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      expect(agent.state.get('savedKey')).toBe('savedValue')
      expect(agent.messages).toHaveLength(1)
      expect(agent.messages[0]!.role).toBe('user')
      expect(agent.messages[0]!.content[0]!.type).toBe('textBlock')
    })

    it('restores conversation manager state from session', async () => {
      const manager = createManager()
      const now = new Date().toISOString()

      await repo.createSession({ sessionId, sessionType: 'AGENT', createdAt: now, updatedAt: now })
      await repo.createAgent(sessionId, {
        agentId: 'agent-1',
        state: {},
        conversationManagerState: { removedMessageCount: 3 },
        _internalState: {},
        createdAt: now,
        updatedAt: now,
      })

      for (let i = 0; i < 6; i++) {
        await repo.createMessage(sessionId, 'agent-1', {
          message: { role: i % 2 === 0 ? 'user' : 'assistant', content: [{ type: 'textBlock', text: `msg ${i}` }] },
          messageId: i,
          redactMessage: null,
          createdAt: now,
          updatedAt: now,
        })
      }

      // Use a mock CM that reports removedMessageCount from the restored state
      const mockCm = {
        registerCallbacks(): void {},
        getState(): Record<string, JSONValue> {
          return { removedMessageCount: 3 }
        },
        restoreFromSession(_state: Record<string, JSONValue>): Message[] | null {
          // Accept the stored state and return null (no prepend messages)
          return null
        },
      }

      const agent: AgentData = {
        agentId: 'agent-1',
        state: new AgentState(),
        messages: [],
        conversationManager: mockCm,
      }

      await manager.initialize(agent)

      // Should only load messages from offset 3 (skipping first 3 removed messages)
      expect(agent.messages).toHaveLength(3)
      // First restored message should be messageId 3
      expect(agent.messages[0]!.content[0]!.type).toBe('textBlock')
    })

    it('throws when initializing same agent ID twice', async () => {
      const manager = createManager()

      await manager.initialize(createMockAgent('agent-1'))

      await expect(manager.initialize(createMockAgent('agent-1'))).rejects.toThrow(SessionException)
      await expect(manager.initialize(createMockAgent('agent-1'))).rejects.toThrow('unique')
    })
  })

  describe('appendMessage', () => {
    it('appends messages with sequential IDs', async () => {
      const manager = createManager()
      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      const msg1 = new Message({ role: 'user', content: [new TextBlock('First')] })
      const msg2 = new Message({ role: 'assistant', content: [new TextBlock('Second')] })

      await manager.appendMessage(msg1, agent)
      await manager.appendMessage(msg2, agent)

      const stored = await repo.listMessages(sessionId, 'agent-1')
      expect(stored).toHaveLength(2)
      expect(stored[0]!.messageId).toBe(0)
      expect(stored[1]!.messageId).toBe(1)
    })

    it('continues message IDs after initialization with existing messages', async () => {
      const manager = createManager()
      const existingMessages = [new Message({ role: 'user', content: [new TextBlock('Existing')] })]
      const agent = createMockAgent('agent-1', existingMessages)
      await manager.initialize(agent)

      // Now append a new message
      const newMsg = new Message({ role: 'assistant', content: [new TextBlock('New response')] })
      await manager.appendMessage(newMsg, agent)

      const stored = await repo.listMessages(sessionId, 'agent-1')
      expect(stored).toHaveLength(2)
      expect(stored[0]!.messageId).toBe(0) // from initialization
      expect(stored[1]!.messageId).toBe(1) // newly appended
    })
  })

  describe('syncAgent', () => {
    it('persists agent state to repository', async () => {
      const manager = createManager()
      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      agent.state.set('counter', 42)
      await manager.syncAgent(agent)

      const saved = await repo.readAgent(sessionId, 'agent-1')
      expect(saved!.state).toStrictEqual({ counter: 42 })
    })

    it('persists conversation manager state', async () => {
      const manager = createManager()
      const cm = new SlidingWindowConversationManager({ windowSize: 5 })
      const agent: AgentData = {
        agentId: 'agent-1',
        state: new AgentState(),
        messages: [],
        conversationManager: cm,
      }
      await manager.initialize(agent)

      await manager.syncAgent(agent)

      const saved = await repo.readAgent(sessionId, 'agent-1')
      expect(saved!.conversationManagerState).toBeDefined()
    })
  })

  describe('redactLatestMessage', () => {
    it('redacts the most recently appended message', async () => {
      const manager = createManager()
      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      const msg = new Message({ role: 'user', content: [new TextBlock('Original content')] })
      await manager.appendMessage(msg, agent)

      const redactMsg = new Message({ role: 'user', content: [new TextBlock('[REDACTED]')] })
      await manager.redactLatestMessage(redactMsg, agent)

      const stored = await repo.readMessage(sessionId, 'agent-1', 0)
      expect(stored!.redactMessage).not.toBeNull()
      expect((stored!.redactMessage as Record<string, unknown>).role).toBe('user')
    })

    it('throws when no message has been appended', async () => {
      const manager = createManager()
      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      const redactMsg = new Message({ role: 'user', content: [new TextBlock('[REDACTED]')] })

      await expect(manager.redactLatestMessage(redactMsg, agent)).rejects.toThrow(SessionException)
      await expect(manager.redactLatestMessage(redactMsg, agent)).rejects.toThrow('No message to redact')
    })
  })

  describe('registerCallbacks', () => {
    it('registers hooks for agent lifecycle events', () => {
      const manager = createManager()
      const callbacks = new Map<string, unknown[]>()

      const mockRegistry = {
        addCallback(eventClass: { name: string }, callback: unknown): void {
          const existing = callbacks.get(eventClass.name) ?? []
          existing.push(callback)
          callbacks.set(eventClass.name, existing)
        },
      }

      manager.registerCallbacks(mockRegistry as never)

      // Should register for: AgentInitializedEvent, MessageAddedEvent (x2), AfterInvocationEvent
      expect(callbacks.get('AgentInitializedEvent')).toHaveLength(1)
      expect(callbacks.get('MessageAddedEvent')).toHaveLength(2) // appendMessage + syncAgent
      expect(callbacks.get('AfterInvocationEvent')).toHaveLength(1)
    })
  })

  describe('_fixBrokenToolUse', () => {
    it('inserts error toolResult message when next message has no toolResults', async () => {
      const manager = createManager()
      const now = new Date().toISOString()
      await repo.createSession({ sessionId, sessionType: 'AGENT', createdAt: now, updatedAt: now })
      await repo.createAgent(sessionId, {
        agentId: 'agent-1',
        state: {},
        conversationManagerState: {},
        _internalState: {},
        createdAt: now,
        updatedAt: now,
      })
      // [0] assistant: toolUse(id: 'orphaned-123')
      await repo.createMessage(sessionId, 'agent-1', {
        message: {
          role: 'assistant',
          content: [{ type: 'toolUseBlock', name: 'someTool', toolUseId: 'orphaned-123', input: {} }],
        },
        messageId: 0,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })
      // [1] user: text('Some other message')
      await repo.createMessage(sessionId, 'agent-1', {
        message: { role: 'user', content: [{ type: 'textBlock', text: 'Some other message' }] },
        messageId: 1,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })

      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      expect(agent.messages).toHaveLength(3)
      // Inserted message at [1] should be user with toolResult
      expect(agent.messages[1]!.role).toBe('user')
      expect(agent.messages[1]!.content[0]!.type).toBe('toolResultBlock')
      const resultBlock = agent.messages[1]!.content[0] as ToolResultBlock
      expect(resultBlock.toolUseId).toBe('orphaned-123')
      expect(resultBlock.status).toBe('error')
      expect(resultBlock.content[0]!.type).toBe('textBlock')
      expect((resultBlock.content[0] as TextBlock).text).toBe('Tool was interrupted.')
      // Original user message moved to [2]
      expect(agent.messages[2]!.role).toBe('user')
      expect((agent.messages[2]!.content[0] as TextBlock).text).toBe('Some other message')
    })

    it('extends existing toolResult message with missing error results', async () => {
      const manager = createManager()
      const now = new Date().toISOString()
      await repo.createSession({ sessionId, sessionType: 'AGENT', createdAt: now, updatedAt: now })
      await repo.createAgent(sessionId, {
        agentId: 'agent-1',
        state: {},
        conversationManagerState: {},
        _internalState: {},
        createdAt: now,
        updatedAt: now,
      })
      // [0] assistant: [toolUse(id: 'complete-123'), toolUse(id: 'missing-456')]
      await repo.createMessage(sessionId, 'agent-1', {
        message: {
          role: 'assistant',
          content: [
            { type: 'toolUseBlock', name: 'tool1', toolUseId: 'complete-123', input: {} },
            { type: 'toolUseBlock', name: 'tool2', toolUseId: 'missing-456', input: {} },
          ],
        },
        messageId: 0,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })
      // [1] user: [toolResult(toolUseId: 'complete-123', status: 'success')]
      await repo.createMessage(sessionId, 'agent-1', {
        message: {
          role: 'user',
          content: [
            {
              type: 'toolResultBlock',
              toolUseId: 'complete-123',
              status: 'success',
              content: [{ type: 'textBlock', text: 'Result' }],
            },
          ],
        },
        messageId: 1,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })

      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      expect(agent.messages).toHaveLength(2) // No insertion, extended existing
      expect(agent.messages[1]!.content).toHaveLength(2)
      const toolUseIds = agent.messages[1]!.content.filter(
        (b): b is ToolResultBlock => b.type === 'toolResultBlock'
      ).map((b) => b.toolUseId)
      expect(new Set(toolUseIds)).toStrictEqual(new Set(['complete-123', 'missing-456']))
      const missingResult = agent.messages[1]!.content.find(
        (b): b is ToolResultBlock => b.type === 'toolResultBlock' && b.toolUseId === 'missing-456'
      )!
      expect(missingResult.status).toBe('error')
      expect((missingResult.content[0] as TextBlock).text).toBe('Tool was interrupted.')
    })

    it('handles multiple orphaned toolUse blocks in one message', async () => {
      const manager = createManager()
      const now = new Date().toISOString()
      await repo.createSession({ sessionId, sessionType: 'AGENT', createdAt: now, updatedAt: now })
      await repo.createAgent(sessionId, {
        agentId: 'agent-1',
        state: {},
        conversationManagerState: {},
        _internalState: {},
        createdAt: now,
        updatedAt: now,
      })
      await repo.createMessage(sessionId, 'agent-1', {
        message: {
          role: 'assistant',
          content: [
            { type: 'toolUseBlock', name: 'tool1', toolUseId: 'orphaned-123', input: {} },
            { type: 'toolUseBlock', name: 'tool2', toolUseId: 'orphaned-456', input: {} },
          ],
        },
        messageId: 0,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })
      await repo.createMessage(sessionId, 'agent-1', {
        message: { role: 'user', content: [{ type: 'textBlock', text: 'Next message' }] },
        messageId: 1,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })

      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      expect(agent.messages).toHaveLength(3) // Inserted one user message
      expect(agent.messages[1]!.content).toHaveLength(2)
      const toolUseIds = agent.messages[1]!.content.filter(
        (b): b is ToolResultBlock => b.type === 'toolResultBlock'
      ).map((b) => b.toolUseId)
      expect(new Set(toolUseIds)).toStrictEqual(new Set(['orphaned-123', 'orphaned-456']))
    })

    it('does not fix orphaned toolUse in the last message', async () => {
      const manager = createManager()
      const now = new Date().toISOString()
      await repo.createSession({ sessionId, sessionType: 'AGENT', createdAt: now, updatedAt: now })
      await repo.createAgent(sessionId, {
        agentId: 'agent-1',
        state: {},
        conversationManagerState: {},
        _internalState: {},
        createdAt: now,
        updatedAt: now,
      })
      await repo.createMessage(sessionId, 'agent-1', {
        message: { role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] },
        messageId: 0,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })
      await repo.createMessage(sessionId, 'agent-1', {
        message: {
          role: 'assistant',
          content: [{ type: 'toolUseBlock', name: 'tool1', toolUseId: 'last-message-123', input: {} }],
        },
        messageId: 1,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })

      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      expect(agent.messages).toHaveLength(2) // Unchanged
      expect(agent.messages[1]!.content[0]!.type).toBe('toolUseBlock')
    })

    it('passes through well-formed messages unchanged', async () => {
      const manager = createManager()
      const now = new Date().toISOString()
      await repo.createSession({ sessionId, sessionType: 'AGENT', createdAt: now, updatedAt: now })
      await repo.createAgent(sessionId, {
        agentId: 'agent-1',
        state: {},
        conversationManagerState: {},
        _internalState: {},
        createdAt: now,
        updatedAt: now,
      })
      await repo.createMessage(sessionId, 'agent-1', {
        message: { role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] },
        messageId: 0,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })
      await repo.createMessage(sessionId, 'agent-1', {
        message: {
          role: 'assistant',
          content: [{ type: 'toolUseBlock', name: 'tool1', toolUseId: 'tu-123', input: {} }],
        },
        messageId: 1,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })
      await repo.createMessage(sessionId, 'agent-1', {
        message: {
          role: 'user',
          content: [
            {
              type: 'toolResultBlock',
              toolUseId: 'tu-123',
              status: 'success',
              content: [{ type: 'textBlock', text: 'Result' }],
            },
          ],
        },
        messageId: 2,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })

      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      expect(agent.messages).toHaveLength(3) // Unchanged
      expect(agent.messages[0]!.content[0]!.type).toBe('textBlock')
      expect(agent.messages[1]!.content[0]!.type).toBe('toolUseBlock')
      expect(agent.messages[2]!.content[0]!.type).toBe('toolResultBlock')
    })

    it('removes orphaned toolResult message at the start', async () => {
      const manager = createManager()
      const now = new Date().toISOString()
      await repo.createSession({ sessionId, sessionType: 'AGENT', createdAt: now, updatedAt: now })
      await repo.createAgent(sessionId, {
        agentId: 'agent-1',
        state: {},
        conversationManagerState: {},
        _internalState: {},
        createdAt: now,
        updatedAt: now,
      })
      // [0] user: toolResult(toolUseId: 'orphaned-from-pagination')
      await repo.createMessage(sessionId, 'agent-1', {
        message: {
          role: 'user',
          content: [
            {
              type: 'toolResultBlock',
              toolUseId: 'orphaned-from-pagination',
              status: 'success',
              content: [{ type: 'textBlock', text: 'Stale result' }],
            },
          ],
        },
        messageId: 0,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })
      // [1] user: text('Hello')
      await repo.createMessage(sessionId, 'agent-1', {
        message: { role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] },
        messageId: 1,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })
      // [2] assistant: text('Hi')
      await repo.createMessage(sessionId, 'agent-1', {
        message: { role: 'assistant', content: [{ type: 'textBlock', text: 'Hi' }] },
        messageId: 2,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })

      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      expect(agent.messages).toHaveLength(2) // First message removed
      expect(agent.messages[0]!.role).toBe('user')
      expect((agent.messages[0]!.content[0] as TextBlock).text).toBe('Hello')
    })

    it('handles empty messages array', async () => {
      const manager = createManager()
      const now = new Date().toISOString()
      await repo.createSession({ sessionId, sessionType: 'AGENT', createdAt: now, updatedAt: now })
      await repo.createAgent(sessionId, {
        agentId: 'agent-1',
        state: {},
        conversationManagerState: {},
        _internalState: {},
        createdAt: now,
        updatedAt: now,
      })
      // No messages stored

      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      expect(agent.messages).toHaveLength(0)
    })
  })

  describe('message content roundtrip', () => {
    it('roundtrips text messages through session storage', async () => {
      const manager = createManager()
      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      const msg = new Message({ role: 'user', content: [new TextBlock('Hello world')] })
      await manager.appendMessage(msg, agent)

      // Simulate restoration: create new agent and initialize
      const manager2 = new RepositorySessionManager({ sessionId, sessionRepository: repo })
      const agent2 = createMockAgent('agent-2') // Different ID to avoid duplicate check
      await manager2.initialize(agent2)

      // Read messages directly from repo
      const stored = await repo.listMessages(sessionId, 'agent-1')
      expect(stored).toHaveLength(1)
      expect((stored[0]!.message as Record<string, unknown>).role).toBe('user')
    })

    it('roundtrips tool use messages through session storage', async () => {
      const manager = createManager()
      const agent = createMockAgent('agent-1')
      await manager.initialize(agent)

      const msg = new Message({
        role: 'assistant',
        content: [
          new TextBlock('Let me use a tool'),
          new ToolUseBlock({ name: 'calculator', toolUseId: 'tu-1', input: { a: 1, b: 2 } }),
        ],
      })
      await manager.appendMessage(msg, agent)

      const stored = await repo.listMessages(sessionId, 'agent-1')
      const content = (stored[0]!.message as Record<string, unknown>).content as Array<Record<string, unknown>>
      expect(content).toHaveLength(2)
      expect(content[0]!.type).toBe('textBlock')
      expect(content[1]!.type).toBe('toolUseBlock')
      expect(content[1]!.name).toBe('calculator')
    })
  })

  describe('interrupt state persistence', () => {
    it('restores interrupt state from existing session', async () => {
      const manager = createManager()
      const now = new Date().toISOString()
      await repo.createSession({ sessionId, sessionType: 'AGENT', createdAt: now, updatedAt: now })
      await repo.createAgent(sessionId, {
        agentId: 'agent-1',
        state: { key: 'value' },
        conversationManagerState: {},
        _internalState: {
          interruptState: {
            interrupts: {},
            context: { test: 'init' },
            activated: false,
          },
        },
        createdAt: now,
        updatedAt: now,
      })
      await repo.createMessage(sessionId, 'agent-1', {
        message: { role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] },
        messageId: 0,
        redactMessage: null,
        createdAt: now,
        updatedAt: now,
      })

      const agent = createMockAgent('agent-1')
      ;(agent as unknown as { _interruptState: InterruptState })._interruptState = new InterruptState()

      await manager.initialize(agent)

      const restored = (agent as unknown as { _interruptState: InterruptState })._interruptState
      expect(restored.context).toStrictEqual({ test: 'init' })
      expect(restored.activated).toBe(false)
    })

    it('syncAgent persists interrupt state', async () => {
      const manager = createManager()
      const agent = createMockAgent('agent-1')
      const interruptState = new InterruptState()
      interruptState.activate()
      interruptState.context = { tool: 'calculator' }
      ;(agent as unknown as { _interruptState: InterruptState })._interruptState = interruptState

      await manager.initialize(agent)
      await manager.syncAgent(agent)

      const saved = await repo.readAgent(sessionId, 'agent-1')
      expect(saved!._internalState).toBeDefined()
      expect(saved!._internalState.interruptState).toStrictEqual({
        interrupts: {},
        context: { tool: 'calculator' },
        activated: true,
      })
    })

    it('round-trips interrupt state through sync and initialize', async () => {
      const manager = createManager()
      const agent = createMockAgent('agent-1')
      const interruptState = new InterruptState()
      interruptState.activate()
      interruptState.context = { resumeKey: 'abc123' }
      ;(agent as unknown as { _interruptState: InterruptState })._interruptState = interruptState

      await manager.initialize(agent)
      await manager.syncAgent(agent)

      const saved = await repo.readAgent(sessionId, 'agent-1')
      expect(saved!._internalState.interruptState).toStrictEqual({
        interrupts: {},
        context: { resumeKey: 'abc123' },
        activated: true,
      })
    })
  })

  describe('multi-agent persistence', () => {
    it('initializeMultiAgent creates new state when not found', async () => {
      const manager = createManager()
      const mockMultiAgent = {
        id: 'test-multi-agent',
        serializeState: (): Record<string, unknown> => ({ id: 'test-multi-agent', state: { key: 'value' } }),
        deserializeState: vi.fn(),
      }

      await manager.initializeMultiAgent(mockMultiAgent)

      const state = await repo.readMultiAgent(sessionId, mockMultiAgent.id)
      expect(state).toStrictEqual({ id: 'test-multi-agent', state: { key: 'value' } })
      expect(mockMultiAgent.deserializeState).not.toHaveBeenCalled()
    })

    it('initializeMultiAgent restores existing state via deserializeState', async () => {
      const manager = createManager()
      const existingState = { id: 'test-multi-agent', state: { restored: 'data' } }
      await repo.createMultiAgent(sessionId, 'test-multi-agent', existingState)

      const mockMultiAgent = {
        id: 'test-multi-agent',
        serializeState: (): Record<string, unknown> => ({ id: 'test-multi-agent', state: { key: 'value' } }),
        deserializeState: vi.fn(),
      }

      await manager.initializeMultiAgent(mockMultiAgent)

      expect(mockMultiAgent.deserializeState).toHaveBeenCalledWith(existingState)
    })

    it('syncMultiAgent persists state via updateMultiAgent', async () => {
      const manager = createManager()
      const mockMultiAgent = {
        id: 'test-multi-agent',
        serializeState: (): Record<string, unknown> => ({ id: 'test-multi-agent', state: { updated: true } }),
        deserializeState: vi.fn(),
      }

      await repo.createMultiAgent(sessionId, mockMultiAgent.id, { id: 'test-multi-agent', state: { old: true } })
      await manager.syncMultiAgent(mockMultiAgent)

      const state = await repo.readMultiAgent(sessionId, mockMultiAgent.id)
      expect(state).toStrictEqual({ id: 'test-multi-agent', state: { updated: true } })
    })
  })
})
