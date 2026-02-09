import { describe, it, expect, vi, beforeEach } from 'vitest'
import { S3SessionManager } from '../s3-session-manager.js'
import { SessionException } from '../../errors.js'
import type { SessionData, SessionAgentData, SessionMessageData } from '../../types/session.js'

/**
 * In-memory S3 mock that simulates S3 object operations.
 * Tracks all stored objects by key for verification.
 */
function createMockS3() {
  const store = new Map<string, string>()

  const mockSend = vi.fn(async (command: { _type: string; input: Record<string, unknown> }) => {
    const type = command._type

    if (type === 'GetObject') {
      const key = command.input.Key as string
      const body = store.get(key)
      if (body === undefined) {
        const error = new Error('NoSuchKey')
        error.name = 'NoSuchKey'
        throw error
      }
      return { Body: { transformToString: async () => body } }
    }

    if (type === 'PutObject') {
      const key = command.input.Key as string
      const body = command.input.Body as string
      store.set(key, body)
      return {}
    }

    if (type === 'ListObjectsV2') {
      const prefix = command.input.Prefix as string
      const contents = [...store.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ Key: key }))
      return { Contents: contents, IsTruncated: false }
    }

    if (type === 'DeleteObjects') {
      const objects = (command.input.Delete as Record<string, unknown>).Objects as Array<{ Key: string }>
      for (const obj of objects) {
        store.delete(obj.Key)
      }
      return {}
    }

    throw new Error(`Unknown command type: ${type}`)
  })

  const mockClient = { send: mockSend }

  // Command classes (must be callable with `new`)
  class MockGetObjectCommand {
    _type = 'GetObject'
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }
  class MockPutObjectCommand {
    _type = 'PutObject'
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }
  class MockListObjectsV2Command {
    _type = 'ListObjectsV2'
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }
  class MockDeleteObjectsCommand {
    _type = 'DeleteObjects'
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }

  const mockModule = {
    S3Client: class {
      send = mockSend
    },
    GetObjectCommand: MockGetObjectCommand,
    PutObjectCommand: MockPutObjectCommand,
    ListObjectsV2Command: MockListObjectsV2Command,
    DeleteObjectsCommand: MockDeleteObjectsCommand,
  }

  return { store, mockClient, mockModule, mockSend }
}

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

describe('S3SessionManager', () => {
  const sessionId = 'test-session'
  const bucket = 'test-bucket'
  let mock: ReturnType<typeof createMockS3>

  beforeEach(() => {
    mock = createMockS3()
    // Mock the dynamic import of @aws-sdk/client-s3
    vi.doMock('@aws-sdk/client-s3', () => mock.mockModule)
  })

  function createManager(prefix?: string): S3SessionManager {
    return new S3SessionManager({
      sessionId,
      bucket,
      prefix,
      s3Client: mock.mockClient as never,
    })
  }

  describe('session operations', () => {
    it('creates a session', async () => {
      const manager = createManager()
      const session = createTestSession(sessionId)

      const created = await manager.createSession(session)

      expect(created).toStrictEqual(session)
      expect(mock.store.has(`session_${sessionId}/session.json`)).toBe(true)
    })

    it('creates a session with prefix', async () => {
      const manager = createManager('my-prefix')
      const session = createTestSession(sessionId)

      await manager.createSession(session)

      expect(mock.store.has(`my-prefix/session_${sessionId}/session.json`)).toBe(true)
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

    it('deletes a session and all its data', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      await manager.createAgent(sessionId, createTestAgent('agent-1'))
      await manager.createMessage(sessionId, 'agent-1', createTestMessage(0))

      await manager.deleteSession(sessionId)

      const keysWithPrefix = [...mock.store.keys()].filter((k) => k.includes(sessionId))
      expect(keysWithPrefix).toHaveLength(0)
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

    it('updates an existing agent and preserves createdAt', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      const agent = createTestAgent('agent-1')
      await manager.createAgent(sessionId, agent)

      const updated = { ...agent, state: { counter: 10 }, updatedAt: new Date().toISOString() }
      await manager.updateAgent(sessionId, updated)

      const read = await manager.readAgent(sessionId, 'agent-1')
      expect(read!.state).toStrictEqual({ counter: 10 })
      expect(read!.createdAt).toBe(agent.createdAt)
    })

    it('throws when updating a nonexistent agent', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))

      await expect(manager.updateAgent(sessionId, createTestAgent('nonexistent'))).rejects.toThrow(SessionException)
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

    it('lists messages with pagination', async () => {
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

    it('returns empty list when no messages exist', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      await manager.createAgent(sessionId, createTestAgent('agent-1'))

      // Manually create the message prefix key area (simulate empty messages dir)
      const messages = await manager.listMessages(sessionId, 'agent-1')
      expect(messages).toHaveLength(0)
    })

    it('updates an existing message and preserves createdAt', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))
      await manager.createAgent(sessionId, createTestAgent('agent-1'))

      const message = createTestMessage(0)
      await manager.createMessage(sessionId, 'agent-1', message)

      const updated = {
        ...message,
        message: { role: 'user', content: [{ type: 'textBlock', text: 'Updated' }] },
        updatedAt: new Date().toISOString(),
      }
      await manager.updateMessage(sessionId, 'agent-1', updated)

      const read = await manager.readMessage(sessionId, 'agent-1', 0)
      expect((read!.message as Record<string, unknown>).content).toStrictEqual([{ type: 'textBlock', text: 'Updated' }])
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
    })

    it('stores multi-agent data at correct S3 key', async () => {
      const manager = createManager()
      await manager.createSession(createTestSession(sessionId))

      await manager.createMultiAgent(sessionId, 'ma-1', { id: 'ma-1' })

      const expectedKey = `session_${sessionId}/multi_agents/multi_agent_ma-1/multi_agent.json`
      expect(mock.store.has(expectedKey)).toBe(true)
    })

    it('stores multi-agent data with prefix at correct S3 key', async () => {
      const manager = createManager('my-prefix')
      const session = createTestSession(sessionId)
      await manager.createSession(session)

      await manager.createMultiAgent(sessionId, 'ma-1', { id: 'ma-1' })

      const expectedKey = `my-prefix/session_${sessionId}/multi_agents/multi_agent_ma-1/multi_agent.json`
      expect(mock.store.has(expectedKey)).toBe(true)
    })
  })

  describe('S3 client initialization', () => {
    it('throws descriptive error when @aws-sdk/client-s3 is not installed', async () => {
      vi.doMock('@aws-sdk/client-s3', () => {
        throw new Error('Cannot find module')
      })

      // Create without providing a client — forces lazy initialization
      const manager = new S3SessionManager({ sessionId, bucket })

      await expect(manager.readSession(sessionId)).rejects.toThrow(SessionException)
      await expect(manager.readSession(sessionId)).rejects.toThrow('@aws-sdk/client-s3')
    })
  })
})
