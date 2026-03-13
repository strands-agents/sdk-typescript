import { describe, it, expect } from 'vitest'
import { NullConversationManager } from '../null-conversation-manager.js'
import { Message, TextBlock } from '../../index.js'
import { AfterModelCallEvent, HookableEvent } from '../../hooks/events.js'
import { ContextWindowOverflowError } from '../../errors.js'
import { createMockAgent } from '../../__fixtures__/agent-helpers.js'
import type { HookableEventConstructor, HookCallback } from '../../hooks/types.js'

describe('NullConversationManager', () => {
  describe('behavior', () => {
    it('does not modify conversation history', async () => {
      const manager = new NullConversationManager()
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Hello')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Hi there')] }),
      ]
      const mockAgent = createMockAgent({ messages })

      // NullConversationManager's default initAgent does nothing, so no hooks are registered
      // Let's verify by creating a mock agent and checking no callbacks are registered
      const registeredHooks: Array<{
        eventType: HookableEventConstructor<HookableEvent>
        callback: HookCallback<HookableEvent>
      }> = []
      const pluginAgent = createMockAgent({
        extra: {
          addHook: <T extends HookableEvent>(eventType: HookableEventConstructor<T>, callback: HookCallback<T>) => {
            registeredHooks.push({
              eventType: eventType as HookableEventConstructor<HookableEvent>,
              callback: callback as HookCallback<HookableEvent>,
            })
            return () => {}
          },
        },
      })

      manager.initAgent(pluginAgent)

      // No hooks should be registered (NullConversationManager is a no-op)
      expect(registeredHooks).toHaveLength(0)

      // Verify messages are unchanged
      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]).toEqual({ type: 'textBlock', text: 'Hello' })
      expect(mockAgent.messages[1]!.content[0]).toEqual({ type: 'textBlock', text: 'Hi there' })
    })

    it('does not set retry on context overflow', async () => {
      const manager = new NullConversationManager()
      const mockAgent = createMockAgent()
      const error = new ContextWindowOverflowError('Context overflow')

      const registeredHooks: Array<{
        eventType: HookableEventConstructor<HookableEvent>
        callback: HookCallback<HookableEvent>
      }> = []
      const pluginAgent = createMockAgent({
        extra: {
          addHook: <T extends HookableEvent>(eventType: HookableEventConstructor<T>, callback: HookCallback<T>) => {
            registeredHooks.push({
              eventType: eventType as HookableEventConstructor<HookableEvent>,
              callback: callback as HookCallback<HookableEvent>,
            })
            return () => {}
          },
        },
      })

      manager.initAgent(pluginAgent)

      // No hooks registered, so nothing would set retry
      const event = new AfterModelCallEvent({ agent: mockAgent, error })
      expect(event.retry).toBeUndefined()
    })
  })

  describe('name', () => {
    it('returns the plugin name', () => {
      const manager = new NullConversationManager()
      expect(manager.name).toBe('strands:null-conversation-manager')
    })
  })
})
