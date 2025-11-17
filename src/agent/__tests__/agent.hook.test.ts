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

      // Should have multiple events including: BeforeInvocation, BeforeModelCall, ModelStreamEventHook(s), AfterModelCall, MessageAdded, AfterInvocation
      expect(mockProvider.invocations.length).toBeGreaterThan(2)

      // First event should be BeforeInvocationEvent
      expect(mockProvider.invocations[0]).toEqual({
        agent,
        type: 'beforeInvocationEvent',
      })

      // Last event should be AfterInvocationEvent
      expect(mockProvider.invocations[mockProvider.invocations.length - 1]).toEqual({
        agent,
        type: 'afterInvocationEvent',
      })

      // Should include BeforeModelCallEvent, AfterModelCallEvent, and MessageAddedEvent
      const eventTypes = mockProvider.invocations.map((e) => (e as any).type as string)
      expect(eventTypes).toContain('beforeModelCallEvent')
      expect(eventTypes).toContain('afterModelCallEvent')
      expect(eventTypes).toContain('messageAddedEvent')
    })

    it('fires hooks during stream', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [mockProvider] })

      await collectIterator(agent.stream('Hi'))

      // Should have multiple events
      expect(mockProvider.invocations.length).toBeGreaterThan(2)

      // First event should be BeforeInvocationEvent
      expect((mockProvider.invocations[0] as BeforeInvocationEvent).agent).toBe(agent)
      expect((mockProvider.invocations[0] as BeforeInvocationEvent).type).toBe('beforeInvocationEvent')

      // Last event should be AfterInvocationEvent
      const lastEvent = mockProvider.invocations[mockProvider.invocations.length - 1]
      expect((lastEvent as AfterInvocationEvent).agent).toBe(agent)
      expect((lastEvent as AfterInvocationEvent).type).toBe('afterInvocationEvent')
    })
  })

  describe('runtime hook registration', () => {
    it('allows adding hooks after agent creation', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      agent.hooks.addHook(mockProvider)

      await agent.invoke('Hi')

      // Should have multiple events
      expect(mockProvider.invocations.length).toBeGreaterThan(2)

      // First and last should be Invocation events
      expect((mockProvider.invocations[0] as BeforeInvocationEvent).type).toBe('beforeInvocationEvent')
      const lastEvent = mockProvider.invocations[mockProvider.invocations.length - 1]
      expect((lastEvent as AfterInvocationEvent).type).toBe('afterInvocationEvent')
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

      // Should have multiple events (more than just 4 Invocation events)
      expect(mockProvider.invocations.length).toBeGreaterThan(4)

      // Filter for just Invocation events to verify they fire for each turn
      const invocationEvents = mockProvider.invocations.filter((e) => {
        const event = e as BeforeInvocationEvent | AfterInvocationEvent
        return event.type === 'beforeInvocationEvent' || event.type === 'afterInvocationEvent'
      })
      expect(invocationEvents).toHaveLength(4) // 2 for each turn
    })
  })
})
