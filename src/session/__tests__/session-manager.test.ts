import { describe, expect, it, beforeEach, vi } from 'vitest'
import { SessionManager } from '../session-manager.js'
import { MockSnapshotStorage, createTestSnapshot } from '../../__fixtures__/mock-storage-provider.js'
import {
  HookRegistry,
  InitializedEvent,
  MessageAddedEvent,
  MessageUpdatedEvent,
  AfterInvocationEvent,
} from '../../hooks/index.js'
import { Agent } from '../../agent/agent.js'
import { Message, TextBlock } from '../../types/messages.js'

// Test fixtures
function createMockAgent(agentId = 'default'): Agent {
  const agent = {
    agentId,
    messages: [],
    state: {
      _m: new Map(),
      get(k: string) {
        return this._m.get(k)
      },
      set(k: string, v: unknown) {
        this._m.set(k, v)
      },
      toJSON() {
        return Object.fromEntries(this._m)
      },
      loadStateFromJson(json: Record<string, unknown>) {
        Object.entries(json).forEach(([k, v]) => this._m.set(k, v))
      },
    } as any,
    systemPrompt: 'Test prompt',
  } as unknown as Agent
  return agent
}

const MOCK_MESSAGE = new Message({ role: 'user', content: [new TextBlock('test')] })

function createMockEvent(agent: Agent) {
  return { agent }
}

function createMockMessageEvent(agent: Agent) {
  return { agent, message: MOCK_MESSAGE }
}

describe('SessionManager', () => {
  let storage: MockSnapshotStorage
  let sessionManager: SessionManager
  let registry: HookRegistry
  let mockAgent: Agent

  beforeEach(() => {
    storage = new MockSnapshotStorage()
    mockAgent = createMockAgent()
    registry = new HookRegistry()
  })

  describe('constructor', () => {
    it('defaults saveLatestOn to invocation', async () => {
      sessionManager = new SessionManager({ sessionId: 'test-default', storage: { snapshot: storage } })
      sessionManager.registerCallbacks(registry)

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      const snapshot = await storage.loadSnapshot({
        location: { sessionId: 'test-default', scope: 'agent', scopeId: 'default' },
      })
      expect(snapshot).not.toBeNull()
    })
  })

  describe('saveSnapshot', () => {
    beforeEach(() => {
      mockAgent = createMockAgent('test-agent')
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
      })
    })

    it('saves snapshot_latest when isLatest is true', async () => {
      await sessionManager.saveSnapshot({ target: mockAgent, isLatest: true })

      const snapshot = await storage.loadSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(snapshot).not.toBeNull()
      expect(snapshot?.scope).toBe('agent')
    })

    it('saves immutable snapshot when isLatest is false', async () => {
      await sessionManager.saveSnapshot({ target: mockAgent, isLatest: false })

      const ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids.length).toBeGreaterThan(0)
    })

    it('allocates unique snapshot IDs', async () => {
      await sessionManager.saveSnapshot({ target: mockAgent, isLatest: false })
      await sessionManager.saveSnapshot({ target: mockAgent, isLatest: false })
      await sessionManager.saveSnapshot({ target: mockAgent, isLatest: false })

      const ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids.length).toBe(3)
    })
  })

  describe('restoreSnapshot', () => {
    beforeEach(() => {
      mockAgent = createMockAgent('test-agent')
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
      })
    })

    it('restores snapshot_latest when no snapshotId provided', async () => {
      const snapshot = createTestSnapshot()
      await storage.saveSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
        snapshotId: 'latest',
        isLatest: true,
        snapshot,
      })

      const result = await sessionManager.restoreSnapshot({ target: mockAgent })

      expect(result).toBe(true)
    })

    it('restores specific snapshot by ID', async () => {
      const snapshot = createTestSnapshot()
      await storage.saveSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
        snapshotId: '5',
        isLatest: false,
        snapshot,
      })

      const result = await sessionManager.restoreSnapshot({ target: mockAgent, snapshotId: '5' })

      expect(result).toBe(true)
    })

    it('returns false when snapshot not found', async () => {
      const result = await sessionManager.restoreSnapshot({ target: mockAgent, snapshotId: '999' })

      expect(result).toBe(false)
    })
  })

  describe('InitializedEvent handling', () => {
    beforeEach(() => {
      mockAgent = createMockAgent('test-agent')
    })

    it('loads snapshot_latest on initialization', async () => {
      const snapshot = createTestSnapshot()
      await storage.saveSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
        snapshotId: 'latest',
        isLatest: true,
        snapshot,
      })

      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
      })
      sessionManager.registerCallbacks(registry)

      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      expect(mockAgent.messages).toEqual(snapshot.data.messages)
    })

    it('handles missing snapshot gracefully', async () => {
      sessionManager = new SessionManager({
        sessionId: 'new-session',
        storage: { snapshot: storage },
      })
      sessionManager.registerCallbacks(registry)

      await expect(registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))).resolves.not.toThrow()
    })
  })

  describe('MessageAddedEvent handling', () => {
    beforeEach(() => {
      mockAgent = createMockAgent('test-agent')
    })

    it('saves snapshot_latest when saveLatestOn is message', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'message',
      })
      sessionManager.registerCallbacks(registry)

      await registry.invokeCallbacks(new MessageAddedEvent(createMockMessageEvent(mockAgent)))

      const snapshot = await storage.loadSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(snapshot).not.toBeNull()
    })

    it('does not save when saveLatestOn is invocation', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'invocation',
      })
      sessionManager.registerCallbacks(registry)

      await registry.invokeCallbacks(new MessageAddedEvent(createMockMessageEvent(mockAgent)))

      const snapshot = await storage.loadSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(snapshot).toBeNull()
    })
  })

  describe('AfterInvocationEvent handling', () => {
    beforeEach(() => {
      mockAgent = createMockAgent('test-agent')
    })

    it('saves snapshot_latest when saveLatestOn is invocation', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'invocation',
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      const snapshot = await storage.loadSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(snapshot).not.toBeNull()
    })

    it('does not save snapshot_latest when saveLatestOn is trigger', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'trigger',
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      const snapshot = await storage.loadSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(snapshot).toBeNull()
    })
  })

  describe('snapshotTrigger', () => {
    beforeEach(() => {
      mockAgent = createMockAgent('test-agent')
    })

    it('creates immutable snapshot when trigger returns true', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'trigger',
        snapshotTrigger: () => true,
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      const ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids.length).toBe(1)
    })

    it('does not create immutable snapshot when trigger returns false', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'trigger',
        snapshotTrigger: () => false,
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      const ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids.length).toBe(0)
    })

    it('provides agentData to trigger', async () => {
      const triggerSpy = vi.fn(() => false)
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'trigger',
        snapshotTrigger: triggerSpy,
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      expect(triggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentData: {
            state: mockAgent.state,
            messages: mockAgent.messages,
          },
        })
      )
    })

    it('saves both immutable and latest when trigger fires', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'trigger',
        snapshotTrigger: () => true,
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      const immutableIds = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      const latest = await storage.loadSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })

      expect(immutableIds.length).toBe(1)
      expect(latest).not.toBeNull()
    })

    it('trigger based on message count via agentData', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'trigger',
        snapshotTrigger: ({ agentData }) => agentData.messages.length >= 2,
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      let ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids.length).toBe(0) // 0 messages — no snapshot

      mockAgent.messages.push(MOCK_MESSAGE, MOCK_MESSAGE)
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids.length).toBe(1) // 2 messages — snapshot taken
    })

    it('trigger based on agent state via agentData', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'trigger',
        snapshotTrigger: ({ agentData }) => (agentData.state as any).get('checkpoint') === true,
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      let ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids.length).toBe(0) // state not set — no snapshot

      mockAgent.state.set('checkpoint', true)
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids.length).toBe(1) // state set — snapshot taken
    })
  })

  describe('integration scenarios', () => {
    it('handles complete session lifecycle', async () => {
      sessionManager = new SessionManager({
        sessionId: 'lifecycle-test',
        storage: { snapshot: storage },
        saveLatestOn: 'invocation',
        snapshotTrigger: () => true,
      })
      sessionManager.registerCallbacks(registry)

      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      const latest = await storage.loadSnapshot({
        location: { sessionId: 'lifecycle-test', scope: 'agent', scopeId: 'default' },
      })
      const immutableIds = await storage.listSnapshotIds({
        location: { sessionId: 'lifecycle-test', scope: 'agent', scopeId: 'default' },
      })

      expect(latest).not.toBeNull()
      expect(immutableIds.length).toBe(3)
    })

    it('supports resuming from immutable snapshot', async () => {
      // First session - snapshot fires when messages.length === 2 (after turn 1)
      sessionManager = new SessionManager({
        sessionId: 'resume-test',
        storage: { snapshot: storage },
        saveLatestOn: 'trigger',
        snapshotTrigger: ({ agentData }) => agentData.messages.length === 2,
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))
      mockAgent.messages.push(MOCK_MESSAGE, MOCK_MESSAGE)
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      const ids = await storage.listSnapshotIds({
        location: { sessionId: 'resume-test', scope: 'agent', scopeId: 'default' },
      })
      expect(ids.length).toBe(1)

      // Second session - resume from that snapshot
      const newAgent = createMockAgent()
      const newSessionManager = new SessionManager({
        sessionId: 'resume-test',
        storage: { snapshot: storage },
        saveLatestOn: 'invocation',
      })
      const newRegistry = new HookRegistry()
      newSessionManager.registerCallbacks(newRegistry)
      await newRegistry.invokeCallbacks(new InitializedEvent(createMockEvent(newAgent)))
      await newSessionManager.restoreSnapshot({ target: newAgent, snapshotId: ids[0]! })

      expect(newAgent.messages).toEqual(mockAgent.messages)
    })
  })

  describe('MessageUpdatedEvent handling', () => {
    beforeEach(() => {
      mockAgent = createMockAgent('test-agent')
    })

    it('saves snapshot_latest when saveLatestOn is message', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'message',
      })
      sessionManager.registerCallbacks(registry)

      const redactedMessage = new Message({ role: 'user', content: [new TextBlock('[User input redacted.]')] })
      const event = { agent: mockAgent, message: redactedMessage, index: 0 } as any

      await registry.invokeCallbacks(new MessageUpdatedEvent(event))

      const snapshot = await storage.loadSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(snapshot).not.toBeNull()
    })

    it('does not save when saveLatestOn is invocation', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'invocation',
      })
      sessionManager.registerCallbacks(registry)

      const redactedMessage = new Message({ role: 'user', content: [new TextBlock('[User input redacted.]')] })
      const event = { agent: mockAgent, message: redactedMessage, index: 0 } as any

      await registry.invokeCallbacks(new MessageUpdatedEvent(event))

      const snapshot = await storage.loadSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(snapshot).toBeNull()
    })
  })
})
