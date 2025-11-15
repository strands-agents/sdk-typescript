import { describe, it, expect, beforeEach } from 'vitest'
import { Agent } from '../agent.js'
import { BeforeInvocationEvent, AfterInvocationEvent } from '../../hooks/index.js'
import type { HookProvider } from '../../hooks/index.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { MockHookProvider } from '../../__fixtures__/mock-hook-provider.js'
import { collectIterator } from '../../__fixtures__/model-test-helpers.js'

describe('Hooks Integration', () => {
  let mockProvider: MockHookProvider

  beforeEach(() => {
    mockProvider = new MockHookProvider()
  })

  describe('basic invocation lifecycle', () => {
    it('fires BeforeInvocationEvent and AfterInvocationEvent during invoke', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [mockProvider] })

      await agent.invoke('Hi')

      expect(mockProvider.invocations).toHaveLength(2)
      expect(mockProvider.invocations[0]).toEqual({
        agent,
        type: 'beforeInvocationEvent',
      })
      expect(mockProvider.invocations[1]).toEqual({
        agent,
        type: 'afterInvocationEvent',
      })
    })

    it('fires BeforeInvocationEvent and AfterInvocationEvent during stream', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [mockProvider] })

      await collectIterator(agent.stream('Hi'))

      expect(mockProvider.invocations).toHaveLength(2)
      expect(mockProvider.invocations[0]).toEqual({
        agent,
        type: 'beforeInvocationEvent',
      })
      expect(mockProvider.invocations[1]).toEqual({
        agent,
        type: 'afterInvocationEvent',
      })
    })

    it('provides agent reference in hook events', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [mockProvider] })

      await agent.invoke('Hi')

      expect(mockProvider.invocations[0]?.agent).toBe(agent)
      expect(mockProvider.invocations[1]?.agent).toBe(agent)
    })
  })

  describe('multiple hooks', () => {
    it('fires all registered hooks in order', async () => {
      const callOrder: string[] = []

      const hook1: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(BeforeInvocationEvent, () => {
            callOrder.push('hook1-before')
          })
          reg.addCallback(AfterInvocationEvent, () => {
            callOrder.push('hook1-after')
          })
        },
      }

      const hook2: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(BeforeInvocationEvent, () => {
            callOrder.push('hook2-before')
          })
          reg.addCallback(AfterInvocationEvent, () => {
            callOrder.push('hook2-after')
          })
        },
      }

      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [hook1, hook2] })

      await agent.invoke('Hi')

      // Before events in registration order, After events in reverse order
      expect(callOrder).toEqual(['hook1-before', 'hook2-before', 'hook2-after', 'hook1-after'])
    })
  })

  describe('hook error propagation', () => {
    it('propagates errors from hooks', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      agent.hooks.addCallback(BeforeInvocationEvent, () => {
        throw new Error('Hook error')
      })

      await expect(agent.invoke('Hi')).rejects.toThrow('Hook error')
    })

    it('stops execution when hook throws error', async () => {
      let secondHookCalled = false

      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      agent.hooks.addCallback(BeforeInvocationEvent, () => {
        throw new Error('Hook error')
      })
      agent.hooks.addCallback(BeforeInvocationEvent, () => {
        secondHookCalled = true
      })

      await expect(agent.invoke('Hi')).rejects.toThrow('Hook error')
      expect(secondHookCalled).toBe(false)
    })
  })

  describe('async hooks', () => {
    it('awaits async callbacks', async () => {
      let asyncCompleted = false

      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      agent.hooks.addCallback(BeforeInvocationEvent, async () => {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 10))
        asyncCompleted = true
      })

      await agent.invoke('Hi')

      expect(asyncCompleted).toBe(true)
    })
  })

  describe('runtime hook registration', () => {
    it('allows adding hooks at runtime', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      // Add hook after agent creation
      agent.hooks.addHook(mockProvider)

      await agent.invoke('Hi')

      expect(mockProvider.invocations).toHaveLength(2)
    })
  })

  describe('reverse callback ordering', () => {
    it('fires AfterInvocationEvent callbacks in reverse order', async () => {
      const callOrder: number[] = []

      const hook: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(AfterInvocationEvent, () => {
            callOrder.push(1)
          })
          reg.addCallback(AfterInvocationEvent, () => {
            callOrder.push(2)
          })
          reg.addCallback(AfterInvocationEvent, () => {
            callOrder.push(3)
          })
        },
      }

      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [hook] })

      await agent.invoke('Hi')

      expect(callOrder).toEqual([3, 2, 1])
    })
  })

  describe('hooks with multi-turn conversations', () => {
    it('fires hooks for each invoke call', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'textBlock', text: 'First response' })
        .addTurn({ type: 'textBlock', text: 'Second response' })

      const agent = new Agent({ model, hooks: [mockProvider] })

      await agent.invoke('First message')
      await agent.invoke('Second message')

      expect(mockProvider.invocations).toHaveLength(4)
    })
  })
})
