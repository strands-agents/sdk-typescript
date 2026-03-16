import { describe, it, expect } from 'vitest'
import { ConversationManager, type ReduceOptions } from '../conversation-manager.js'
import { NullConversationManager } from '../null-conversation-manager.js'
import { Agent } from '../../agent/agent.js'
import { Message, TextBlock } from '../../index.js'
import { AfterModelCallEvent } from '../../hooks/events.js'
import { ContextWindowOverflowError } from '../../errors.js'
import { createMockAgent, invokeTrackedHook } from '../../__fixtures__/agent-helpers.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'

class TestConversationManager extends ConversationManager {
  readonly name = 'test:conversation-manager'
  reduceCallCount = 0
  shouldReduce = true

  reduce({ messages }: ReduceOptions): boolean {
    this.reduceCallCount++
    if (!this.shouldReduce) return false
    messages.splice(0, 1)
    return true
  }
}

describe('ConversationManager', () => {
  describe('initAgent', () => {
    it('registers an AfterModelCallEvent hook', () => {
      const manager = new TestConversationManager()
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      expect(mockAgent.trackedHooks).toHaveLength(1)
      expect(mockAgent.trackedHooks[0]!.eventType).toBe(AfterModelCallEvent)
    })

    it('calls reduce and sets retry=true on ContextWindowOverflowError when reduce returns true', async () => {
      const manager = new TestConversationManager()
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
      ]
      const mockAgent = createMockAgent({ messages })
      manager.initAgent(mockAgent)

      const error = new ContextWindowOverflowError('overflow')
      const event = new AfterModelCallEvent({ agent: mockAgent, error })
      await invokeTrackedHook(mockAgent, event)

      expect(manager.reduceCallCount).toBe(1)
      expect(event.retry).toBe(true)
      expect(mockAgent.messages).toHaveLength(1)
    })

    it('does not set retry when reduce returns false', async () => {
      const manager = new TestConversationManager()
      manager.shouldReduce = false
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      const error = new ContextWindowOverflowError('overflow')
      const event = new AfterModelCallEvent({ agent: mockAgent, error })
      await invokeTrackedHook(mockAgent, event)

      expect(manager.reduceCallCount).toBe(1)
      expect(event.retry).toBeUndefined()
    })

    it('does not call reduce for non-overflow errors', async () => {
      const manager = new TestConversationManager()
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      const error = new Error('some other error')
      const event = new AfterModelCallEvent({ agent: mockAgent, error })
      await invokeTrackedHook(mockAgent, event)

      expect(manager.reduceCallCount).toBe(0)
      expect(event.retry).toBeUndefined()
    })

    it('passes error to reduce when called due to overflow', async () => {
      const receivedArgs: ReduceOptions[] = []
      class CapturingManager extends ConversationManager {
        readonly name = 'test:capturing'
        reduce(args: ReduceOptions): boolean {
          receivedArgs.push(args)
          return false
        }
      }

      const manager = new CapturingManager()
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      const error = new ContextWindowOverflowError('overflow')
      const event = new AfterModelCallEvent({ agent: mockAgent, error })
      await invokeTrackedHook(mockAgent, event)

      expect(receivedArgs).toHaveLength(1)
      expect(receivedArgs[0]!.error).toBe(error)
      expect(receivedArgs[0]!.agent).toBe(mockAgent)
    })
  })
})

describe('overflow propagation', () => {
  it('propagates ContextWindowOverflowError out of the agent loop when reduce returns false', async () => {
    const model = new MockMessageModel()
    model.addTurn(new ContextWindowOverflowError('context window exceeded'))

    const agent = new Agent({
      model,
      conversationManager: new NullConversationManager(),
      printer: false,
    })

    await expect(agent.invoke('hello')).rejects.toThrow(ContextWindowOverflowError)
  })
})
