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
  ModelStreamUpdateEvent,
  InitializedEvent,
  HookableEvent,
} from '../../hooks/index.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { MockPlugin } from '../../__fixtures__/mock-plugin.js'
import { collectIterator } from '../../__fixtures__/model-test-helpers.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
import { Message, TextBlock, ToolResultBlock } from '../../types/messages.js'
import { ModelRetryLimitError } from '../../errors.js'

describe('Agent Hooks Integration', () => {
  let mockPlugin: MockPlugin

  beforeEach(() => {
    mockPlugin = new MockPlugin()
  })

  describe('invocation lifecycle', () => {
    it('fires hooks during invoke', async () => {
      const lifecyclePlugin = new MockPlugin()
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, plugins: [lifecyclePlugin] })

      await agent.invoke('Hi')

      expect(lifecyclePlugin.invocations).toHaveLength(7)

      expect(lifecyclePlugin.invocations[0]).toEqual(new InitializedEvent({ agent }))
      expect(lifecyclePlugin.invocations[1]).toEqual(new BeforeInvocationEvent({ agent }))
      expect(lifecyclePlugin.invocations[2]).toEqual(
        new MessageAddedEvent({ agent, message: new Message({ role: 'user', content: [new TextBlock('Hi')] }) })
      )
      expect(lifecyclePlugin.invocations[3]).toEqual(new BeforeModelCallEvent({ agent }))
      expect(lifecyclePlugin.invocations[4]).toEqual(
        new AfterModelCallEvent({
          agent,
          stopData: {
            stopReason: 'endTurn',
            message: new Message({ role: 'assistant', content: [new TextBlock('Hello')] }),
          },
        })
      )
      expect(lifecyclePlugin.invocations[5]).toEqual(
        new MessageAddedEvent({
          agent,
          message: new Message({ role: 'assistant', content: [new TextBlock('Hello')] }),
        })
      )
      expect(lifecyclePlugin.invocations[6]).toEqual(new AfterInvocationEvent({ agent }))
    })

    it('fires hooks during stream', async () => {
      const lifecyclePlugin = new MockPlugin()
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, plugins: [lifecyclePlugin] })

      await collectIterator(agent.stream('Hi'))

      expect(lifecyclePlugin.invocations).toHaveLength(7)

      expect(lifecyclePlugin.invocations[0]).toEqual(new InitializedEvent({ agent }))
      expect(lifecyclePlugin.invocations[1]).toEqual(new BeforeInvocationEvent({ agent }))
      expect(lifecyclePlugin.invocations[2]).toEqual(
        new MessageAddedEvent({
          agent,
          message: new Message({ role: 'user', content: [new TextBlock('Hi')] }),
        })
      )
      expect(lifecyclePlugin.invocations[3]).toEqual(new BeforeModelCallEvent({ agent }))
      expect(lifecyclePlugin.invocations[4]).toEqual(
        new AfterModelCallEvent({
          agent,
          stopData: {
            stopReason: 'endTurn',
            message: new Message({ role: 'assistant', content: [new TextBlock('Hello')] }),
          },
        })
      )
      expect(lifecyclePlugin.invocations[5]).toEqual(
        new MessageAddedEvent({
          agent,
          message: new Message({ role: 'assistant', content: [new TextBlock('Hello')] }),
        })
      )
      expect(lifecyclePlugin.invocations[6]).toEqual(new AfterInvocationEvent({ agent }))
    })
  })

  describe('runtime hook registration', () => {
    it('allows adding hooks after agent creation via addHook', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      // Track events via individual hook registrations
      const invocations: HookableEvent[] = []
      agent.addHook(BeforeInvocationEvent, (e) => {
        invocations.push(e)
      })
      agent.addHook(AfterInvocationEvent, (e) => {
        invocations.push(e)
      })

      await agent.invoke('Hi')

      expect(invocations).toHaveLength(2)
      expect(invocations[0]).toEqual(new BeforeInvocationEvent({ agent }))
      expect(invocations[1]).toEqual(new AfterInvocationEvent({ agent }))
    })
  })

  describe('multi-turn conversations', () => {
    it('fires hooks for each invoke call', async () => {
      const lifecyclePlugin = new MockPlugin()
      const model = new MockMessageModel()
        .addTurn({ type: 'textBlock', text: 'First response' })
        .addTurn({ type: 'textBlock', text: 'Second response' })

      const agent = new Agent({ model, plugins: [lifecyclePlugin] })

      await agent.invoke('First message')

      // First turn: InitializedEvent + BeforeInvocation, MessageAdded, BeforeModelCall, AfterModelCall, MessageAdded, AfterInvocation
      expect(lifecyclePlugin.invocations).toHaveLength(7)

      await agent.invoke('Second message')

      // Should have 13 events total (7 for first turn + 6 for second turn, no InitializedEvent on second)
      expect(lifecyclePlugin.invocations).toHaveLength(13)

      // Filter for just Invocation events to verify they fire for each turn
      const invocationEvents = lifecyclePlugin.invocations.filter(
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
        plugins: [mockPlugin],
      })

      await agent.invoke('Test with tool')

      // Find key events
      const beforeToolCallEvents = mockPlugin.invocations.filter((e) => e instanceof BeforeToolCallEvent)
      const afterToolCallEvents = mockPlugin.invocations.filter((e) => e instanceof AfterToolCallEvent)
      const messageAddedEvents = mockPlugin.invocations.filter((e) => e instanceof MessageAddedEvent)

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
        plugins: [mockPlugin],
      })

      // Agent should complete successfully (tool errors are handled gracefully)
      const result = await agent.invoke('Test with failing tool')
      expect(result.stopReason).toBe('endTurn')

      // Find AfterToolCallEvent
      const afterToolCallEvents = mockPlugin.invocations.filter((e) => e instanceof AfterToolCallEvent)
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

  describe('ModelStreamUpdateEvent', () => {
    it('is yielded in the stream and dispatched to hooks', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })

      const streamUpdateEvents: ModelStreamUpdateEvent[] = []
      const agent = new Agent({ model })
      agent.addHook(ModelStreamUpdateEvent, (event: ModelStreamUpdateEvent) => {
        streamUpdateEvents.push(event)
      })

      // Collect all stream events
      const allStreamEvents = []
      for await (const event of agent.stream('Test')) {
        allStreamEvents.push(event)
      }

      // Should be yielded in the stream
      const streamUpdates = allStreamEvents.filter((e) => e instanceof ModelStreamUpdateEvent)
      expect(streamUpdates.length).toBeGreaterThan(0)

      // Should also fire as hook
      expect(streamUpdateEvents.length).toBeGreaterThan(0)

      // Stream and hook should receive the same event instances
      expect(streamUpdates).toStrictEqual(streamUpdateEvents)
    })
  })

  describe('MessageAddedEvent', () => {
    it('fires for initial user input', async () => {
      const initialMessage = { role: 'user' as const, content: [{ type: 'textBlock' as const, text: 'Initial' }] }

      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response' })

      const agent = new Agent({
        model,
        messages: [initialMessage],
        plugins: [mockPlugin],
      })

      await agent.invoke('New message')

      const messageAddedEvents = mockPlugin.invocations.filter((e) => e instanceof MessageAddedEvent)

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
    it('does not duplicate user messages on error retry', async () => {
      const model = new MockMessageModel()
        .addTurn(new Error('context overflow'))
        .addTurn({ type: 'textBlock', text: 'Success' })

      const agent = new Agent({ model, printer: false })
      agent.addHook(AfterModelCallEvent, (event: AfterModelCallEvent) => {
        if (event.error) {
          event.retry = true
        }
      })

      await agent.invoke('Hello')

      // Count user messages with "Hello" — should be exactly 1
      const userMessages = agent.messages.filter(
        (m) => m.role === 'user' && m.content.some((b) => b.type === 'textBlock' && b.text === 'Hello')
      )
      expect(userMessages).toHaveLength(1)
    })

    it('does not duplicate user messages on success retry', async () => {
      let callCount = 0
      const model = new MockMessageModel()
        .addTurn({ type: 'textBlock', text: 'First' })
        .addTurn({ type: 'textBlock', text: 'Second' })

      const agent = new Agent({ model, printer: false })
      agent.addHook(AfterModelCallEvent, (event: AfterModelCallEvent) => {
        callCount++
        if (callCount === 1 && !event.error) {
          event.retry = true
        }
      })

      await agent.invoke('Hello')

      const userMessages = agent.messages.filter(
        (m) => m.role === 'user' && m.content.some((b) => b.type === 'textBlock' && b.text === 'Hello')
      )
      expect(userMessages).toHaveLength(1)
    })

    it('retries model call when hook sets retry', async () => {
      let callCount = 0
      const model = new MockMessageModel()
        .addTurn(new Error('First attempt failed'))
        .addTurn({ type: 'textBlock', text: 'Success after retry' })

      const agent = new Agent({ model })
      agent.addHook(AfterModelCallEvent, (event: AfterModelCallEvent) => {
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
      agent.addHook(AfterModelCallEvent, (event: AfterModelCallEvent) => {
        callCount++
        if (callCount === 1 && !event.error) {
          event.retry = true
        }
      })

      const result = await agent.invoke('Test')

      expect(result.lastMessage.content[0]).toEqual({ type: 'textBlock', text: 'Second response after retry' })
      expect(callCount).toBe(2)
    })

    it('throws ModelRetryLimitError when error retry hook always retries', async () => {
      // Model that always fails
      const turns = Array.from({ length: 10 }, () => new Error('always fails'))
      const model = new MockMessageModel()
      for (const t of turns) model.addTurn(t)

      const agent = new Agent({ model, maxModelRetries: 3 })
      agent.addHook(AfterModelCallEvent, (event: AfterModelCallEvent) => {
        if (event.error) {
          event.retry = true
        }
      })

      await expect(agent.invoke('Test')).rejects.toThrow(ModelRetryLimitError)
    })

    it('throws ModelRetryLimitError when success retry hook always retries', async () => {
      const turns = Array.from({ length: 10 }, () => ({ type: 'textBlock' as const, text: 'response' }))
      const model = new MockMessageModel()
      for (const t of turns) model.addTurn(t)

      const agent = new Agent({ model, maxModelRetries: 2 })
      agent.addHook(AfterModelCallEvent, (event: AfterModelCallEvent) => {
        event.retry = true
      })

      await expect(agent.invoke('Test')).rejects.toThrow(ModelRetryLimitError)
    })

    it('respects custom maxModelRetries value', async () => {
      let callCount = 0
      const turns = Array.from({ length: 10 }, () => new Error('fail'))
      const model = new MockMessageModel()
      for (const t of turns) model.addTurn(t)

      const agent = new Agent({ model, maxModelRetries: 4 })
      agent.addHook(AfterModelCallEvent, (event: AfterModelCallEvent) => {
        callCount++
        if (event.error) {
          event.retry = true
        }
      })

      await expect(agent.invoke('Test')).rejects.toThrow(ModelRetryLimitError)
      // 1 initial + 4 retries = 5 calls
      expect(callCount).toBe(5)
    })

    it('uses default maxModelRetries of 5', async () => {
      let callCount = 0
      const turns = Array.from({ length: 10 }, () => new Error('fail'))
      const model = new MockMessageModel()
      for (const t of turns) model.addTurn(t)

      const agent = new Agent({ model })
      agent.addHook(AfterModelCallEvent, (event: AfterModelCallEvent) => {
        callCount++
        if (event.error) {
          event.retry = true
        }
      })

      await expect(agent.invoke('Test')).rejects.toThrow(ModelRetryLimitError)
      // 1 initial + 5 retries = 6 calls
      expect(callCount).toBe(6)
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
      agent.addHook(AfterToolCallEvent, (event: AfterToolCallEvent) => {
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
      agent.addHook(BeforeToolCallEvent, () => {
        beforeCount++
      })
      agent.addHook(AfterToolCallEvent, (event: AfterToolCallEvent) => {
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
      agent.addHook(AfterToolCallEvent, (event: AfterToolCallEvent) => {
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
