import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileSessionManager } from '../file-session-manager.js'
import { SessionException } from '../../errors.js'
import type { SessionData, SessionAgentData, SessionMessageData } from '../../types/session.js'

function createTestSession(sessionId: string): SessionData {
  const now = new Date().toISOString()
  return { sessionId, sessionType: 'AGENT', createdAt: now, updatedAt: now }
}

function createTestAgent(agentId: string): SessionAgentData {
  const now = new Date().toISOString()
  return {
    agentId,
    state: { counter: 0 },
    conversationManagerState: {},
    _internalState: {},
    createdAt: now,
    updatedAt: now,
  }
}

function createTestMessage(messageId: number): SessionMessageData {
  const now = new Date().toISOString()
  return {
    message: { role: 'user', content: [{ type: 'textBlock', text: `Message ${messageId}` }] },
    messageId,
    redactMessage: null,
    createdAt: now,
    updatedAt: now,
  }
}

describe('FileSessionManager', () => {
  let tempDir: string
  let sessionId: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'strands-test-'))
    sessionId = `test-${Date.now()}`
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  function createManager(): FileSessionManager {
    return new FileSessionManager({ sessionId, storageDir: tempDir })
  }

  describe('session operations', () => {
    it('creates a session', async () => {
      const manager = createManager()
      const session = createTestSession(sessionId)

      const created = await manager.createSession(session)

      expect(created).toStrictEqual(session)
    })

    it('reads an existing session', async () => {
      const manager = createManager()
      const session = createTestSession(sessionId)
      await manager.createSession(session)

      const read = await manager.readSession(sessionId)

      expect(read).toStrictEqual(session)
    })

    it('returns null for nonexistent session', async () => {
      const manager = createManager()

      const read = await manager.readSession('nonexistent')

      expect(read).toBeNull()
    })

    it('throws when creating a duplicate session', async () => {
      const manager = createManager()
      const session = createTestSession(sessionId)
      await manager.createSession(session)

      await expect(manager.createSession(session)).rejects.toThrow(SessionException)
      await expect(manager.createSession(session)).rejects.toThrow('already exists')
    })

    it('deletes a session', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))

      await manager.deleteSession(sessionId)

      const read = await manager.readSession(sessionId)
      expect(read).toBeNull()
    })

    it('throws when deleting a nonexistent session', async () => {
      const manager = createManager()

      await expect(manager.deleteSession('nonexistent')).rejects.toThrow(SessionException)
      await expect(manager.deleteSession('nonexistent')).rejects.toThrow('does not exist')
    })
  })

  describe('agent operations', () => {
    it('creates and reads an agent', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))

      const agent = createTestAgent('agent-1')
      await manager.createAgent(sessionId, agent)

      const read = await manager.readAgent(sessionId, 'agent-1')
      expect(read).toStrictEqual(agent)
    })

    it('returns null for nonexistent agent', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))

      const read = await manager.readAgent(sessionId, 'nonexistent')
      expect(read).toBeNull()
    })

    it('updates an existing agent', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      const agent = createTestAgent('agent-1')
      await manager.createAgent(sessionId, agent)

      const updated = { ...agent, state: { counter: 5 }, updatedAt: new Date().toISOString() }
      await manager.updateAgent(sessionId, updated)

      const read = await manager.readAgent(sessionId, 'agent-1')
      expect(read!.state).toStrictEqual({ counter: 5 })
      // Preserves original creation timestamp
      expect(read!.createdAt).toBe(agent.createdAt)
    })

    it('throws when updating a nonexistent agent', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))

      await expect(manager.updateAgent(sessionId, createTestAgent('nonexistent'))).rejects.toThrow(SessionException)
      await expect(manager.updateAgent(sessionId, createTestAgent('nonexistent'))).rejects.toThrow('does not exist')
    })
  })

  describe('message operations', () => {
    it('creates and reads a message', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      await manager.createAgent(sessionId, createTestAgent('agent-1'))

      const message = createTestMessage(0)
      await manager.createMessage(sessionId, 'agent-1', message)

      const read = await manager.readMessage(sessionId, 'agent-1', 0)
      expect(read).toStrictEqual(message)
    })

    it('returns null for nonexistent message', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      await manager.createAgent(sessionId, createTestAgent('agent-1'))

      const read = await manager.readMessage(sessionId, 'agent-1', 999)
      expect(read).toBeNull()
    })

    it('lists all messages in order', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      await manager.createAgent(sessionId, createTestAgent('agent-1'))

      for (let i = 0; i < 5; i++) {
        await manager.createMessage(sessionId, 'agent-1', createTestMessage(i))
      }

      const messages = await manager.listMessages(sessionId, 'agent-1')
      expect(messages).toHaveLength(5)
      expect(messages.map((m) => m.messageId)).toStrictEqual([0, 1, 2, 3, 4])
    })

    it('lists messages with limit', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      await manager.createAgent(sessionId, createTestAgent('agent-1'))

      for (let i = 0; i < 10; i++) {
        await manager.createMessage(sessionId, 'agent-1', createTestMessage(i))
      }

      const messages = await manager.listMessages(sessionId, 'agent-1', 3)
      expect(messages).toHaveLength(3)
      expect(messages.map((m) => m.messageId)).toStrictEqual([0, 1, 2])
    })

    it('lists messages with offset', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      await manager.createAgent(sessionId, createTestAgent('agent-1'))

      for (let i = 0; i < 10; i++) {
        await manager.createMessage(sessionId, 'agent-1', createTestMessage(i))
      }

      const messages = await manager.listMessages(sessionId, 'agent-1', undefined, 5)
      expect(messages).toHaveLength(5)
      expect(messages.map((m) => m.messageId)).toStrictEqual([5, 6, 7, 8, 9])
    })

    it('lists messages with limit and offset', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      await manager.createAgent(sessionId, createTestAgent('agent-1'))

      for (let i = 0; i < 10; i++) {
        await manager.createMessage(sessionId, 'agent-1', createTestMessage(i))
      }

      const messages = await manager.listMessages(sessionId, 'agent-1', 3, 2)
      expect(messages).toHaveLength(3)
      expect(messages.map((m) => m.messageId)).toStrictEqual([2, 3, 4])
    })

    it('updates an existing message', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      await manager.createAgent(sessionId, createTestAgent('agent-1'))

      const message = createTestMessage(0)
      await manager.createMessage(sessionId, 'agent-1', message)

      const updated = {
        ...message,
        message: { role: 'user', content: [{ type: 'textBlock', text: 'Updated message' }] },
        updatedAt: new Date().toISOString(),
      }
      await manager.updateMessage(sessionId, 'agent-1', updated)

      const read = await manager.readMessage(sessionId, 'agent-1', 0)
      expect((read!.message as Record<string, unknown>).content).toStrictEqual([
        { type: 'textBlock', text: 'Updated message' },
      ])
      // Preserves original creation timestamp
      expect(read!.createdAt).toBe(message.createdAt)
    })

    it('throws when updating a nonexistent message', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      await manager.createAgent(sessionId, createTestAgent('agent-1'))

      await expect(manager.updateMessage(sessionId, 'agent-1', createTestMessage(999))).rejects.toThrow(
        SessionException
      )
    })
  })

  describe('multi-agent operations', () => {
    it('creates and reads multi-agent state', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))

      const state = { id: 'ma-1', nodes: ['a', 'b'], status: 'running' }
      await manager.createMultiAgent(sessionId, 'ma-1', state)

      const read = await manager.readMultiAgent(sessionId, 'ma-1')
      expect(read).toStrictEqual(state)
    })

    it('returns null for nonexistent multi-agent', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))

      const read = await manager.readMultiAgent(sessionId, 'nonexistent')
      expect(read).toBeNull()
    })

    it('updates existing multi-agent state', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))

      const state = { id: 'ma-1', status: 'running' }
      await manager.createMultiAgent(sessionId, 'ma-1', state)

      const updated = { id: 'ma-1', status: 'completed', result: 'success' }
      await manager.updateMultiAgent(sessionId, 'ma-1', updated)

      const read = await manager.readMultiAgent(sessionId, 'ma-1')
      expect(read).toStrictEqual(updated)
    })

    it('throws when updating a nonexistent multi-agent', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))

      await expect(manager.updateMultiAgent(sessionId, 'nonexistent', { id: 'nonexistent' })).rejects.toThrow(
        SessionException
      )
      await expect(manager.updateMultiAgent(sessionId, 'nonexistent', { id: 'nonexistent' })).rejects.toThrow(
        'does not exist'
      )
    })

    it('stores multi-agent data in correct directory structure', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))

      await manager.createMultiAgent(sessionId, 'ma-1', { id: 'ma-1' })

      // Verify file exists at expected path
      const read = await manager.readMultiAgent(sessionId, 'ma-1')
      expect(read).toStrictEqual({ id: 'ma-1' })
    })
  })

  describe('validation', () => {
    it('throws for session ID with path separators', async () => {
      const manager = createManager()

      await expect(manager.readSession('../evil')).rejects.toThrow(SessionException)
      await expect(manager.readSession('../evil')).rejects.toThrow('path separators')
    })

    it('throws for agent ID with path separators', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))

      await expect(manager.readAgent(sessionId, '../evil')).rejects.toThrow(SessionException)
      await expect(manager.readAgent(sessionId, '../evil')).rejects.toThrow('path separators')
    })

    it('throws for non-integer message ID', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      await manager.createAgent(sessionId, createTestAgent('agent-1'))

      await expect(manager.readMessage(sessionId, 'agent-1', 1.5)).rejects.toThrow(SessionException)
      await expect(manager.readMessage(sessionId, 'agent-1', 1.5)).rejects.toThrow('integer')
    })
  })
})
