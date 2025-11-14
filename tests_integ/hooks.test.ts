import { describe, it, expect, beforeEach } from 'vitest'
import {
  Agent,
  BeforeInvocationEvent,
  AfterInvocationEvent,
  type HookEvent,
  type HookProvider,
  type HookRegistry,
} from '@strands-agents/sdk'
// eslint-disable-next-line no-restricted-imports
import { MockMessageModel } from '../src/__fixtures__/mock-message-model.js'
// eslint-disable-next-line no-restricted-imports
import { collectIterator } from '../src/__fixtures__/model-test-helpers.js'

/**
 * Mock hook provider that records all hook invocations for testing.
 * Similar to Python SDK's MockHookProvider.
 */
export class MockHookProvider implements HookProvider {
  invocations: HookEvent[] = []

  getHooks() {
    return [
      { event: BeforeInvocationEvent, callback: (e: BeforeInvocationEvent) => this.invocations.push(e) },
      { event: AfterInvocationEvent, callback: (e: AfterInvocationEvent) => this.invocations.push(e) },
    ]
  }

  reset(): void {
    this.invocations = []
  }
}

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
        getHooks: () => [
          { event: BeforeInvocationEvent, callback: () => callOrder.push('hook1-before') },
          { event: AfterInvocationEvent, callback: () => callOrder.push('hook1-after') },
        ],
      }

      const hook2: HookProvider = {
        getHooks: () => [
          { event: BeforeInvocationEvent, callback: () => callOrder.push('hook2-before') },
          { event: AfterInvocationEvent, callback: () => callOrder.push('hook2-after') },
        ],
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
      const errorHook: HookProvider = {
        getHooks: () => [
          {
            event: BeforeInvocationEvent,
            callback: () => {
              throw new Error('Hook error')
            },
          },
        ],
      }

      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [errorHook] })

      await expect(agent.invoke('Hi')).rejects.toThrow('Hook error')
    })

    it('stops execution when hook throws error', async () => {
      let secondHookCalled = false

      const errorHook: HookProvider = {
        getHooks: () => [
          {
            event: BeforeInvocationEvent,
            callback: () => {
              throw new Error('Hook error')
            },
          },
        ],
      }

      const secondHook: HookProvider = {
        getHooks: () => [
          {
            event: BeforeInvocationEvent,
            callback: () => {
              secondHookCalled = true
            },
          },
        ],
      }

      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [errorHook, secondHook] })

      await expect(agent.invoke('Hi')).rejects.toThrow('Hook error')
      expect(secondHookCalled).toBe(false)
    })
  })

  describe('async hooks', () => {
    it('awaits async callbacks', async () => {
      let asyncCompleted = false

      const asyncHook: HookProvider = {
        getHooks: () => [
          {
            event: BeforeInvocationEvent,
            callback: async () => {
              await new Promise((resolve) => globalThis.setTimeout(resolve, 10))
              asyncCompleted = true
            },
          },
        ],
      }

      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [asyncHook] })

      await agent.invoke('Hi')

      expect(asyncCompleted).toBe(true)
    })

    it('handles mixed sync and async hooks in correct order', async () => {
      const callOrder: string[] = []

      const mixedHook: HookProvider = {
        getHooks: () => [
          { event: BeforeInvocationEvent, callback: () => callOrder.push('sync') },
          {
            event: BeforeInvocationEvent,
            callback: async () => {
              await new Promise((resolve) => globalThis.setTimeout(resolve, 10))
              callOrder.push('async')
            },
          },
          { event: BeforeInvocationEvent, callback: () => callOrder.push('sync2') },
        ],
      }

      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [mixedHook] })

      await agent.invoke('Hi')

      expect(callOrder).toEqual(['sync', 'async', 'sync2'])
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
        getHooks: () => [
          { event: AfterInvocationEvent, callback: () => callOrder.push(1) },
          { event: AfterInvocationEvent, callback: () => callOrder.push(2) },
          { event: AfterInvocationEvent, callback: () => callOrder.push(3) },
        ],
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
      expect(mockProvider.invocations).toHaveLength(2)

      mockProvider.reset()

      await agent.invoke('Second message')
      expect(mockProvider.invocations).toHaveLength(2)
    })
  })
})
