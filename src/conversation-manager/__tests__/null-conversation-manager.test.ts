import { describe, it, expect } from 'vitest'
import { NullConversationManager } from '../null-conversation-manager.js'
import { ContextWindowOverflowError, Message, TextBlock } from '../../index.js'
import type { Agent } from '../../agent/agent.js'

describe('NullConversationManager', () => {
  describe('applyManagement', () => {
    it('does not modify messages array', () => {
      const manager = new NullConversationManager()
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Hello')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Hi there')] }),
      ]
      const mockAgent = { messages } as unknown as Agent

      manager.applyManagement(mockAgent)

      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]).toEqual({ type: 'textBlock', text: 'Hello' })
      expect(mockAgent.messages[1]!.content[0]).toEqual({ type: 'textBlock', text: 'Hi there' })
    })
  })

  describe('reduceContext', () => {
    it('re-throws provided error', () => {
      const manager = new NullConversationManager()
      const mockAgent = { messages: [] } as unknown as Agent
      const testError = new Error('Test error')

      expect(() => {
        manager.reduceContext(mockAgent, testError)
      }).toThrow(testError)
    })

    it('throws ContextWindowOverflowError when no error provided', () => {
      const manager = new NullConversationManager()
      const mockAgent = { messages: [] } as unknown as Agent

      expect(() => {
        manager.reduceContext(mockAgent)
      }).toThrow(ContextWindowOverflowError)
    })

    it('throws ContextWindowOverflowError with correct message when no error provided', () => {
      const manager = new NullConversationManager()
      const mockAgent = { messages: [] } as unknown as Agent

      expect(() => {
        manager.reduceContext(mockAgent)
      }).toThrow('Context window overflowed!')
    })
  })

  describe('removedMessageCount', () => {
    it('remains 0 after operations', () => {
      const manager = new NullConversationManager()
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Hello')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Hi')] }),
      ]
      const mockAgent = { messages } as unknown as Agent

      manager.applyManagement(mockAgent)
      expect(manager.removedMessageCount).toBe(0)

      try {
        manager.reduceContext(mockAgent)
      } catch {
        // Expected to throw
      }
      expect(manager.removedMessageCount).toBe(0)
    })
  })
})
