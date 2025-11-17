import { describe, it, expect, beforeEach } from 'vitest'
import { Agent } from '../agent.js'
import { BeforeInvocationEvent, AfterInvocationEvent } from '../../hooks/index.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { MockHookProvider } from '../../__fixtures__/mock-hook-provider.js'
import { collectIterator } from '../../__fixtures__/model-test-helpers.js'

describe('Agent Hooks Integration', () => {
  let mockProvider: MockHookProvider

  beforeEach(() => {
    mockProvider = new MockHookProvider()
  })

  describe('invocation lifecycle', () => {
    it('fires hooks during invoke', async () => {
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

    it('fires hooks during stream', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [mockProvider] })

      await collectIterator(agent.stream('Hi'))

      expect(mockProvider.invocations).toHaveLength(2)
      expect((mockProvider.invocations[0] as BeforeInvocationEvent).agent).toBe(agent)
      expect((mockProvider.invocations[1] as AfterInvocationEvent).agent).toBe(agent)
    })
  })

  describe('runtime hook registration', () => {
    it('allows adding hooks after agent creation', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      agent.hooks.addHook(mockProvider)

      await agent.invoke('Hi')

      expect(mockProvider.invocations).toHaveLength(2)
    })
  })

  describe('multi-turn conversations', () => {
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
