import { describe, expect, it, vi, beforeEach } from 'vitest'
import { A2AClient, sanitizeToolName, extractText } from '../client.js'
import type { AgentCard, Task, Message as A2AMessage } from '@a2a-js/sdk'
import { TextBlock, Message } from '../../types/messages.js'
import type { InvokeArgs } from '../../agent/agent.js'
import { AgentResultEvent } from '../../hooks/events.js'

// Mock the A2A SDK client
const mockSendMessage = vi.fn()
const mockGetAgentCard = vi.fn()

vi.mock('@a2a-js/sdk/client', () => ({
  ClientFactory: class MockClientFactory {
    async createFromUrl(): Promise<{ sendMessage: typeof mockSendMessage; getAgentCard: typeof mockGetAgentCard }> {
      return {
        sendMessage: mockSendMessage,
        getAgentCard: mockGetAgentCard,
      }
    }
  },
}))

const mockAgentCard: AgentCard = {
  name: 'Remote Agent',
  description: 'A remote agent for testing',
  version: '1.0.0',
  protocolVersion: '0.2.0',
  url: 'http://localhost:9000',
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [],
  capabilities: {},
}

const mockTaskResponse: Task = {
  kind: 'task',
  id: 'task-1',
  contextId: 'ctx-1',
  status: { state: 'completed' },
  artifacts: [
    {
      artifactId: 'art-1',
      parts: [{ kind: 'text', text: 'Agent response' }],
    },
  ],
}

describe('A2AClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAgentCard.mockResolvedValue(mockAgentCard)
    mockSendMessage.mockResolvedValue(mockTaskResponse)
  })

  describe('connect', () => {
    it('creates client and fetches agent card', async () => {
      const client = new A2AClient({ url: 'http://localhost:9000' })
      await client.connect()
      expect(mockGetAgentCard).toHaveBeenCalledOnce()
    })

    it('does not reconnect when already connected', async () => {
      const client = new A2AClient({ url: 'http://localhost:9000' })
      await client.connect()
      await client.connect()
      expect(mockGetAgentCard).toHaveBeenCalledOnce()
    })

    it('reconnects when reconnect flag is true', async () => {
      const client = new A2AClient({ url: 'http://localhost:9000' })
      await client.connect()
      await client.connect(true)
      expect(mockGetAgentCard).toHaveBeenCalledTimes(2)
    })
  })

  describe('disconnect', () => {
    it('clears client state so next connect re-fetches', async () => {
      const client = new A2AClient({ url: 'http://localhost:9000' })
      await client.connect()
      await client.disconnect()
      await client.connect()
      expect(mockGetAgentCard).toHaveBeenCalledTimes(2)
    })
  })

  describe('invoke', () => {
    it('returns AgentResult with response text', async () => {
      const client = new A2AClient({ url: 'http://localhost:9000' })

      const result = await client.invoke('Hello')

      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')
      expect(result.lastMessage.content).toHaveLength(1)
      expect(result.lastMessage.content[0]).toBeInstanceOf(TextBlock)
      expect((result.lastMessage.content[0] as TextBlock).text).toBe('Agent response')
    })

    it.each([
      { desc: 'string', args: 'Hello from string', expectedText: 'Hello from string' },
      { desc: 'ContentBlock[]', args: [new TextBlock('Hello from blocks')], expectedText: 'Hello from blocks' },
      { desc: 'ContentBlockData[]', args: [{ text: 'Hello from data' }], expectedText: 'Hello from data' },
      {
        desc: 'multiple ContentBlocks joined with newline',
        args: [new TextBlock('Line 1'), new TextBlock('Line 2')],
        expectedText: 'Line 1\nLine 2',
      },
      {
        desc: 'Message[] (last user message)',
        args: [
          new Message({ role: 'user', content: [new TextBlock('First')] }),
          new Message({ role: 'assistant', content: [new TextBlock('Response')] }),
          new Message({ role: 'user', content: [new TextBlock('Second')] }),
        ],
        expectedText: 'Second',
      },
      {
        desc: 'MessageData[] (plain objects)',
        args: [{ role: 'user', content: [{ text: 'From plain data' }] }],
        expectedText: 'From plain data',
      },
      {
        desc: 'Message[] with no user messages',
        args: [new Message({ role: 'assistant', content: [new TextBlock('No user')] })],
        expectedText: '',
      },
      { desc: 'empty array', args: [] as TextBlock[], expectedText: '' },
    ])('sends correct parts for $desc input', async ({ args, expectedText }) => {
      const client = new A2AClient({ url: 'http://localhost:9000' })

      await client.invoke(args as InvokeArgs)

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            parts: [{ kind: 'text', text: expectedText }],
          }),
        })
      )
    })

    it('auto-connects on first invoke', async () => {
      const client = new A2AClient({ url: 'http://localhost:9000' })
      await client.invoke('Hello')
      expect(mockGetAgentCard).toHaveBeenCalledOnce()
    })
  })

  describe('stream', () => {
    it('yields AgentResultEvent and returns AgentResult', async () => {
      const client = new A2AClient({ url: 'http://localhost:9000' })
      const generator = client.stream('Hello')

      const events: unknown[] = []
      let next = await generator.next()
      while (!next.done) {
        events.push(next.value)
        next = await generator.next()
      }

      expect(events).toHaveLength(1)
      expect(events[0]).toBeInstanceOf(AgentResultEvent)
      expect((events[0] as AgentResultEvent).result.stopReason).toBe('endTurn')
      expect(next.value.stopReason).toBe('endTurn')
      expect(next.value.lastMessage.content[0]).toBeInstanceOf(TextBlock)
    })
  })

  describe('sendMessage', () => {
    it('sends A2A message and extracts response text from Task', async () => {
      const client = new A2AClient({ url: 'http://localhost:9000' })

      const result = await client.sendMessage('Hello')

      expect(result).toBe('Agent response')
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            kind: 'message',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          }),
        })
      )
    })

    it('extracts response text from Message response', async () => {
      mockSendMessage.mockResolvedValue({
        kind: 'message',
        messageId: 'msg-1',
        role: 'agent',
        parts: [{ kind: 'text', text: 'Direct response' }],
      })
      const client = new A2AClient({ url: 'http://localhost:9000' })

      expect(await client.sendMessage('Hello')).toBe('Direct response')
    })
  })
})

describe('sanitizeToolName', () => {
  it.each([
    { input: 'My Agent!', expected: 'My_Agent', desc: 'replaces special characters' },
    { input: 'my---agent', expected: 'my_agent', desc: 'collapses multiple underscores' },
    { input: '_my_agent_', expected: 'my_agent', desc: 'removes leading/trailing underscores' },
    { input: 'a'.repeat(100), expected: 'a'.repeat(64), desc: 'truncates to 64 characters' },
    { input: '!!!', expected: 'a2a_agent', desc: 'falls back for empty result' },
    { input: 'agent_123', expected: 'agent_123', desc: 'preserves valid characters' },
  ])('$desc', ({ input, expected }) => {
    expect(sanitizeToolName(input)).toBe(expected)
  })
})

describe('extractText', () => {
  it.each<{ desc: string; result: Task | A2AMessage; expected: string }>([
    {
      desc: 'extracts text from Task artifacts',
      result: {
        kind: 'task',
        id: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'completed' },
        artifacts: [
          {
            artifactId: 'art-1',
            parts: [
              { kind: 'text', text: 'Part 1' },
              { kind: 'text', text: 'Part 2' },
            ],
          },
        ],
      } as Task,
      expected: 'Part 1\nPart 2',
    },
    {
      desc: 'extracts text from multiple Task artifacts',
      result: {
        kind: 'task',
        id: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'completed' },
        artifacts: [
          { artifactId: 'art-1', parts: [{ kind: 'text', text: 'First' }] },
          { artifactId: 'art-2', parts: [{ kind: 'text', text: 'Second' }] },
        ],
      } as Task,
      expected: 'First\nSecond',
    },
    {
      desc: 'falls back to Task status message when no artifacts',
      result: {
        kind: 'task',
        id: 'task-1',
        contextId: 'ctx-1',
        status: {
          state: 'completed',
          message: {
            kind: 'message',
            messageId: 'msg-1',
            role: 'agent',
            parts: [{ kind: 'text', text: 'Status text' }],
          },
        },
      } as Task,
      expected: 'Status text',
    },
    {
      desc: 'returns empty string for Task with no text content',
      result: { kind: 'task', id: 'task-1', contextId: 'ctx-1', status: { state: 'completed' } } as Task,
      expected: '',
    },
    {
      desc: 'extracts text from Message parts, ignoring non-text parts',
      result: {
        kind: 'message',
        messageId: 'msg-1',
        role: 'agent',
        parts: [
          { kind: 'text', text: 'Hello' },
          { kind: 'file', file: { uri: 'file://test.txt' } },
          { kind: 'text', text: 'World' },
        ],
      } as A2AMessage,
      expected: 'Hello\nWorld',
    },
  ])('$desc', ({ result, expected }) => {
    expect(extractText(result)).toBe(expected)
  })
})
