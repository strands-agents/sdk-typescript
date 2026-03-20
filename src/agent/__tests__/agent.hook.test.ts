import { beforeEach, describe, expect, it } from 'vitest'
import { Agent } from '../agent.js'
import {
  AfterInvocationEvent,
  AfterModelCallEvent,
  AfterToolCallEvent,
  AfterToolsEvent,
  BeforeInvocationEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
  BeforeToolsEvent,
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

  describe('cancel tool via hooks', () => {
    it('cancels individual tool call with default message when cancel is true', async () => {
      let toolExecuted = false
      const tool = createMockTool('blockedTool', () => {
        toolExecuted = true
        return new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Success')] })
      })

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'blockedTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({ model, tools: [tool], plugins: [mockPlugin] })
      agent.addHook(BeforeToolCallEvent, (event: BeforeToolCallEvent) => {
        event.cancel = true
      })

      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('endTurn')
      expect(toolExecuted).toBe(false)

      const afterToolCallEvents = mockPlugin.invocations.filter((e) => e instanceof AfterToolCallEvent)
      expect(afterToolCallEvents).toHaveLength(1)
      const afterEvent = afterToolCallEvents[0] as AfterToolCallEvent
      expect(afterEvent.result).toEqual(
        new ToolResultBlock({
          toolUseId: 'tool-1',
          status: 'error',
          content: [new TextBlock('tool cancelled by hook')],
        })
      )
    })

    it('cancels individual tool call with custom message when cancel is a string', async () => {
      let toolExecuted = false
      const tool = createMockTool('blockedTool', () => {
        toolExecuted = true
        return new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Success')] })
      })

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'blockedTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({ model, tools: [tool], plugins: [mockPlugin] })
      agent.addHook(BeforeToolCallEvent, (event: BeforeToolCallEvent) => {
        event.cancel = 'Tool call limit exceeded'
      })

      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('endTurn')
      expect(toolExecuted).toBe(false)

      const afterToolCallEvents = mockPlugin.invocations.filter((e) => e instanceof AfterToolCallEvent)
      expect(afterToolCallEvents).toHaveLength(1)
      const afterEvent = afterToolCallEvents[0] as AfterToolCallEvent
      expect(afterEvent.result).toEqual(
        new ToolResultBlock({
          toolUseId: 'tool-1',
          status: 'error',
          content: [new TextBlock('Tool call limit exceeded')],
        })
      )
    })

    it('cancels only specific tools when BeforeToolCallEvent selectively cancels', async () => {
      const executedTools: string[] = []
      const tool1 = createMockTool('allowedTool', () => {
        executedTools.push('allowedTool')
        return new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Allowed')] })
      })
      const tool2 = createMockTool('blockedTool', () => {
        executedTools.push('blockedTool')
        return new ToolResultBlock({ toolUseId: 'tool-2', status: 'success', content: [new TextBlock('Blocked')] })
      })

      const model = new MockMessageModel()
        .addTurn([
          { type: 'toolUseBlock', name: 'allowedTool', toolUseId: 'tool-1', input: {} },
          { type: 'toolUseBlock', name: 'blockedTool', toolUseId: 'tool-2', input: {} },
        ])
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({ model, tools: [tool1, tool2], plugins: [mockPlugin] })
      agent.addHook(BeforeToolCallEvent, (event: BeforeToolCallEvent) => {
        if (event.toolUse.name === 'blockedTool') {
          event.cancel = 'This tool is blocked'
        }
      })

      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('endTurn')
      expect(executedTools).toEqual(['allowedTool'])

      const afterToolCallEvents = mockPlugin.invocations.filter((e) => e instanceof AfterToolCallEvent)
      expect(afterToolCallEvents).toHaveLength(2)
      expect((afterToolCallEvents[0] as AfterToolCallEvent).result).toEqual(
        new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Allowed')] })
      )
      expect((afterToolCallEvents[1] as AfterToolCallEvent).result).toEqual(
        new ToolResultBlock({
          toolUseId: 'tool-2',
          status: 'error',
          content: [new TextBlock('This tool is blocked')],
        })
      )
    })

    it('cancels all tools with default message when BeforeToolsEvent.cancel is true', async () => {
      let toolExecuted = false
      const tool = createMockTool('blockedTool', () => {
        toolExecuted = true
        return new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Success')] })
      })

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'blockedTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({ model, tools: [tool], plugins: [mockPlugin] })
      agent.addHook(BeforeToolsEvent, (event: BeforeToolsEvent) => {
        event.cancel = true
      })

      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('endTurn')
      expect(toolExecuted).toBe(false)

      const afterToolsEvents = mockPlugin.invocations.filter((e) => e instanceof AfterToolsEvent)
      expect(afterToolsEvents).toHaveLength(1)
      const afterEvent = afterToolsEvents[0] as AfterToolsEvent
      expect(afterEvent.message.content[0]).toEqual(
        new ToolResultBlock({
          toolUseId: 'tool-1',
          status: 'error',
          content: [new TextBlock('tool cancelled by hook')],
        })
      )
    })

    it('cancels all tools with custom message when BeforeToolsEvent.cancel is a string', async () => {
      let toolExecuted = false
      const tool = createMockTool('blockedTool', () => {
        toolExecuted = true
        return new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Success')] })
      })

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'blockedTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({ model, tools: [tool], plugins: [mockPlugin] })
      agent.addHook(BeforeToolsEvent, (event: BeforeToolsEvent) => {
        event.cancel = 'All tools blocked'
      })

      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('endTurn')
      expect(toolExecuted).toBe(false)

      const afterToolsEvents = mockPlugin.invocations.filter((e) => e instanceof AfterToolsEvent)
      expect(afterToolsEvents).toHaveLength(1)
      const afterEvent = afterToolsEvents[0] as AfterToolsEvent
      expect(afterEvent.message.content[0]).toEqual(
        new ToolResultBlock({
          toolUseId: 'tool-1',
          status: 'error',
          content: [new TextBlock('All tools blocked')],
        })
      )
    })

    it('cancels all tools in a batch via BeforeToolsEvent with correct toolUseIds', async () => {
      const executedTools: string[] = []
      const tool1 = createMockTool('tool1', () => {
        executedTools.push('tool1')
        return new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Result 1')] })
      })
      const tool2 = createMockTool('tool2', () => {
        executedTools.push('tool2')
        return new ToolResultBlock({ toolUseId: 'tool-2', status: 'success', content: [new TextBlock('Result 2')] })
      })

      const model = new MockMessageModel()
        .addTurn([
          { type: 'toolUseBlock', name: 'tool1', toolUseId: 'tool-1', input: {} },
          { type: 'toolUseBlock', name: 'tool2', toolUseId: 'tool-2', input: {} },
        ])
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({ model, tools: [tool1, tool2], plugins: [mockPlugin] })
      agent.addHook(BeforeToolsEvent, (event: BeforeToolsEvent) => {
        event.cancel = 'Batch cancelled'
      })

      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('endTurn')
      expect(executedTools).toEqual([])

      const afterToolsEvents = mockPlugin.invocations.filter((e) => e instanceof AfterToolsEvent)
      expect(afterToolsEvents).toHaveLength(1)
      const afterEvent = afterToolsEvents[0] as AfterToolsEvent
      expect(afterEvent.message.content).toEqual([
        new ToolResultBlock({
          toolUseId: 'tool-1',
          status: 'error',
          content: [new TextBlock('Batch cancelled')],
        }),
        new ToolResultBlock({
          toolUseId: 'tool-2',
          status: 'error',
          content: [new TextBlock('Batch cancelled')],
        }),
      ])
    })

    it('emits cancel events correctly via stream()', async () => {
      let toolExecuted = false
      const tool = createMockTool('blockedTool', () => {
        toolExecuted = true
        return new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Success')] })
      })

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'blockedTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({ model, tools: [tool] })
      agent.addHook(BeforeToolCallEvent, (event: BeforeToolCallEvent) => {
        event.cancel = 'Cancelled via stream'
      })

      const items = await collectIterator(agent.stream('Test'))

      expect(toolExecuted).toBe(false)

      const beforeToolCallEvents = items.filter((e) => e instanceof BeforeToolCallEvent)
      const afterToolCallEvents = items.filter((e) => e instanceof AfterToolCallEvent)
      expect(beforeToolCallEvents).toHaveLength(1)
      expect(afterToolCallEvents).toHaveLength(1)

      const afterEvent = afterToolCallEvents[0] as AfterToolCallEvent
      expect(afterEvent.result).toEqual(
        new ToolResultBlock({
          toolUseId: 'tool-1',
          status: 'error',
          content: [new TextBlock('Cancelled via stream')],
        })
      )
    })

    it('allows retry after cancel on BeforeToolCallEvent', async () => {
      let toolCallCount = 0
      const tool = createMockTool('retryTool', () => {
        toolCallCount++
        return new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Success')] })
      })

      let beforeCount = 0
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'retryTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({ model, tools: [tool] })
      agent.addHook(BeforeToolCallEvent, (event: BeforeToolCallEvent) => {
        beforeCount++
        if (beforeCount === 1) {
          event.cancel = 'Not yet'
        }
      })
      agent.addHook(AfterToolCallEvent, (event: AfterToolCallEvent) => {
        if (event.result.status === 'error' && beforeCount === 1) {
          event.retry = true
        }
      })

      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('endTurn')
      expect(beforeCount).toBe(2)
      expect(toolCallCount).toBe(1) // Only executed on second attempt
    })
  })
})
