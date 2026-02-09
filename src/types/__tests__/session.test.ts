import { describe, it, expect } from 'vitest'
import {
  SESSION_TYPE_AGENT,
  createSession,
  createSessionAgent,
  createSessionMessage,
  sessionMessageToRecord,
  encodeBytesValues,
  decodeBytesValues,
} from '../session.js'
import { Message, TextBlock, ToolUseBlock } from '../messages.js'

describe('Session types', () => {
  describe('createSession', () => {
    it('creates session with default AGENT type', () => {
      const session = createSession('test-session-1')

      expect(session.sessionId).toBe('test-session-1')
      expect(session.sessionType).toBe(SESSION_TYPE_AGENT)
      expect(session.createdAt).toBeDefined()
      expect(session.updatedAt).toBeDefined()
      expect(session.createdAt).toBe(session.updatedAt)
    })

    it('creates session with explicit type', () => {
      const session = createSession('test-session-2', SESSION_TYPE_AGENT)

      expect(session.sessionId).toBe('test-session-2')
      expect(session.sessionType).toBe(SESSION_TYPE_AGENT)
    })

    it('is JSON serializable', () => {
      const session = createSession('roundtrip')
      const json = JSON.stringify(session)
      const parsed = JSON.parse(json)

      expect(parsed).toStrictEqual(session)
    })
  })

  describe('createSessionAgent', () => {
    it('creates agent with state and conversation manager state', () => {
      const state = { counter: 5, name: 'test' }
      const cmState = { removedMessageCount: 2 }

      const agent = createSessionAgent('agent-1', state, cmState)

      expect(agent.agentId).toBe('agent-1')
      expect(agent.state).toStrictEqual(state)
      expect(agent.conversationManagerState).toStrictEqual(cmState)
      expect(agent._internalState).toStrictEqual({})
      expect(agent.createdAt).toBeDefined()
      expect(agent.updatedAt).toBeDefined()
    })

    it('creates agent with default empty _internalState', () => {
      const agent = createSessionAgent('agent-1', { key: 'value' }, {})
      expect(agent._internalState).toStrictEqual({})
    })

    it('creates agent with provided _internalState', () => {
      const internalState = {
        interruptState: { interrupts: {}, context: { test: 'init' }, activated: false },
      }
      const agent = createSessionAgent('agent-1', {}, {}, internalState)
      expect(agent._internalState).toStrictEqual(internalState)
    })

    it('includes _internalState in JSON serialization', () => {
      const internalState = { interruptState: { interrupts: {}, context: {}, activated: true } }
      const agent = createSessionAgent('agent-1', {}, {}, internalState)
      const json = JSON.stringify(agent)
      const parsed = JSON.parse(json)
      expect(parsed._internalState).toStrictEqual(internalState)
    })

    it('is JSON serializable', () => {
      const agent = createSessionAgent('agent-1', { key: 'value' }, {})
      const json = JSON.stringify(agent)
      const parsed = JSON.parse(json)

      expect(parsed).toStrictEqual(agent)
    })
  })

  describe('createSessionMessage', () => {
    it('creates message with sequential index', () => {
      const message = new Message({
        role: 'user',
        content: [new TextBlock('Hello')],
      })

      const sessionMessage = createSessionMessage(message, 0)

      expect(sessionMessage.messageId).toBe(0)
      expect(sessionMessage.redactMessage).toBeNull()
      expect(sessionMessage.createdAt).toBeDefined()
      expect(sessionMessage.updatedAt).toBeDefined()
      expect(sessionMessage.message).toBeDefined()
      expect((sessionMessage.message as Record<string, unknown>).role).toBe('user')
    })

    it('serializes content blocks to plain objects', () => {
      const message = new Message({
        role: 'assistant',
        content: [
          new TextBlock('response text'),
          new ToolUseBlock({ name: 'tool1', toolUseId: 'tu-1', input: { key: 'value' } }),
        ],
      })

      const sessionMessage = createSessionMessage(message, 1)
      const content = (sessionMessage.message as Record<string, unknown>).content as Array<Record<string, unknown>>

      expect(content).toHaveLength(2)
      expect(content[0]!.type).toBe('textBlock')
      expect(content[0]!.text).toBe('response text')
      expect(content[1]!.type).toBe('toolUseBlock')
      expect(content[1]!.name).toBe('tool1')
    })

    it('is JSON serializable', () => {
      const message = new Message({
        role: 'user',
        content: [new TextBlock('test')],
      })
      const sessionMessage = createSessionMessage(message, 0)
      const json = JSON.stringify(sessionMessage)
      const parsed = JSON.parse(json)

      expect(parsed.messageId).toBe(0)
      expect(parsed.message.role).toBe('user')
    })
  })

  describe('sessionMessageToRecord', () => {
    it('returns message record when not redacted', () => {
      const message = new Message({
        role: 'user',
        content: [new TextBlock('Hello')],
      })
      const sessionMessage = createSessionMessage(message, 0)

      const record = sessionMessageToRecord(sessionMessage)

      expect(record.role).toBe('user')
      expect((record.content as Array<Record<string, unknown>>)[0]!.text).toBe('Hello')
    })

    it('returns redact content when redacted', () => {
      const message = new Message({
        role: 'user',
        content: [new TextBlock('original')],
      })
      const sessionMessage = createSessionMessage(message, 0)

      // Simulate redaction
      sessionMessage.redactMessage = {
        role: 'user',
        content: [{ type: 'textBlock', text: '[REDACTED]' }],
      }

      const record = sessionMessageToRecord(sessionMessage)

      expect(record.role).toBe('user')
      expect((record.content as Array<Record<string, unknown>>)[0]!.text).toBe('[REDACTED]')
    })
  })

  describe('encodeBytesValues', () => {
    it('encodes Uint8Array to base64 representation', () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
      const encoded = encodeBytesValues(bytes) as Record<string, unknown>

      expect(encoded.__bytes_encoded__).toBe(true)
      expect(typeof encoded.data).toBe('string')
    })

    it('passes through primitive values unchanged', () => {
      expect(encodeBytesValues('hello')).toBe('hello')
      expect(encodeBytesValues(42)).toBe(42)
      expect(encodeBytesValues(true)).toBe(true)
      expect(encodeBytesValues(null)).toBeNull()
    })

    it('recursively encodes bytes in nested objects', () => {
      const input = {
        name: 'test',
        data: new Uint8Array([1, 2, 3]),
        nested: {
          moreData: new Uint8Array([4, 5, 6]),
          value: 'plain',
        },
      }

      const encoded = encodeBytesValues(input) as Record<string, unknown>

      expect((encoded.data as Record<string, unknown>).__bytes_encoded__).toBe(true)
      expect(((encoded.nested as Record<string, unknown>).moreData as Record<string, unknown>).__bytes_encoded__).toBe(
        true
      )
      expect((encoded.nested as Record<string, unknown>).value).toBe('plain')
    })

    it('recursively encodes bytes in arrays', () => {
      const input = [new Uint8Array([1, 2]), 'plain', new Uint8Array([3, 4])]

      const encoded = encodeBytesValues(input) as unknown[]

      expect((encoded[0] as Record<string, unknown>).__bytes_encoded__).toBe(true)
      expect(encoded[1]).toBe('plain')
      expect((encoded[2] as Record<string, unknown>).__bytes_encoded__).toBe(true)
    })
  })

  describe('decodeBytesValues', () => {
    it('decodes base64 representation back to Uint8Array', () => {
      const original = new Uint8Array([72, 101, 108, 108, 111])
      const encoded = encodeBytesValues(original)
      const decoded = decodeBytesValues(encoded)

      expect(decoded).toBeInstanceOf(Uint8Array)
      expect(decoded).toStrictEqual(original)
    })

    it('passes through primitive values unchanged', () => {
      expect(decodeBytesValues('hello')).toBe('hello')
      expect(decodeBytesValues(42)).toBe(42)
      expect(decodeBytesValues(true)).toBe(true)
      expect(decodeBytesValues(null)).toBeNull()
    })

    it('recursively decodes bytes in nested objects', () => {
      const original = {
        name: 'test',
        data: new Uint8Array([1, 2, 3]),
        nested: {
          moreData: new Uint8Array([4, 5, 6]),
          value: 'plain',
        },
      }

      const roundtripped = decodeBytesValues(encodeBytesValues(original)) as Record<string, unknown>

      expect(roundtripped.name).toBe('test')
      expect(roundtripped.data).toStrictEqual(new Uint8Array([1, 2, 3]))
      expect((roundtripped.nested as Record<string, unknown>).moreData).toStrictEqual(new Uint8Array([4, 5, 6]))
      expect((roundtripped.nested as Record<string, unknown>).value).toBe('plain')
    })

    it('recursively decodes bytes in arrays', () => {
      const original = [new Uint8Array([1, 2]), 'plain', new Uint8Array([3, 4])]

      const roundtripped = decodeBytesValues(encodeBytesValues(original)) as unknown[]

      expect(roundtripped[0]).toStrictEqual(new Uint8Array([1, 2]))
      expect(roundtripped[1]).toBe('plain')
      expect(roundtripped[2]).toStrictEqual(new Uint8Array([3, 4]))
    })

    it('does not decode objects without __bytes_encoded__ marker', () => {
      const input = { data: 'SGVsbG8=' } // base64 string without marker
      const result = decodeBytesValues(input) as Record<string, unknown>

      expect(result.data).toBe('SGVsbG8=')
    })
  })

  describe('encode/decode round-trip with message content', () => {
    it('roundtrips a message with Uint8Array content through session serialization', () => {
      const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) // PNG header
      const message = new Message({
        role: 'user',
        content: [new TextBlock('See this image')],
      })

      // Simulate what createSessionMessage does internally
      const sessionMessage = createSessionMessage(message, 0)

      // Manually add binary content to test encoding
      const encodedMsg = encodeBytesValues({ imageBytes }) as Record<string, unknown>
      const decoded = decodeBytesValues(encodedMsg) as Record<string, unknown>

      expect(decoded.imageBytes).toStrictEqual(imageBytes)
      expect(sessionMessage.messageId).toBe(0)
    })
  })
})
