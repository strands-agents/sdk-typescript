import { describe, it, expect, vi } from 'vitest'
import {
  ConversationManager,
  type ConversationManagerReduceOptions,
  type ConversationManagerThresholdOptions,
} from '../conversation-manager.js'
import { NullConversationManager } from '../null-conversation-manager.js'
import { Agent } from '../../agent/agent.js'
import { Message, TextBlock } from '../../index.js'
import { AfterModelCallEvent, BeforeModelCallEvent } from '../../hooks/events.js'
import { ContextWindowOverflowError } from '../../errors.js'
import { createMockAgent, invokeTrackedHook } from '../../__fixtures__/agent-helpers.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import type { BaseModelConfig } from '../../models/model.js'
import type { ConversationManagerConfig } from '../conversation-manager.js'
import { warnOnce } from '../../logging/warn-once.js'

vi.mock('../../logging/warn-once.js', () => ({
  warnOnce: vi.fn(),
}))

class TestConversationManager extends ConversationManager {
  readonly name = 'test:conversation-manager'
  reduceCallCount = 0
  shouldReduce = true

  constructor(config?: ConversationManagerConfig) {
    super(config)
  }

  reduce({ agent }: ConversationManagerReduceOptions): boolean {
    this.reduceCallCount++
    if (!this.shouldReduce) return false
    agent.messages.splice(0, 1)
    return true
  }
}

class ThresholdTestManager extends ConversationManager {
  readonly name = 'test:threshold-manager'
  reduceOnThresholdCallCount = 0
  shouldReduceOnThreshold = true

  reduce(): boolean {
    return false
  }

  reduceOnThreshold({ agent }: ConversationManagerThresholdOptions): boolean {
    this.reduceOnThresholdCallCount++
    if (!this.shouldReduceOnThreshold) return false
    agent.messages.splice(0, 1)
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
      const event = new AfterModelCallEvent({ agent: mockAgent, model: {} as any, error, invocationState: {} })
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
      const event = new AfterModelCallEvent({ agent: mockAgent, model: {} as any, error, invocationState: {} })
      await invokeTrackedHook(mockAgent, event)

      expect(manager.reduceCallCount).toBe(1)
      expect(event.retry).toBeUndefined()
    })

    it('does not call reduce for non-overflow errors', async () => {
      const manager = new TestConversationManager()
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      const error = new Error('some other error')
      const event = new AfterModelCallEvent({ agent: mockAgent, model: {} as any, error, invocationState: {} })
      await invokeTrackedHook(mockAgent, event)

      expect(manager.reduceCallCount).toBe(0)
      expect(event.retry).toBeUndefined()
    })

    it('passes error to reduce when called due to overflow', async () => {
      const receivedArgs: ConversationManagerReduceOptions[] = []
      class CapturingManager extends ConversationManager {
        readonly name = 'test:capturing'
        reduce(args: ConversationManagerReduceOptions): boolean {
          receivedArgs.push(args)
          return false
        }
      }

      const manager = new CapturingManager()
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      const error = new ContextWindowOverflowError('overflow')
      const event = new AfterModelCallEvent({ agent: mockAgent, model: {} as any, error, invocationState: {} })
      await invokeTrackedHook(mockAgent, event)

      expect(receivedArgs).toHaveLength(1)
      expect(receivedArgs[0]!.error).toBe(error)
      expect(receivedArgs[0]!.agent).toBe(mockAgent)
    })
  })

  describe('threshold', () => {
    const mockModel = { getConfig: () => ({ contextWindowLimit: 1000 }) as BaseModelConfig } as any

    it('registers a BeforeModelCallEvent hook when threshold is set', () => {
      const manager = new ThresholdTestManager({ threshold: 0.7 })
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      expect(mockAgent.trackedHooks).toHaveLength(2)
      expect(mockAgent.trackedHooks[0]!.eventType).toBe(AfterModelCallEvent)
      expect(mockAgent.trackedHooks[1]!.eventType).toBe(BeforeModelCallEvent)
    })

    it('does not register BeforeModelCallEvent hook when threshold is not set', () => {
      const manager = new TestConversationManager()
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      expect(mockAgent.trackedHooks).toHaveLength(1)
      expect(mockAgent.trackedHooks[0]!.eventType).toBe(AfterModelCallEvent)
    })

    it('calls reduceOnThreshold when projected tokens exceed threshold', async () => {
      const manager = new ThresholdTestManager({ threshold: 0.7 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
      ]
      const mockAgent = createMockAgent({ messages })
      manager.initAgent(mockAgent)

      const event = new BeforeModelCallEvent({
        agent: mockAgent,
        model: mockModel,
        invocationState: {},
        projectedInputTokens: 800, // 800/1000 = 0.8 >= 0.7
      })
      await invokeTrackedHook(mockAgent, event)

      expect(manager.reduceOnThresholdCallCount).toBe(1)
      expect(mockAgent.messages).toHaveLength(1)
    })

    it('does not call reduceOnThreshold when below threshold', async () => {
      const manager = new ThresholdTestManager({ threshold: 0.7 })
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      const event = new BeforeModelCallEvent({
        agent: mockAgent,
        model: mockModel,
        invocationState: {},
        projectedInputTokens: 500, // 500/1000 = 0.5 < 0.7
      })
      await invokeTrackedHook(mockAgent, event)

      expect(manager.reduceOnThresholdCallCount).toBe(0)
    })

    it('does not call reduceOnThreshold when projectedInputTokens is undefined', async () => {
      const manager = new ThresholdTestManager({ threshold: 0.7 })
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      const event = new BeforeModelCallEvent({
        agent: mockAgent,
        model: mockModel,
        invocationState: {},
      })
      await invokeTrackedHook(mockAgent, event)

      expect(manager.reduceOnThresholdCallCount).toBe(0)
    })

    it('warns and skips when contextWindowLimit is undefined', async () => {
      const manager = new ThresholdTestManager({ threshold: 0.7 })
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      const modelWithoutLimit = { getConfig: () => ({}) as BaseModelConfig } as any
      const event = new BeforeModelCallEvent({
        agent: mockAgent,
        model: modelWithoutLimit,
        invocationState: {},
        projectedInputTokens: 800,
      })
      await invokeTrackedHook(mockAgent, event)

      expect(manager.reduceOnThresholdCallCount).toBe(0)
      expect(warnOnce).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('contextWindowLimit is not set on the model, proactive compression is disabled')
      )
    })

    it('warns when subclass does not implement reduceOnThreshold', async () => {
      const { logger } = await import('../../logging/logger.js')
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

      const manager = new TestConversationManager({ threshold: 0.7 })
      const mockAgent = createMockAgent()
      manager.initAgent(mockAgent)

      expect(mockAgent.trackedHooks).toHaveLength(1)
      expect(mockAgent.trackedHooks[0]!.eventType).toBe(AfterModelCallEvent)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reduceOnThreshold is not implemented'))
      warnSpy.mockRestore()
    })

    it('throws on threshold <= 0', () => {
      expect(() => new ThresholdTestManager({ threshold: 0 })).toThrow(
        'threshold must be between 0 (exclusive) and 1 (inclusive)'
      )
      expect(() => new ThresholdTestManager({ threshold: -1 })).toThrow(
        'threshold must be between 0 (exclusive) and 1 (inclusive)'
      )
    })

    it('throws on threshold > 1', () => {
      expect(() => new ThresholdTestManager({ threshold: 1.5 })).toThrow(
        'threshold must be between 0 (exclusive) and 1 (inclusive)'
      )
    })

    it('accepts threshold of exactly 1', () => {
      expect(() => new ThresholdTestManager({ threshold: 1 })).not.toThrow()
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
