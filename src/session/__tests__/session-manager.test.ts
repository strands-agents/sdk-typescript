import { describe, expect, it, beforeEach, vi } from 'vitest'
import { SessionManager } from '../session-manager.js'
import { MockSnapshotStorage, createTestSnapshot } from '../../__fixtures__/mock-storage-provider.js'
import {
  InitializedEvent,
  MessageAddedEvent,
  AfterInvocationEvent,
  AfterModelCallEvent,
  HookableEvent,
} from '../../hooks/index.js'
import { Agent } from '../../agent/agent.js'
import { Message, TextBlock } from '../../types/messages.js'
import { createMockAgent as createMockAgentWithHooks, invokeTrackedHook } from '../../__fixtures__/agent-helpers.js'
import { loadStateFromJSONSymbol, stateToJSONSymbol } from '../../types/serializable.js'

// Test fixtures
function createMockAgent(id = 'agent'): Agent {
  const agent = {
    id,
    messages: [],
    appState: {
      _m: new Map(),
      get(k: string) {
        return this._m.get(k)
      },
      set(k: string, v: unknown) {
        this._m.set(k, v)
      },
      [stateToJSONSymbol]() {
        return Object.fromEntries(this._m)
      },
      [loadStateFromJSONSymbol](json: Record<string, unknown>) {
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

async function initPluginAndInvokeHook<T extends HookableEvent>(
  sessionManager: SessionManager,
  event: T
): Promise<void> {
  const pluginAgent = createMockAgentWithHooks()
  sessionManager.initAgent(pluginAgent)
  await invokeTrackedHook(pluginAgent, event)
}

describe('SessionManager', () => {
  let storage: MockSnapshotStorage
  let sessionManager: SessionManager
  let mockAgent: Agent

  beforeEach(() => {
    storage = new MockSnapshotStorage()
    mockAgent = createMockAgent()
  })

  describe('constructor', () => {
    it('defaults saveLatestOn to invocation', async () => {
      sessionManager = new SessionManager({ sessionId: 'test-default', storage: { snapshot: storage } })

      await initPluginAndInvokeHook(sessionManager, new AfterInvocationEvent(createMockEvent(mockAgent)))

      const snapshot = await storage.loadSnapshot({
        location: { sessionId: 'test-default', scope: 'agent', scopeId: 'agent' },
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

      await initPluginAndInvokeHook(sessionManager, new InitializedEvent(createMockEvent(mockAgent)))

      expect(mockAgent.messages).toEqual(snapshot.data.messages)
    })

    it('handles missing snapshot gracefully', async () => {
      sessionManager = new SessionManager({
        sessionId: 'new-session',
        storage: { snapshot: storage },
      })

      await expect(
        initPluginAndInvokeHook(sessionManager, new InitializedEvent(createMockEvent(mockAgent)))
      ).resolves.not.toThrow()
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

      await initPluginAndInvokeHook(sessionManager, new MessageAddedEvent(createMockMessageEvent(mockAgent)))

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

      // MessageAddedEvent is not registered when saveLatestOn is 'invocation'
      // So we need to call initAgent and check that no hook is registered for MessageAddedEvent
      const pluginAgent = createMockAgentWithHooks()
      sessionManager.initAgent(pluginAgent)

      // Verify MessageAddedEvent hook is not registered
      const messageHook = pluginAgent.trackedHooks.find((h) => h.eventType === MessageAddedEvent)
      expect(messageHook).toBeUndefined()

      // Even if we try to invoke (nothing should happen)
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

      await initPluginAndInvokeHook(sessionManager, new AfterInvocationEvent(createMockEvent(mockAgent)))

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

      await initPluginAndInvokeHook(sessionManager, new AfterInvocationEvent(createMockEvent(mockAgent)))

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

      await initPluginAndInvokeHook(sessionManager, new AfterInvocationEvent(createMockEvent(mockAgent)))

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

      await initPluginAndInvokeHook(sessionManager, new AfterInvocationEvent(createMockEvent(mockAgent)))

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

      await initPluginAndInvokeHook(sessionManager, new AfterInvocationEvent(createMockEvent(mockAgent)))

      expect(triggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentData: expect.objectContaining({
            appState: mockAgent.appState,
            messages: mockAgent.messages,
          }),
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

      await initPluginAndInvokeHook(sessionManager, new AfterInvocationEvent(createMockEvent(mockAgent)))

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

      const pluginAgent = createMockAgentWithHooks()
      sessionManager.initAgent(pluginAgent)

      await invokeTrackedHook(pluginAgent, new AfterInvocationEvent(createMockEvent(mockAgent)))
      let ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids.length).toBe(0) // 0 messages — no snapshot

      mockAgent.messages.push(MOCK_MESSAGE, MOCK_MESSAGE)
      await invokeTrackedHook(pluginAgent, new AfterInvocationEvent(createMockEvent(mockAgent)))
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
        snapshotTrigger: ({ agentData }) => (agentData.appState as any).get('checkpoint') === true,
      })

      const pluginAgent = createMockAgentWithHooks()
      sessionManager.initAgent(pluginAgent)

      await invokeTrackedHook(pluginAgent, new AfterInvocationEvent(createMockEvent(mockAgent)))
      let ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids.length).toBe(0) // state not set — no snapshot

      mockAgent.appState.set('checkpoint', true)
      await invokeTrackedHook(pluginAgent, new AfterInvocationEvent(createMockEvent(mockAgent)))
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

      const pluginAgent = createMockAgentWithHooks()
      sessionManager.initAgent(pluginAgent)

      await invokeTrackedHook(pluginAgent, new InitializedEvent(createMockEvent(mockAgent)))
      await invokeTrackedHook(pluginAgent, new AfterInvocationEvent(createMockEvent(mockAgent)))
      await invokeTrackedHook(pluginAgent, new AfterInvocationEvent(createMockEvent(mockAgent)))
      await invokeTrackedHook(pluginAgent, new AfterInvocationEvent(createMockEvent(mockAgent)))

      const latest = await storage.loadSnapshot({
        location: { sessionId: 'lifecycle-test', scope: 'agent', scopeId: 'agent' },
      })
      const immutableIds = await storage.listSnapshotIds({
        location: { sessionId: 'lifecycle-test', scope: 'agent', scopeId: 'agent' },
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

      const pluginAgent = createMockAgentWithHooks()
      sessionManager.initAgent(pluginAgent)

      await invokeTrackedHook(pluginAgent, new InitializedEvent(createMockEvent(mockAgent)))
      mockAgent.messages.push(MOCK_MESSAGE, MOCK_MESSAGE)
      await invokeTrackedHook(pluginAgent, new AfterInvocationEvent(createMockEvent(mockAgent)))

      const ids = await storage.listSnapshotIds({
        location: { sessionId: 'resume-test', scope: 'agent', scopeId: 'agent' },
      })
      expect(ids.length).toBe(1)

      // Second session - resume from that snapshot
      const newAgent = createMockAgent()
      const newSessionManager = new SessionManager({
        sessionId: 'resume-test',
        storage: { snapshot: storage },
        saveLatestOn: 'invocation',
      })

      const newAgentData = createMockAgentWithHooks()
      newSessionManager.initAgent(newAgentData)

      await invokeTrackedHook(newAgentData, new InitializedEvent(createMockEvent(newAgent)))
      await newSessionManager.restoreSnapshot({ target: newAgent, snapshotId: ids[0]! })

      expect(newAgent.messages).toEqual(mockAgent.messages)
    })
  })

  describe('AfterModelCallEvent with redaction handling', () => {
    beforeEach(() => {
      mockAgent = createMockAgent('test-agent')
    })

    it('saves snapshot_latest when saveLatestOn is message and redaction occurred', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'message',
      })

      const assistantMessage = new Message({ role: 'assistant', content: [new TextBlock('Response')] })
      const event = new AfterModelCallEvent({
        agent: mockAgent,
        stopData: {
          message: assistantMessage,
          stopReason: 'endTurn' as const,
          redaction: { userMessage: '[User input redacted.]' },
        },
      } as any)

      await initPluginAndInvokeHook(sessionManager, event)

      const snapshot = await storage.loadSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(snapshot).not.toBeNull()
    })

    it('does not save when saveLatestOn is message but no redaction occurred', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'message',
      })

      const assistantMessage = new Message({ role: 'assistant', content: [new TextBlock('Response')] })
      const event = new AfterModelCallEvent({
        agent: mockAgent,
        stopData: { message: assistantMessage, stopReason: 'endTurn' as const },
      } as any)

      await initPluginAndInvokeHook(sessionManager, event)

      const snapshot = await storage.loadSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(snapshot).toBeNull()
    })

    it('does not save when saveLatestOn is invocation', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        storage: { snapshot: storage },
        saveLatestOn: 'invocation',
      })

      // AfterModelCallEvent hook is not registered when saveLatestOn is 'invocation'
      const pluginAgent = createMockAgentWithHooks()
      sessionManager.initAgent(pluginAgent)
      const afterModelHook = pluginAgent.trackedHooks.find((h) => h.eventType === AfterModelCallEvent)
      expect(afterModelHook).toBeUndefined()

      const snapshot = await storage.loadSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(snapshot).toBeNull()
    })
  })
})
