import { describe, expect, it, beforeEach, vi } from 'vitest'
import { SessionManager } from '../session-manager.js'
import { MockSnapshotStorage, createTestSnapshot } from '../../__fixtures__/mock-storage-provider.js'
import { HookRegistry, InitializedEvent, MessageAddedEvent, AfterInvocationEvent } from '../../hooks/index.js'
import { Agent } from '../../agent/agent.js'
import { AgentState } from '../../agent/state.js'
import { Message, TextBlock } from '../../types/messages.js'

// Test fixtures
function createMockAgent(): Agent {
  const agent = {
    messages: [],
    state: new AgentState(),
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
    it('uses default values when no config provided', () => {
      sessionManager = new SessionManager()
      expect(sessionManager).toBeDefined()
    })

    it('uses provided sessionId and agentId', () => {
      sessionManager = new SessionManager({
        sessionId: 'custom-session',
        agentId: 'custom-agent',
        storage: { snapshot: storage },
      })
      expect(sessionManager).toBeDefined()
    })

    it('defaults saveLatestOn to message', async () => {
      sessionManager = new SessionManager({ sessionId: 'test-default', storage: { snapshot: storage } })
      sessionManager.registerCallbacks(registry)

      await registry.invokeCallbacks(new MessageAddedEvent(createMockMessageEvent(mockAgent)))

      const snapshot = await storage.loadSnapshot({
        location: { sessionId: 'test-default', scope: 'agent', scopeId: 'default' },
      })
      expect(snapshot).not.toBeNull()
    })
  })

  describe('registerCallbacks', () => {
    it('registers callbacks without errors', () => {
      sessionManager = new SessionManager({ storage: { snapshot: storage } })
      expect(() => sessionManager.registerCallbacks(registry)).not.toThrow()
    })
  })

  describe('saveSnapshot', () => {
    beforeEach(() => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
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

    it('allocates sequential snapshot IDs', async () => {
      await sessionManager.saveSnapshot({ target: mockAgent, isLatest: false })
      await sessionManager.saveSnapshot({ target: mockAgent, isLatest: false })
      await sessionManager.saveSnapshot({ target: mockAgent, isLatest: false })

      const ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids).toEqual(['1', '2', '3'])
    })
  })

  describe('restoreSnapshot', () => {
    beforeEach(() => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
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
    it('loads snapshot when loadSnapshotId is provided', async () => {
      const snapshot = createTestSnapshot()
      await storage.saveSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
        snapshotId: '3',
        isLatest: false,
        snapshot,
      })

      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
        storage: { snapshot: storage },
        loadSnapshotId: '3',
      })
      sessionManager.registerCallbacks(registry)

      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      // Verify manifest was updated to continue from snapshot 4
      const manifest = await storage.loadManifest({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(manifest.nextSnapshotId).toBe('4')
    })

    it('does not update manifest when loading snapshot_latest', async () => {
      const snapshot = createTestSnapshot()
      await storage.saveSnapshot({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
        snapshotId: 'latest',
        isLatest: true,
        snapshot,
      })

      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
        storage: { snapshot: storage },
      })
      sessionManager.registerCallbacks(registry)

      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      const manifest = await storage.loadManifest({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(manifest.nextSnapshotId).toBe('1')
    })

    it('handles missing snapshot gracefully', async () => {
      sessionManager = new SessionManager({
        sessionId: 'new-session',
        agentId: 'new-agent',
        storage: { snapshot: storage },
      })
      sessionManager.registerCallbacks(registry)

      await expect(registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))).resolves.not.toThrow()
    })
  })

  describe('MessageAddedEvent handling', () => {
    it('saves snapshot_latest when saveLatestOn is message', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
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
        agentId: 'test-agent',
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
    it('increments turn count', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
        storage: { snapshot: storage },
        saveLatestOn: 'never',
        snapshotTrigger: ({ turnCount }) => turnCount === 2,
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      const ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids.length).toBe(1) // Only triggered on turn 2
    })

    it('saves snapshot_latest when saveLatestOn is invocation', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
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

    it('does not save snapshot_latest when saveLatestOn is never', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
        storage: { snapshot: storage },
        saveLatestOn: 'never',
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
    it('creates immutable snapshot when trigger returns true', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
        storage: { snapshot: storage },
        saveLatestOn: 'never',
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
        agentId: 'test-agent',
        storage: { snapshot: storage },
        saveLatestOn: 'never',
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

    it('provides correct turnCount to trigger', async () => {
      const triggerSpy = vi.fn(() => false)
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
        storage: { snapshot: storage },
        saveLatestOn: 'never',
        snapshotTrigger: triggerSpy,
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      expect(triggerSpy).toHaveBeenCalledTimes(3)
      expect(triggerSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ turnCount: 1 }))
      expect(triggerSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ turnCount: 2 }))
      expect(triggerSpy).toHaveBeenNthCalledWith(3, expect.objectContaining({ turnCount: 3 }))
    })

    it('provides lastSnapshotAt to trigger', async () => {
      const triggerSpy = vi.fn(() => true)
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
        storage: { snapshot: storage },
        saveLatestOn: 'never',
        snapshotTrigger: triggerSpy,
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      expect(triggerSpy).toHaveBeenNthCalledWith(1, expect.not.objectContaining({ lastSnapshotAt: expect.any(Number) }))
      expect(triggerSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ lastSnapshotAt: expect.any(Number) }))
    })

    it('provides agentData to trigger', async () => {
      const triggerSpy = vi.fn(() => false)
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
        storage: { snapshot: storage },
        saveLatestOn: 'never',
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
        agentId: 'test-agent',
        storage: { snapshot: storage },
        saveLatestOn: 'never',
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

    it('trigger based on turn count', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
        storage: { snapshot: storage },
        saveLatestOn: 'never',
        snapshotTrigger: ({ turnCount }) => turnCount % 2 === 0,
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      const ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids).toEqual(['1', '2']) // Snapshots on turns 2 and 4
    })

    it('trigger based on message count via agentData', async () => {
      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
        storage: { snapshot: storage },
        saveLatestOn: 'never',
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
        agentId: 'test-agent',
        storage: { snapshot: storage },
        saveLatestOn: 'never',
        snapshotTrigger: ({ agentData }) => (agentData.state as AgentState).get('checkpoint') === true,
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

    it('trigger based on time elapsed', async () => {
      const triggerSpy = vi.fn(({ lastSnapshotAt }) => {
        if (!lastSnapshotAt) {
          return true // Take first snapshot
        }
        return Date.now() - lastSnapshotAt > 100 // Shorter interval for test
      })

      sessionManager = new SessionManager({
        sessionId: 'test-session',
        agentId: 'test-agent',
        storage: { snapshot: storage },
        saveLatestOn: 'never',
        snapshotTrigger: triggerSpy,
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, 150)
      })
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      const ids = await storage.listSnapshotIds({
        location: { sessionId: 'test-session', scope: 'agent', scopeId: 'test-agent' },
      })
      expect(ids.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('integration scenarios', () => {
    it('handles complete session lifecycle', async () => {
      sessionManager = new SessionManager({
        sessionId: 'lifecycle-test',
        agentId: 'agent-1',
        storage: { snapshot: storage },
        saveLatestOn: 'invocation',
        snapshotTrigger: ({ turnCount }) => turnCount === 3,
      })
      sessionManager.registerCallbacks(registry)

      // Initialize
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))

      // Add messages and complete invocations
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      const latest = await storage.loadSnapshot({
        location: { sessionId: 'lifecycle-test', scope: 'agent', scopeId: 'agent-1' },
      })
      const immutableIds = await storage.listSnapshotIds({
        location: { sessionId: 'lifecycle-test', scope: 'agent', scopeId: 'agent-1' },
      })

      expect(latest).not.toBeNull()
      expect(immutableIds).toContain('1') // Triggered on turn 3
    })

    it('supports resuming from immutable snapshot', async () => {
      // First session - create snapshots
      sessionManager = new SessionManager({
        sessionId: 'resume-test',
        agentId: 'agent-1',
        storage: { snapshot: storage },
        saveLatestOn: 'invocation',
        snapshotTrigger: ({ turnCount }) => turnCount === 2,
      })
      sessionManager.registerCallbacks(registry)
      await registry.invokeCallbacks(new InitializedEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))
      await registry.invokeCallbacks(new AfterInvocationEvent(createMockEvent(mockAgent)))

      // Second session - resume from snapshot 1
      const newAgent = createMockAgent()
      const newSessionManager = new SessionManager({
        sessionId: 'resume-test',
        agentId: 'agent-1',
        storage: { snapshot: storage },
        loadSnapshotId: '1',
        saveLatestOn: 'invocation',
      })
      const newRegistry = new HookRegistry()
      newSessionManager.registerCallbacks(newRegistry)
      await newRegistry.invokeCallbacks(new InitializedEvent(createMockEvent(newAgent)))

      // Continue from snapshot 1
      await newSessionManager.saveSnapshot({ target: newAgent, isLatest: false })

      const ids = await storage.listSnapshotIds({
        location: { sessionId: 'resume-test', scope: 'agent', scopeId: 'agent-1' },
      })
      expect(ids).toContain('1')
      expect(ids).toContain('2')
    })
  })
})
