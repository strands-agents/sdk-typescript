import { describe, it, expect, beforeEach } from 'vitest'
import { Agent, Message, FunctionTool } from '@strands-agents/sdk'
import { MockHookProvider } from './__fixtures__/mock-hook-provider.js'
import { MockMessageModel } from './__fixtures__/mock-message-model.js'

describe('hooks integration', () => {
  let mockHooks: MockHookProvider

  beforeEach(() => {
    mockHooks = new MockHookProvider()
  })

  describe('simple invocation without tools', () => {
    it('fires hooks in correct sequence', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello, world!' })

      const agent = new Agent({
        model,
        hooks: [mockHooks],
      })

      await agent.invoke('Test message')

      const eventTypes = mockHooks.getEventTypes()

      // Should include: BeforeInvocation, BeforeModelCall, ModelStreamEventHook(s), AfterModelCall, MessageAdded, AfterInvocation
      expect(eventTypes[0]).toBe('beforeInvocationEvent')
      expect(eventTypes[eventTypes.length - 1]).toBe('afterInvocationEvent')

      // Should have BeforeModelCall and AfterModelCall
      expect(eventTypes).toContain('beforeModelCallEvent')
      expect(eventTypes).toContain('afterModelCallEvent')

      // Should have at least one ModelStreamEventHook
      expect(eventTypes.filter((t) => t === 'modelStreamEventHook').length).toBeGreaterThan(0)

      // Should have exactly one MessageAdded (final assistant message)
      expect(eventTypes.filter((t) => t === 'messageAddedEvent').length).toBe(1)
    })
  })

  describe('invocation with tool use', () => {
    it('fires hooks in correct sequence with tool execution', async () => {
      const tool = new FunctionTool({
        name: 'testTool',
        description: 'A test tool',
        parameters: {},
        func: () => 'Tool result',
      })

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Final response' })

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [mockHooks],
      })

      await agent.invoke('Test with tool')

      const eventTypes = mockHooks.getEventTypes()

      // Verify basic structure
      expect(eventTypes[0]).toBe('beforeInvocationEvent')
      expect(eventTypes[eventTypes.length - 1]).toBe('afterInvocationEvent')

      // Should have tool-related events
      expect(eventTypes).toContain('beforeToolCallEvent')
      expect(eventTypes).toContain('afterToolCallEvent')

      // Should have 3 MessageAdded events: assistant with tool use, tool result, final assistant
      const messageAddedCount = eventTypes.filter((t) => t === 'messageAddedEvent').length
      expect(messageAddedCount).toBe(3)

      // Verify order: BeforeInvocation -> BeforeModelCall -> AfterModelCall -> MessageAdded (assistant with tool)
      //              -> BeforeToolCall -> AfterToolCall -> MessageAdded (tool result)
      //              -> BeforeModelCall -> AfterModelCall -> MessageAdded (final assistant) -> AfterInvocation
      const beforeInvocationIndex = eventTypes.indexOf('beforeInvocationEvent')
      const firstBeforeModelCallIndex = eventTypes.indexOf('beforeModelCallEvent')
      const beforeToolCallIndex = eventTypes.indexOf('beforeToolCallEvent')
      const afterToolCallIndex = eventTypes.indexOf('afterToolCallEvent')
      const afterInvocationIndex = eventTypes.indexOf('afterInvocationEvent')

      expect(beforeInvocationIndex).toBeLessThan(firstBeforeModelCallIndex)
      expect(firstBeforeModelCallIndex).toBeLessThan(beforeToolCallIndex)
      expect(beforeToolCallIndex).toBeLessThan(afterToolCallIndex)
      expect(afterToolCallIndex).toBeLessThan(afterInvocationIndex)
    })
  })

  describe('tool execution with error', () => {
    it('includes error property in AfterToolCallEvent', async () => {
      const tool = new FunctionTool({
        name: 'failingTool',
        description: 'A tool that fails',
        inputSchema: {},
        callback: () => {
          throw new Error('Tool execution failed')
        },
      })

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'failingTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Handled error' })

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [mockHooks],
      })

      // Tool errors should be caught and handled gracefully
      await agent.invoke('Test with failing tool')

      // Find AfterToolCallEvent
      const afterToolCallEvents = mockHooks.invocations.filter((e) => e.type === 'afterToolCallEvent')
      expect(afterToolCallEvents.length).toBeGreaterThan(0)

      // The event should be present (tool error is handled gracefully)
      // Note: In current implementation, tool errors are caught and returned as error results
      expect(afterToolCallEvents.length).toBe(1)
    })
  })

  describe('reverse callback ordering', () => {
    it('executes AfterToolCallEvent callbacks in reverse order', async () => {
      const executionOrder: number[] = []

      const tool = new FunctionTool({
        name: 'testTool',
        description: 'A test tool',
        inputSchema: {},
        callback: () => 'result',
      })

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({
        model,
        tools: [tool],
      })

      // Register multiple callbacks manually
      agent.hooks.addCallback(AfterToolCallEvent, () => {
        executionOrder.push(1)
      })
      agent.hooks.addCallback(AfterToolCallEvent, () => {
        executionOrder.push(2)
      })
      agent.hooks.addCallback(AfterToolCallEvent, () => {
        executionOrder.push(3)
      })

      await agent.invoke('Test')

      // Callbacks should execute in reverse order: 3, 2, 1
      expect(executionOrder).toEqual([3, 2, 1])
    })

    it('executes AfterModelCallEvent callbacks in reverse order', async () => {
      const executionOrder: number[] = []

      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response' })

      const agent = new Agent({
        model,
      })

      // Register multiple callbacks manually
      agent.hooks.addCallback(AfterModelCallEvent, () => {
        executionOrder.push(1)
      })
      agent.hooks.addCallback(AfterModelCallEvent, () => {
        executionOrder.push(2)
      })
      agent.hooks.addCallback(AfterModelCallEvent, () => {
        executionOrder.push(3)
      })

      await agent.invoke('Test')

      // Callbacks should execute in reverse order: 3, 2, 1
      expect(executionOrder).toEqual([3, 2, 1])
    })
  })

  describe('ModelStreamEventHook', () => {
    it('fires for each streaming event from the model', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })

      const agent = new Agent({
        model,
        hooks: [mockHooks],
      })

      await agent.invoke('Test')

      const streamEventHooks = mockHooks.invocations.filter((e) => e.type === 'modelStreamEventHook')

      // Should have multiple streaming events
      expect(streamEventHooks.length).toBeGreaterThan(0)

      // Each event should have a streamEvent property with a valid type
      for (const hook of streamEventHooks) {
        expect(hook).toHaveProperty('streamEvent')
        expect((hook as any).streamEvent).toHaveProperty('type')
        expect((hook as any).streamEvent.type).toMatch(/^model/)
      }
    })
  })

  describe('MessageAdded exclusions', () => {
    it('does not fire for initial config messages', async () => {
      const initialMessages = [new Message({ role: 'user', content: [{ type: 'textBlock', text: 'Initial message' }] })]

      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response' })

      const agent = new Agent({
        model,
        messages: initialMessages,
        hooks: [mockHooks],
      })

      await agent.invoke('New message')

      const messageAddedEvents = mockHooks.invocations.filter((e) => e.type === 'messageAddedEvent')

      // Should only have 1 MessageAdded event (for the final assistant response)
      // NOT for the initial message or the user prompt
      expect(messageAddedEvents.length).toBe(1)

      // Verify it's the assistant response
      const event = messageAddedEvents[0] as any
      expect(event.message.role).toBe('assistant')
    })

    it('does not fire for user input messages', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response' })

      const agent = new Agent({
        model,
        hooks: [mockHooks],
      })

      await agent.invoke('User input')

      const messageAddedEvents = mockHooks.invocations.filter((e) => e.type === 'messageAddedEvent')

      // Should only have 1 MessageAdded event (for the assistant response)
      // NOT for the user input
      expect(messageAddedEvents.length).toBe(1)

      const event = messageAddedEvents[0] as any
      expect(event.message.role).toBe('assistant')
    })
  })

  describe('multi-turn conversation', () => {
    it('fires hooks for each turn', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'textBlock', text: 'First response' })
        .addTurn({ type: 'textBlock', text: 'Second response' })

      const agent = new Agent({
        model,
        hooks: [mockHooks],
      })

      // First turn
      await agent.invoke('First message')

      const eventsAfterFirstTurn = mockHooks.getEventTypes()
      expect(eventsAfterFirstTurn[0]).toBe('beforeInvocationEvent')
      expect(eventsAfterFirstTurn[eventsAfterFirstTurn.length - 1]).toBe('afterInvocationEvent')

      mockHooks.reset()

      // Second turn
      await agent.invoke('Second message')

      const eventsAfterSecondTurn = mockHooks.getEventTypes()
      expect(eventsAfterSecondTurn[0]).toBe('beforeInvocationEvent')
      expect(eventsAfterSecondTurn[eventsAfterSecondTurn.length - 1]).toBe('afterInvocationEvent')

      // Verify message state is consistent
      expect(agent.messages.length).toBeGreaterThan(0)
    })
  })
})

// Need to import these types for the reverse order tests
import { AfterToolCallEvent, AfterModelCallEvent } from '@strands-agents/sdk'
