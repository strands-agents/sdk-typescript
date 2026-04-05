import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Agent } from '../agent.js'
import type { Snapshot } from '../../types/snapshot.js'
import { SNAPSHOT_SCHEMA_VERSION } from '../../types/snapshot.js'
import { InterruptState } from '../../interrupt.js'
import {
  ALL_SNAPSHOT_FIELDS,
  SNAPSHOT_PRESETS,
  createTimestamp,
  resolveSnapshotFields,
  takeSnapshot,
  loadSnapshot,
} from '../snapshot.js'
import { Message, TextBlock, ToolUseBlock, ToolResultBlock } from '../../types/messages.js'
import { TestModelProvider } from '../../__fixtures__/model-test-helpers.js'

// Fixed timestamp for testing
const MOCK_TIMESTAMP = '2026-01-15T12:00:00.000Z'

/**
 * Helper to create a test agent with a mock model
 */
function createTestAgent(): Agent {
  return new Agent({
    model: new TestModelProvider(),
    tools: [],
  })
}

describe('Snapshot API', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(MOCK_TIMESTAMP))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('constants', () => {
    it('exports snapshot constants with correct values', () => {
      expect(SNAPSHOT_SCHEMA_VERSION).toBe('1.0')
      expect(ALL_SNAPSHOT_FIELDS).toEqual(['messages', 'state', 'systemPrompt', 'interrupts'])
      expect(SNAPSHOT_PRESETS).toEqual({
        session: ['messages', 'state', 'systemPrompt', 'interrupts'],
      })
    })
  })

  describe('createTimestamp', () => {
    it('returns ISO 8601 formatted timestamp', () => {
      expect(createTimestamp()).toBe(MOCK_TIMESTAMP)
    })
  })

  describe('resolveSnapshotFields', () => {
    it('throws error when no fields would be included', () => {
      expect(() => resolveSnapshotFields({})).toThrow('No fields to include in snapshot')
    })

    it('returns session preset fields when preset is "session"', () => {
      const fields = resolveSnapshotFields({ preset: 'session' })
      expect(fields).toEqual(new Set(['messages', 'state', 'systemPrompt', 'interrupts']))
    })

    it('returns explicit fields when include is specified', () => {
      const fields = resolveSnapshotFields({ include: ['messages', 'state'] })
      expect(fields).toEqual(new Set(['messages', 'state']))
    })

    it('applies exclude after preset', () => {
      const fields = resolveSnapshotFields({ preset: 'session', exclude: ['state'] })
      expect(fields).toEqual(new Set(['messages', 'systemPrompt', 'interrupts']))
    })

    it('throws error for invalid preset', () => {
      expect(() => resolveSnapshotFields({ preset: 'invalid' as any })).toThrow('Invalid preset: invalid')
    })

    it('throws error for invalid field names', () => {
      expect(() => resolveSnapshotFields({ include: ['invalidField' as any] })).toThrow(
        'Invalid snapshot field: invalidField'
      )
    })
  })

  describe('takeSnapshot', () => {
    let agent: Agent

    beforeEach(() => {
      agent = createTestAgent()
    })

    it('creates snapshot with session preset', () => {
      agent.messages.push(new Message({ role: 'user', content: [new TextBlock('Hello')] }))
      agent.appState.set('key', 'value')
      agent.systemPrompt = 'Test prompt'

      const snapshot = takeSnapshot(agent, { preset: 'session' })

      expect(snapshot).toEqual({
        scope: 'agent',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        createdAt: MOCK_TIMESTAMP,
        data: {
          messages: [{ role: 'user', content: [{ text: 'Hello' }] }],
          state: { key: 'value' },
          systemPrompt: 'Test prompt',
          interrupts: { interrupts: {}, activated: false },
        },
        appData: {},
      })
    })

    it('includes appData in snapshot', () => {
      const snapshot = takeSnapshot(agent, {
        preset: 'session',
        appData: { customKey: 'customValue' },
      })
      expect(snapshot.appData).toEqual({ customKey: 'customValue' })
    })

    it('excludes specified fields', () => {
      agent.messages.push(new Message({ role: 'user', content: [new TextBlock('Hello')] }))
      agent.appState.set('key', 'value')

      const snapshot = takeSnapshot(agent, { preset: 'session', exclude: ['messages'] })

      expect(snapshot.data.messages).toBeUndefined()
      expect(snapshot.data.state).toBeDefined()
    })
  })

  describe('loadSnapshot', () => {
    let agent: Agent

    beforeEach(() => {
      agent = createTestAgent()
    })

    it('throws error for incompatible schema version', () => {
      const snapshot: Snapshot = {
        scope: 'agent',
        schemaVersion: '2.0',
        createdAt: createTimestamp(),
        data: {},
        appData: {},
      }

      expect(() => loadSnapshot(agent, snapshot)).toThrow(
        'Unsupported snapshot schema version: 2.0. Current version: 1.0'
      )
    })

    it('throws error for wrong scope', () => {
      const snapshot: Snapshot = {
        scope: 'multiAgent',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        createdAt: createTimestamp(),
        data: {},
        appData: {},
      }

      expect(() => loadSnapshot(agent, snapshot)).toThrow("Expected snapshot scope 'agent', got 'multiAgent'")
    })

    it('restores messages from snapshot', () => {
      const snapshot: Snapshot = {
        scope: 'agent',
        schemaVersion: '1.0',
        createdAt: createTimestamp(),
        data: {
          messages: [{ role: 'user', content: [{ text: 'Restored message' }] }],
        },
        appData: {},
      }

      loadSnapshot(agent, snapshot)

      expect(agent.messages).toHaveLength(1)
      expect(agent.messages[0]).toEqual(new Message({ role: 'user', content: [new TextBlock('Restored message')] }))
    })

    it('restores state from snapshot', () => {
      const snapshot: Snapshot = {
        scope: 'agent',
        schemaVersion: '1.0',
        createdAt: createTimestamp(),
        data: {
          state: { restoredKey: 'restoredValue' },
        },
        appData: {},
      }

      loadSnapshot(agent, snapshot)

      expect(agent.appState.get('restoredKey')).toBe('restoredValue')
    })

    it('restores systemPrompt from snapshot', () => {
      const snapshot: Snapshot = {
        scope: 'agent',
        schemaVersion: '1.0',
        createdAt: createTimestamp(),
        data: {
          systemPrompt: 'Restored system prompt',
        },
        appData: {},
      }

      loadSnapshot(agent, snapshot)

      expect(agent.systemPrompt).toBe('Restored system prompt')
    })

    it('clears systemPrompt when snapshot has null systemPrompt (agent had no system prompt at snapshot time)', () => {
      agent.systemPrompt = 'Original prompt'

      const snapshot: Snapshot = {
        scope: 'agent',
        schemaVersion: '1.0',
        createdAt: createTimestamp(),
        data: { systemPrompt: null },
        appData: {},
      }

      loadSnapshot(agent, snapshot)

      // null in snapshot means the agent had no system prompt — should be cleared
      expect(agent.systemPrompt).toBeUndefined()
    })

    it('leaves systemPrompt unchanged when systemPrompt key is absent from snapshot', () => {
      agent.systemPrompt = 'Original prompt'

      const snapshot: Snapshot = {
        scope: 'agent',
        schemaVersion: '1.0',
        createdAt: createTimestamp(),
        data: { messages: [] }, // systemPrompt key not present at all
        appData: {},
      }

      loadSnapshot(agent, snapshot)

      // absent key means field was not snapshotted — agent prompt should be untouched
      expect(agent.systemPrompt).toBe('Original prompt')
    })

    it('leaves messages unchanged when messages key is absent from snapshot', () => {
      agent.messages.push(new Message({ role: 'user', content: [new TextBlock('Existing')] }))

      const snapshot: Snapshot = {
        scope: 'agent',
        schemaVersion: '1.0',
        createdAt: createTimestamp(),
        data: { state: { key: 'val' } }, // messages key not present
        appData: {},
      }

      loadSnapshot(agent, snapshot)

      expect(agent.messages).toHaveLength(1)
    })

    it('leaves state unchanged when state key is absent from snapshot', () => {
      agent.appState.set('existing', 'value')

      const snapshot: Snapshot = {
        scope: 'agent',
        schemaVersion: '1.0',
        createdAt: createTimestamp(),
        data: { messages: [] }, // state key not present
        appData: {},
      }

      loadSnapshot(agent, snapshot)

      expect(agent.appState.get('existing')).toBe('value')
    })
  })

  describe('round-trip', () => {
    let agent: Agent

    beforeEach(() => {
      agent = createTestAgent()
    })

    it('preserves messages through save/load cycle', () => {
      const originalMessages = [
        new Message({ role: 'user', content: [new TextBlock('Hello')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Hi!')] }),
      ]
      agent.messages.push(...originalMessages)

      const snapshot = takeSnapshot(agent, { preset: 'session' })

      // Modify agent
      agent.messages.length = 0
      agent.messages.push(new Message({ role: 'user', content: [new TextBlock('Different')] }))

      // Restore
      loadSnapshot(agent, snapshot)

      expect(agent.messages).toEqual(originalMessages)
    })

    it('preserves state through save/load cycle', () => {
      agent.appState.set('userId', 'user-123')
      agent.appState.set('counter', 42)

      const snapshot = takeSnapshot(agent, { preset: 'session' })

      // Modify state
      agent.appState.clear()
      agent.appState.set('different', 'value')

      // Restore
      loadSnapshot(agent, snapshot)

      expect(agent.appState.getAll()).toEqual({ userId: 'user-123', counter: 42 })
    })

    it('handles complex message content', () => {
      const toolUseBlock = new ToolUseBlock({
        name: 'calculator',
        toolUseId: 'tool-123',
        input: { operation: 'add', numbers: [1, 2, 3] },
      })
      const toolResultBlock = new ToolResultBlock({
        toolUseId: 'tool-123',
        status: 'success',
        content: [new TextBlock('6')],
      })
      const originalMessages = [
        new Message({ role: 'assistant', content: [toolUseBlock] }),
        new Message({ role: 'user', content: [toolResultBlock] }),
      ]
      agent.messages.push(...originalMessages)

      const snapshot = takeSnapshot(agent, { include: ['messages'] })
      agent.messages.length = 0
      loadSnapshot(agent, snapshot)

      expect(agent.messages).toEqual(originalMessages)
    })
    it('preserves interrupt state through save/load cycle', () => {
      // Set up interrupt state as if agent was interrupted mid-execution
      const agentInterruptState = (agent as unknown as { _interruptState: InterruptState })._interruptState
      agentInterruptState.getOrCreateInterrupt('int-1', 'confirm', 'Confirm?')
      agentInterruptState.activate()
      agentInterruptState.setPendingToolExecution({
        assistantMessageData: {
          role: 'assistant',
          content: [{ toolUse: { name: 'test', toolUseId: 't-1', input: {} } }],
        },
        completedToolResults: {},
      })

      const snapshot = takeSnapshot(agent, { preset: 'session' })

      // Modify agent interrupt state
      agentInterruptState.deactivate()

      // Restore
      loadSnapshot(agent, snapshot)

      const restored = (agent as unknown as { _interruptState: InterruptState })._interruptState
      expect(restored.activated).toBe(true)
      expect(restored.interrupts.size).toBe(1)
      expect(restored.interrupts.get('int-1')?.name).toBe('confirm')
      expect(restored.pendingToolExecution).toBeDefined()
    })
  })

  describe('JSON serialization', () => {
    it('snapshot survives JSON.stringify/JSON.parse round-trip', () => {
      const agent = createTestAgent()
      agent.messages.push(new Message({ role: 'user', content: [new TextBlock('Hello')] }))
      agent.appState.set('userId', 'user-123')
      agent.systemPrompt = 'You are a helpful assistant'

      const snapshot = takeSnapshot(agent, { preset: 'session' })

      // Serialize to JSON string and parse back
      const jsonString = JSON.stringify(snapshot)
      const parsed = JSON.parse(jsonString)

      // Verify structure is preserved
      expect(parsed).toEqual(snapshot)
    })

    it('snapshot can be stored and retrieved as JSON string', () => {
      const agent = createTestAgent()
      agent.messages.push(new Message({ role: 'user', content: [new TextBlock('Test message')] }))
      agent.appState.set('key', 'value')

      const snapshot = takeSnapshot(agent, { preset: 'session' })

      // Simulate storing to a database or file as JSON
      const stored = JSON.stringify(snapshot)

      // Simulate retrieving and restoring
      const retrieved = JSON.parse(stored)
      const newAgent = createTestAgent()
      loadSnapshot(newAgent, retrieved)

      expect(newAgent.messages).toHaveLength(1)
      expect(newAgent.appState.getAll()).toEqual({ key: 'value' })
    })
  })
})
