import { describe, it, expect } from 'vitest'
import { NullConversationManager } from '../null-conversation-manager.js'
import { Message, TextBlock } from '../../index.js'
import { AfterModelCallEvent } from '../../hooks/events.js'
import { ContextWindowOverflowError } from '../../errors.js'
import { createMockAgent, invokeTrackedHook } from '../../__fixtures__/agent-helpers.js'

describe('NullConversationManager', () => {
  describe('behavior', () => {
    it('does not modify conversation history on overflow', async () => {
      const manager = new NullConversationManager()
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Hello')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Hi there')] }),
      ]
      const mockAgent = createMockAgent({ messages })
      manager.initAgent(mockAgent)

      const error = new ContextWindowOverflowError('Context overflow')
      const event = new AfterModelCallEvent({ agent: mockAgent, model: {} as any, error, invocationState: {} })
      await invokeTrackedHook(mockAgent, event)

      // Messages should be unchanged — NullConversationManager never reduces
      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]).toEqual({ type: 'textBlock', text: 'Hello' })
      expect(mockAgent.messages[1]!.content[0]).toEqual({ type: 'textBlock', text: 'Hi there' })
    })

    it('does not set retry on context overflow', async () => {
      const manager = new NullConversationManager()
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      const error = new ContextWindowOverflowError('Context overflow')
      const event = new AfterModelCallEvent({ agent: mockAgent, model: {} as any, error, invocationState: {} })
      await invokeTrackedHook(mockAgent, event)

      // reduce() returns false, so retry should not be set
      expect(event.retry).toBeUndefined()
    })

    it('registers only the overflow recovery hook', () => {
      const manager = new NullConversationManager()
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      // Base class registers exactly one hook (AfterModelCallEvent for overflow recovery)
      expect(mockAgent.trackedHooks).toHaveLength(1)
      expect(mockAgent.trackedHooks[0]!.eventType).toBe(AfterModelCallEvent)
    })
  })

  describe('name', () => {
    it('returns the plugin name', () => {
      const manager = new NullConversationManager()
      expect(manager.name).toBe('strands:null-conversation-manager')
    })
  })
})
