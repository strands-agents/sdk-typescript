import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Agent } from '../agent.js'
import type { Snapshot } from '../snapshot.js'
import {
  SNAPSHOT_VERSION,
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
      expect(SNAPSHOT_VERSION).toBe('1.0')
      expect(ALL_SNAPSHOT_FIELDS).toEqual(['messages', 'state', 'conversationManagerState', 'systemPrompt'])
      expect(SNAPSHOT_PRESETS).toEqual({
        session: ['messages', 'state', 'conversationManagerState', 'systemPrompt'],
      })
    })
  })

  describe('createTimestamp', () => {
    it('returns ISO 8601 formatted timestamp', () => {
      const timestamp = createTimestamp()
      expect(timestamp).toBe(MOCK_TIMESTAMP)
    })
  })

  describe('resolveSnapshotFields', () => {
    it('throws error when no fields would be included', () => {
      expect(() => resolveSnapshotFields({})).toThrow('No fields to include in snapshot')
    })

    it('returns session preset fields when preset is "session"', () => {
      const fields = resolveSnapshotFields({ preset: 'session' })
      expect(fields).toEqual(new Set(['messages', 'state', 'conversationManagerState', 'systemPrompt']))
    })

    it('returns explicit fields when include is specified', () => {
      const fields = resolveSnapshotFields({ include: ['messages', 'state'] })
      expect(fields).toEqual(new Set(['messages', 'state']))
    })

    it('combines preset and include fields', () => {
      // Start with a hypothetical smaller preset, add more
      const fields = resolveSnapshotFields({ preset: 'session', include: ['messages'] })
      expect(fields).toEqual(new Set(['messages', 'state', 'conversationManagerState', 'systemPrompt']))
    })

    it('applies exclude after preset and include', () => {
      const fields = resolveSnapshotFields({ preset: 'session', exclude: ['state'] })
      expect(fields).toEqual(new Set(['messages', 'conversationManagerState', 'systemPrompt']))
    })

    it('does not throw when excluding a field not in include', () => {
      const fields = resolveSnapshotFields({ include: ['messages'], exclude: ['state'] })
      expect(fields).toEqual(new Set(['messages']))
    })

    it('throws error for invalid preset', () => {
      expect(() => resolveSnapshotFields({ preset: 'invalid' as any })).toThrow('Invalid preset: invalid')
    })

    it('throws error for invalid field names in include', () => {
      expect(() => resolveSnapshotFields({ include: ['invalidField' as any] })).toThrow(
        'Invalid snapshot field: invalidField'
      )
    })

    it('throws error for invalid field names in exclude', () => {
      expect(() => resolveSnapshotFields({ preset: 'session', exclude: ['invalidField' as any] })).toThrow(
        'Invalid snapshot field: invalidField'
      )
    })
  })

  describe('takeSnapshot', () => {
    let agent: Agent

    beforeEach(async () => {
      agent = createTestAgent()
    })

    it('creates snapshot with session preset', () => {
      agent.messages.push(new Message({ role: 'user', content: [new TextBlock('Hello')] }))
      agent.state.set('key', 'value')
      agent.systemPrompt = 'Test prompt'

      const snapshot = takeSnapshot(agent, { preset: 'session' })

      expect(snapshot).toEqual({
        type: 'agent',
        version: SNAPSHOT_VERSION,
        timestamp: MOCK_TIMESTAMP,
        data: {
          messages: [{ role: 'user', content: [{ text: 'Hello' }] }],
          state: { key: 'value' },
          conversationManagerState: {},
          systemPrompt: 'Test prompt',
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

    it('includes systemPrompt when using session preset', () => {
      agent.systemPrompt = 'You are a helpful assistant'

      const snapshot = takeSnapshot(agent, { preset: 'session' })

      expect(snapshot.data.systemPrompt).toBe('You are a helpful assistant')
    })

    it('serializes messages correctly', () => {
      agent.messages.push(
        new Message({ role: 'user', content: [new TextBlock('Hello')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Hi there!')] })
      )

      const snapshot = takeSnapshot(agent, { include: ['messages'] })

      expect(snapshot.data.messages).toEqual([
        { role: 'user', content: [{ text: 'Hello' }] },
        { role: 'assistant', content: [{ text: 'Hi there!' }] },
      ])
    })

    it('serializes state correctly', () => {
      agent.state.set('userId', 'user-123')
      agent.state.set('preferences', { theme: 'dark' })

      const snapshot = takeSnapshot(agent, { include: ['state'] })

      expect(snapshot.data.state).toEqual({
        userId: 'user-123',
        preferences: { theme: 'dark' },
      })
    })

    it('excludes specified fields', () => {
      agent.messages.push(new Message({ role: 'user', content: [new TextBlock('Hello')] }))
      agent.state.set('key', 'value')

      const snapshot = takeSnapshot(agent, { preset: 'session', exclude: ['messages'] })

      expect(snapshot.data.messages).toBeUndefined()
      expect(snapshot.data.state).toBeDefined()
    })
  })

  describe('loadSnapshot', () => {
    let agent: Agent

    beforeEach(async () => {
      agent = createTestAgent()
    })

    it('restores messages from snapshot', () => {
      const snapshot: Snapshot = {
        type: 'agent',
        version: '1.0',
        timestamp: createTimestamp(),
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
        type: 'agent',
        version: '1.0',
        timestamp: createTimestamp(),
        data: {
          state: { restoredKey: 'restoredValue' },
        },
        appData: {},
      }

      loadSnapshot(agent, snapshot)

      expect(agent.state.get('restoredKey')).toBe('restoredValue')
    })

    it('restores systemPrompt from snapshot', () => {
      const snapshot: Snapshot = {
        type: 'agent',
        version: '1.0',
        timestamp: createTimestamp(),
        data: {
          systemPrompt: 'Restored system prompt',
        },
        appData: {},
      }

      loadSnapshot(agent, snapshot)

      expect(agent.systemPrompt).toBe('Restored system prompt')
    })

    it('leaves systemPrompt unchanged when snapshot has null systemPrompt', () => {
      agent.systemPrompt = 'Original prompt'

      const snapshot: Snapshot = {
        type: 'agent',
        version: '1.0',
        timestamp: createTimestamp(),
        data: {
          systemPrompt: null as any,
        },
        appData: {},
      }

      loadSnapshot(agent, snapshot)

      // systemPrompt should remain unchanged since snapshot had null
      expect(agent.systemPrompt).toBe('Original prompt')
    })

    it('leaves systemPrompt unchanged when not present in snapshot', () => {
      agent.systemPrompt = 'Original prompt'

      const snapshot: Snapshot = {
        type: 'agent',
        version: '1.0',
        timestamp: createTimestamp(),
        data: {
          messages: [],
        },
        appData: {},
      }

      loadSnapshot(agent, snapshot)

      // systemPrompt should remain unchanged since it wasn't in the snapshot
      expect(agent.systemPrompt).toBe('Original prompt')
    })

    it('clears existing messages before restoring', () => {
      agent.messages.push(new Message({ role: 'user', content: [new TextBlock('Old message')] }))

      const snapshot: Snapshot = {
        type: 'agent',
        version: '1.0',
        timestamp: createTimestamp(),
        data: {
          messages: [{ role: 'user', content: [{ text: 'New message' }] }],
        },
        appData: {},
      }

      loadSnapshot(agent, snapshot)

      expect(agent.messages).toHaveLength(1)
      expect(agent.messages[0]).toEqual(new Message({ role: 'user', content: [new TextBlock('New message')] }))
    })
  })

  describe('round-trip', () => {
    let agent: Agent

    beforeEach(async () => {
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
      agent.state.set('userId', 'user-123')
      agent.state.set('counter', 42)

      const snapshot = takeSnapshot(agent, { preset: 'session' })

      // Modify state
      agent.state.clear()
      agent.state.set('different', 'value')

      // Restore
      loadSnapshot(agent, snapshot)

      expect(agent.state.getAll()).toEqual({
        userId: 'user-123',
        counter: 42,
      })
    })

    it('preserves appData through save/load', () => {
      const snapshot = takeSnapshot(agent, {
        preset: 'session',
        appData: { customData: { nested: true } },
      })

      expect(snapshot.appData).toEqual({ customData: { nested: true } })
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
  })

  describe('empty agent snapshot', () => {
    it('handles empty messages array', () => {
      const agent = createTestAgent()

      const snapshot = takeSnapshot(agent, { include: ['messages'] })
      expect(snapshot.data.messages).toEqual([])

      loadSnapshot(agent, snapshot)
      expect(agent.messages).toHaveLength(0)
    })

    it('handles empty state', () => {
      const agent = createTestAgent()

      const snapshot = takeSnapshot(agent, { include: ['state'] })
      expect(snapshot.data.state).toEqual({})

      loadSnapshot(agent, snapshot)
      expect(agent.state.keys()).toHaveLength(0)
    })
  })

  describe('JSON serialization', () => {
    it('snapshot survives JSON.stringify/JSON.parse round-trip', () => {
      const agent = createTestAgent()
      agent.messages.push(
        new Message({ role: 'user', content: [new TextBlock('Hello')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Hi there!')] })
      )
      agent.state.set('userId', 'user-123')
      agent.state.set('nested', { deep: { value: true } })
      agent.systemPrompt = 'You are a helpful assistant'

      const snapshot = takeSnapshot(agent, {
        preset: 'session',
        appData: { custom: 'data', nested: { array: [1, 2, 3] } },
      })

      // Serialize to JSON string and parse back
      const jsonString = JSON.stringify(snapshot)
      const parsed = JSON.parse(jsonString)

      // Verify structure is preserved
      expect(parsed).toEqual(snapshot)
    })

    it('snapshot with complex content blocks survives JSON round-trip', () => {
      const agent = createTestAgent()
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
      agent.messages.push(
        new Message({ role: 'assistant', content: [toolUseBlock] }),
        new Message({ role: 'user', content: [toolResultBlock] })
      )

      const snapshot = takeSnapshot(agent, { include: ['messages'] })

      // Serialize to JSON string and parse back
      const jsonString = JSON.stringify(snapshot)
      const parsed = JSON.parse(jsonString)

      // Verify structure is preserved
      expect(parsed).toEqual(snapshot)

      // Verify we can load the parsed snapshot
      const newAgent = createTestAgent()
      loadSnapshot(newAgent, parsed)

      expect(newAgent.messages).toHaveLength(2)
      expect(newAgent.messages[0]?.content[0]).toBeInstanceOf(ToolUseBlock)
      expect(newAgent.messages[1]?.content[0]).toBeInstanceOf(ToolResultBlock)
    })

    it('snapshot can be stored and retrieved as JSON string', () => {
      const agent = createTestAgent()
      agent.messages.push(new Message({ role: 'user', content: [new TextBlock('Test message')] }))
      agent.state.set('key', 'value')

      const snapshot = takeSnapshot(agent, { preset: 'session' })

      // Simulate storing to a database or file as JSON
      const stored = JSON.stringify(snapshot)

      // Simulate retrieving and restoring
      const retrieved = JSON.parse(stored)
      const newAgent = createTestAgent()
      loadSnapshot(newAgent, retrieved)

      expect(newAgent.messages).toHaveLength(1)
      expect(newAgent.messages[0]).toEqual(agent.messages[0])
      expect(newAgent.state.getAll()).toEqual({ key: 'value' })
    })
  })
})
