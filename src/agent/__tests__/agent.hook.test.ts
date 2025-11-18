import { beforeEach, describe, expect, it } from 'vitest'
import { Agent } from '../agent.js'
import {
  AfterInvocationEvent,
  AfterModelCallEvent,
  AfterToolCallEvent,
  BeforeInvocationEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
  MessageAddedEvent,
  ModelStreamEventHook,
} from '../../hooks/index.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { MockHookProvider } from '../../__fixtures__/mock-hook-provider.js'
import { collectIterator } from '../../__fixtures__/model-test-helpers.js'
import { FunctionTool } from '../../tools/function-tool.js'
import { Message, TextBlock, ToolResultBlock } from '../../types/messages.js'

describe('Agent Hooks Integration', () => {
  let mockProvider: MockHookProvider

  beforeEach(() => {
    mockProvider = new MockHookProvider()
  })

  describe('invocation lifecycle', () => {
    it('fires hooks during invoke', async () => {
      const lifecycleProvider = new MockHookProvider({ includeModelEvents: false })
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [lifecycleProvider] })

      await agent.invoke('Hi')

      expect(lifecycleProvider.invocations).toHaveLength(5)

      expect(lifecycleProvider.invocations[0]).toEqual(new BeforeInvocationEvent({ agent: agent }))
      expect(lifecycleProvider.invocations[1]).toEqual(new BeforeModelCallEvent({ agent: agent }))
      expect(lifecycleProvider.invocations[2]).toEqual(
        new AfterModelCallEvent({
          agent,
          stopReason: 'endTurn',
          message: new Message({ role: 'assistant', content: [new TextBlock('Hello')] }),
        })
      )
      expect(lifecycleProvider.invocations[3]).toEqual(
        new MessageAddedEvent({
          agent,
          message: new Message({ role: 'assistant', content: [new TextBlock('Hello')] }),
        })
      )
      expect(lifecycleProvider.invocations[4]).toEqual(new AfterInvocationEvent({ agent }))
    })

    it('fires hooks during stream', async () => {
      const lifecycleProvider = new MockHookProvider({ includeModelEvents: false })
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [lifecycleProvider] })

      await collectIterator(agent.stream('Hi'))

      expect(lifecycleProvider.invocations).toHaveLength(5)

      expect(lifecycleProvider.invocations[0]).toEqual(new BeforeInvocationEvent({ agent: agent }))
      expect(lifecycleProvider.invocations[1]).toEqual(new BeforeModelCallEvent({ agent: agent }))
      expect(lifecycleProvider.invocations[2]).toEqual(
        new AfterModelCallEvent({
          agent,
          stopReason: 'endTurn',
          message: new Message({ role: 'assistant', content: [new TextBlock('Hello')] }),
        })
      )
      expect(lifecycleProvider.invocations[3]).toEqual(
        new MessageAddedEvent({
          agent,
          message: new Message({ role: 'assistant', content: [new TextBlock('Hello')] }),
        })
      )
      expect(lifecycleProvider.invocations[4]).toEqual(new AfterInvocationEvent({ agent }))
    })
  })

  describe('runtime hook registration', () => {
    it('allows adding hooks after agent creation', async () => {
      const lifecycleProvider = new MockHookProvider({ includeModelEvents: false })
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      agent.hooks.addHook(lifecycleProvider)

      await agent.invoke('Hi')

      // Should have all lifecycle events
      expect(lifecycleProvider.invocations).toHaveLength(5)
      expect(lifecycleProvider.invocations[0]).toEqual(new BeforeInvocationEvent({ agent }))
      expect(lifecycleProvider.invocations[4]).toEqual(new AfterInvocationEvent({ agent }))
    })
  })

  describe('multi-turn conversations', () => {
    it('fires hooks for each invoke call', async () => {
      const lifecycleProvider = new MockHookProvider({ includeModelEvents: false })
      const model = new MockMessageModel()
        .addTurn({ type: 'textBlock', text: 'First response' })
        .addTurn({ type: 'textBlock', text: 'Second response' })

      const agent = new Agent({ model, hooks: [lifecycleProvider] })

      await agent.invoke('First message')

      // First turn should have: BeforeInvocation, BeforeModelCall, AfterModelCall, MessageAdded, AfterInvocation
      expect(lifecycleProvider.invocations).toHaveLength(5)

      await agent.invoke('Second message')

      // Should have 10 events total (5 for each turn)
      expect(lifecycleProvider.invocations).toHaveLength(10)

      // Filter for just Invocation events to verify they fire for each turn
      const invocationEvents = lifecycleProvider.invocations.filter(
        (e) => e instanceof BeforeInvocationEvent || e instanceof AfterInvocationEvent
      )
      expect(invocationEvents).toHaveLength(4) // 2 for each turn
    })
  })

  describe('tool execution hooks', () => {
    it('fires tool hooks during tool execution', async () => {
      const tool = new FunctionTool({
        name: 'testTool',
        description: 'A test tool',
        inputSchema: {},
        callback: () => 'Tool result',
      })

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Final response' })

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [mockProvider],
      })

      await agent.invoke('Test with tool')

      // Find key events
      const beforeToolCallEvents = mockProvider.invocations.filter((e) => e instanceof BeforeToolCallEvent)
      const afterToolCallEvents = mockProvider.invocations.filter((e) => e instanceof AfterToolCallEvent)
      const messageAddedEvents = mockProvider.invocations.filter((e) => e instanceof MessageAddedEvent)

      // Verify tool hooks fired
      expect(beforeToolCallEvents.length).toBe(1)
      expect(afterToolCallEvents.length).toBe(1)

      // Verify 3 MessageAdded events: assistant with tool use, tool result, final assistant
      expect(messageAddedEvents.length).toBe(3)

      // Verify BeforeToolCallEvent
      const beforeToolCall = beforeToolCallEvents[0] as BeforeToolCallEvent
      expect(beforeToolCall).toEqual(
        new BeforeToolCallEvent({
          agent,
          toolUse: { name: 'testTool', toolUseId: 'tool-1', input: {} },
          tool,
        })
      )

      // Verify AfterToolCallEvent
      const afterToolCall = afterToolCallEvents[0] as AfterToolCallEvent
      expect(afterToolCall).toEqual(
        new AfterToolCallEvent({
          agent,
          toolUse: { name: 'testTool', toolUseId: 'tool-1', input: {} },
          tool,
          result: new ToolResultBlock({
            toolUseId: 'tool-1',
            status: 'success',
            content: [new TextBlock('Tool result')],
          }),
        })
      )
    })

    it('fires AfterToolCallEvent with error when tool fails', async () => {
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
        hooks: [mockProvider],
      })

      // Agent should complete successfully (tool errors are handled gracefully)
      const result = await agent.invoke('Test with failing tool')
      expect(result.stopReason).toBe('endTurn')

      // Find AfterToolCallEvent
      const afterToolCallEvents = mockProvider.invocations.filter((e) => e instanceof AfterToolCallEvent)
      expect(afterToolCallEvents.length).toBe(1)

      const afterToolCall = afterToolCallEvents[0] as AfterToolCallEvent
      expect(afterToolCall).toEqual(
        new AfterToolCallEvent({
          agent,
          toolUse: { name: 'failingTool', toolUseId: 'tool-1', input: {} },
          tool,
          result: new ToolResultBlock({
            error: new Error('Tool execution failed'),
            toolUseId: 'tool-1',
            status: 'error',
            content: [new TextBlock('Error: Tool execution failed')],
          }),
        })
      )
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
        hooks: [mockProvider],
      })

      // Collect all stream events
      const allStreamEvents = []
      for await (const event of agent.stream('Test')) {
        allStreamEvents.push(event)
      }

      const streamEventHooks = mockProvider.invocations.filter((e) => e instanceof ModelStreamEventHook)

      // Should have events
      expect(streamEventHooks.length).toBeGreaterThan(0)

      // Verify each hook event matches a stream event
      for (const hookEvent of streamEventHooks) {
        const event = (hookEvent as ModelStreamEventHook).event
        expect(allStreamEvents).toContain(event)
      }
    })
  })

  describe('MessageAddedEvent exclusions', () => {
    it('does not fire for initial config messages', async () => {
      const initialMessage = { role: 'user' as const, content: [{ type: 'textBlock' as const, text: 'Initial' }] }

      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response' })

      const agent = new Agent({
        model,
        messages: [initialMessage],
        hooks: [mockProvider],
      })

      await agent.invoke('New message')

      const messageAddedEvents = mockProvider.invocations.filter((e) => e instanceof MessageAddedEvent)

      // Should only have 1 MessageAdded event (for the assistant response)
      expect(messageAddedEvents).toEqual([
        new MessageAddedEvent({
          agent,
          message: new Message({ role: 'assistant', content: [new TextBlock('Response')] }),
        }),
      ])
    })

    it('does not fire for user input messages', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response' })

      const agent = new Agent({
        model,
        hooks: [mockProvider],
      })

      await agent.invoke('User input')

      const messageAddedEvents = mockProvider.invocations.filter((e) => e instanceof MessageAddedEvent)

      // Should only have 1 MessageAdded event (for the assistant response)
      expect(messageAddedEvents).toEqual([
        new MessageAddedEvent({
          agent,
          message: new Message({ role: 'assistant', content: [new TextBlock('Response')] }),
        }),
      ])
    })
  })
})
