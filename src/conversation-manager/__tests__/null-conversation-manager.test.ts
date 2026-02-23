import { describe, it, expect } from 'vitest'
import { NullConversationManager } from '../null-conversation-manager.js'
import { Message, TextBlock } from '../../index.js'
import { HookRegistryImplementation } from '../../hooks/registry.js'
import { AfterInvocationEvent, AfterModelCallEvent } from '../../hooks/events.js'
import { ContextWindowOverflowError } from '../../errors.js'
import { createMockAgent } from '../../__fixtures__/agent-helpers.js'

describe('NullConversationManager', () => {
  describe('behavior', () => {
    it('does not modify conversation history', async () => {
      const manager = new NullConversationManager()
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Hello')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Hi there')] }),
      ]
      const mockAgent = createMockAgent({ messages })

      const registry = new HookRegistryImplementation()
      manager.registerCallbacks(registry)

      await registry.invokeCallbacks(new AfterInvocationEvent({ agent: mockAgent }))

      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]).toEqual({ type: 'textBlock', text: 'Hello' })
      expect(mockAgent.messages[1]!.content[0]).toEqual({ type: 'textBlock', text: 'Hi there' })
    })

    it('does not set retry on context overflow', async () => {
      const manager = new NullConversationManager()
      const mockAgent = createMockAgent()
      const error = new ContextWindowOverflowError('Context overflow')

      const registry = new HookRegistryImplementation()
      manager.registerCallbacks(registry)

      const event = await registry.invokeCallbacks(new AfterModelCallEvent({ agent: mockAgent, error }))

      expect(event.retry).toBeUndefined()
    })
  })
})
