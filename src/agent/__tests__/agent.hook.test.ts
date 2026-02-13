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
  InitializedEvent,
} from '../../hooks/index.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { MockHookProvider } from '../../__fixtures__/mock-hook-provider.js'
import { collectIterator } from '../../__fixtures__/model-test-helpers.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
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

      expect(lifecycleProvider.invocations).toHaveLength(7)

      expect(lifecycleProvider.invocations[0]).toEqual(new InitializedEvent({ agent }))
      expect(lifecycleProvider.invocations[1]).toEqual(new BeforeInvocationEvent({ agent }))
      expect(lifecycleProvider.invocations[2]).toEqual(
        new MessageAddedEvent({ agent, message: new Message({ role: 'user', content: [new TextBlock('Hi')] }) })
      )
      expect(lifecycleProvider.invocations[3]).toEqual(new BeforeModelCallEvent({ agent }))
      expect(lifecycleProvider.invocations[4]).toEqual(
        new AfterModelCallEvent({
          agent,
          stopData: {
            stopReason: 'endTurn',
            message: new Message({ role: 'assistant', content: [new TextBlock('Hello')] }),
          },
        })
      )
      expect(lifecycleProvider.invocations[5]).toEqual(
        new MessageAddedEvent({
          agent,
          message: new Message({ role: 'assistant', content: [new TextBlock('Hello')] }),
        })
      )
      expect(lifecycleProvider.invocations[6]).toEqual(new AfterInvocationEvent({ agent }))
    })

    it('fires hooks during stream', async () => {
      const lifecycleProvider = new MockHookProvider({ includeModelEvents: false })
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, hooks: [lifecycleProvider] })

      await collectIterator(agent.stream('Hi'))

      expect(lifecycleProvider.invocations).toHaveLength(7)

      expect(lifecycleProvider.invocations[0]).toEqual(new InitializedEvent({ agent }))
      expect(lifecycleProvider.invocations[1]).toEqual(new BeforeInvocationEvent({ agent }))
      expect(lifecycleProvider.invocations[2]).toEqual(
        new MessageAddedEvent({
          agent,
          message: new Message({ role: 'user', content: [new TextBlock('Hi')] }),
        })
      )
      expect(lifecycleProvider.invocations[3]).toEqual(new BeforeModelCallEvent({ agent }))
      expect(lifecycleProvider.invocations[4]).toEqual(
        new AfterModelCallEvent({
          agent,
          stopData: {
            stopReason: 'endTurn',
            message: new Message({ role: 'assistant', content: [new TextBlock('Hello')] }),
          },
        })
      )
      expect(lifecycleProvider.invocations[5]).toEqual(
        new MessageAddedEvent({
          agent,
          message: new Message({ role: 'assistant', content: [new TextBlock('Hello')] }),
        })
      )
      expect(lifecycleProvider.invocations[6]).toEqual(new AfterInvocationEvent({ agent }))
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
      expect(lifecycleProvider.invocations).toHaveLength(7)
      expect(lifecycleProvider.invocations[1]).toEqual(new BeforeInvocationEvent({ agent }))
      expect(lifecycleProvider.invocations[6]).toEqual(new AfterInvocationEvent({ agent }))
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

      // First turn: InitializedEvent + BeforeInvocation, MessageAdded, BeforeModelCall, AfterModelCall, MessageAdded, AfterInvocation
      expect(lifecycleProvider.invocations).toHaveLength(7)

      await agent.invoke('Second message')

      // Should have 13 events total (7 for first turn + 6 for second turn, no InitializedEvent on second)
      expect(lifecycleProvider.invocations).toHaveLength(13)

      // Filter for just Invocation events to verify they fire for each turn
      const invocationEvents = lifecycleProvider.invocations.filter(
        (e) => e instanceof BeforeInvocationEvent || e instanceof AfterInvocationEvent
      )
      expect(invocationEvents).toHaveLength(4) // 2 for each turn
    })
  })

  describe('tool execution hooks', () => {
    it('fires tool hooks during tool execution', async () => {
      const tool = createMockTool('testTool', () => {
        return new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Tool result')] })
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

      // Verify 3 MessageAdded events: input message, assistant with tool use, tool result, final assistant
      expect(messageAddedEvents.length).toBe(4)

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
      const tool = createMockTool('failingTool', () => {
        throw new Error('Tool execution failed')
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
            content: [new TextBlock('Tool execution failed')],
          }),
          error: new Error('Tool execution failed'),
        })
      )
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

  describe('MessageAddedEvent', () => {
    it('fires for initial user input', async () => {
      const initialMessage = { role: 'user' as const, content: [{ type: 'textBlock' as const, text: 'Initial' }] }

      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response' })

      const agent = new Agent({
        model,
        messages: [initialMessage],
        hooks: [mockProvider],
      })

      await agent.invoke('New message')

      const messageAddedEvents = mockProvider.invocations.filter((e) => e instanceof MessageAddedEvent)

      // Should have 2 MessageAdded event
      expect(messageAddedEvents).toHaveLength(2)

      expect(messageAddedEvents[0]).toEqual(
        new MessageAddedEvent({
          agent,
          message: new Message({ role: 'user', content: [new TextBlock('New message')] }),
        })
      )
      expect(messageAddedEvents[1]).toEqual(
        new MessageAddedEvent({
          agent,
          message: new Message({ role: 'assistant', content: [new TextBlock('Response')] }),
        })
      )
    })
  })

  describe('AfterModelCallEvent retry', () => {
    it('retries model call when hook sets retry', async () => {
      let callCount = 0
      const model = new MockMessageModel()
        .addTurn(new Error('First attempt failed'))
        .addTurn({ type: 'textBlock', text: 'Success after retry' })

      const agent = new Agent({ model })
      agent.hooks.addCallback(AfterModelCallEvent, (event: AfterModelCallEvent) => {
        callCount++
        if (callCount === 1 && event.error) {
          event.retry = true
        }
      })

      const result = await agent.invoke('Test')

      expect(result.lastMessage.content[0]).toEqual({ type: 'textBlock', text: 'Success after retry' })
      expect(callCount).toBe(2)
    })

    it('does not retry when retry is not set', async () => {
      const model = new MockMessageModel().addTurn(new Error('Failure'))
      const agent = new Agent({ model })

      await expect(agent.invoke('Test')).rejects.toThrow('Failure')
    })

    it('retries model call on success when hook requests it', async () => {
      let callCount = 0
      const model = new MockMessageModel()
        .addTurn({ type: 'textBlock', text: 'First response' })
        .addTurn({ type: 'textBlock', text: 'Second response after retry' })

      const agent = new Agent({ model })
      agent.hooks.addCallback(AfterModelCallEvent, (event: AfterModelCallEvent) => {
        callCount++
        if (callCount === 1 && !event.error) {
          event.retry = true
        }
      })

      const result = await agent.invoke('Test')

      expect(result.lastMessage.content[0]).toEqual({ type: 'textBlock', text: 'Second response after retry' })
      expect(callCount).toBe(2)
    })
  })

  describe('AfterToolCallEvent retry', () => {
    it('retries tool call when hook sets retry', async () => {
      let toolCallCount = 0
      const tool = createMockTool('retryableTool', () => {
        toolCallCount++
        if (toolCallCount === 1) {
          throw new Error('First attempt failed')
        }
        return new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Success')] })
      })

      let hookCallCount = 0
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'retryableTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({ model, tools: [tool] })
      agent.hooks.addCallback(AfterToolCallEvent, (event: AfterToolCallEvent) => {
        hookCallCount++
        if (hookCallCount === 1 && event.error) {
          event.retry = true
        }
      })

      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('endTurn')
      expect(toolCallCount).toBe(2)
      expect(hookCallCount).toBe(2)
    })

    it('does not retry tool call when retry is not set', async () => {
      let toolCallCount = 0
      const tool = createMockTool('failingTool', () => {
        toolCallCount++
        throw new Error('Tool failed')
      })

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'failingTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Handled error' })

      const agent = new Agent({ model, tools: [tool] })
      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('endTurn')
      expect(toolCallCount).toBe(1)
    })

    it('fires BeforeToolCallEvent on each retry', async () => {
      let toolCallCount = 0
      const tool = createMockTool('retryableTool', () => {
        toolCallCount++
        return new ToolResultBlock({
          toolUseId: 'tool-1',
          status: 'success',
          content: [new TextBlock(`Result ${toolCallCount}`)],
        })
      })

      let beforeCount = 0
      let afterCount = 0
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'retryableTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({ model, tools: [tool] })
      agent.hooks.addCallback(BeforeToolCallEvent, () => {
        beforeCount++
      })
      agent.hooks.addCallback(AfterToolCallEvent, (event: AfterToolCallEvent) => {
        afterCount++
        if (afterCount === 1) {
          event.retry = true
        }
      })

      await agent.invoke('Test')

      expect(beforeCount).toBe(2)
      expect(afterCount).toBe(2)
      expect(toolCallCount).toBe(2)
    })

    it('retries tool call on success when hook requests it', async () => {
      let toolCallCount = 0
      const tool = createMockTool('successTool', () => {
        toolCallCount++
        return new ToolResultBlock({
          toolUseId: 'tool-1',
          status: 'success',
          content: [new TextBlock(`Result ${toolCallCount}`)],
        })
      })

      let hookCallCount = 0
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'successTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({ model, tools: [tool] })
      agent.hooks.addCallback(AfterToolCallEvent, (event: AfterToolCallEvent) => {
        hookCallCount++
        if (hookCallCount === 1) {
          event.retry = true
        }
      })

      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('endTurn')
      expect(toolCallCount).toBe(2)
      expect(hookCallCount).toBe(2)
    })
  })
})
