import { describe, expect, it } from 'vitest'
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
  ModelStreamEventHook,
  ContentBlockHook,
} from '../events.js'
import { Agent } from '../../agent/agent.js'
import { Message, TextBlock, ToolResultBlock } from '../../types/messages.js'
import { FunctionTool } from '../../tools/function-tool.js'

describe('BeforeInvocationEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const event = new BeforeInvocationEvent({ agent })

    expect(event).toEqual({
      type: 'beforeInvocationEvent',
      agent: agent,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
  })

  it('returns false for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const event = new BeforeInvocationEvent({ agent })
    expect(event._shouldReverseCallbacks()).toBe(false)
  })
})

describe('AfterInvocationEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const event = new AfterInvocationEvent({ agent })

    expect(event).toEqual({
      type: 'afterInvocationEvent',
      agent: agent,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
  })

  it('returns true for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const event = new AfterInvocationEvent({ agent })
    expect(event._shouldReverseCallbacks()).toBe(true)
  })
})

describe('MessageAddedEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [{ type: 'textBlock', text: 'Hello' }] })
    const event = new MessageAddedEvent({ agent, message })

    expect(event).toEqual({
      type: 'messageAddedEvent',
      agent: agent,
      message: message,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    event.message = message
  })

  it('returns false for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [] })
    const event = new MessageAddedEvent({ agent, message })
    expect(event._shouldReverseCallbacks()).toBe(false)
  })
})

describe('BeforeToolCallEvent', () => {
  it('creates instance with correct properties when tool is found', () => {
    const agent = new Agent()
    const tool = new FunctionTool({
      name: 'testTool',
      description: 'Test tool',
      inputSchema: {},
      callback: () => 'result',
    })
    const toolUse = {
      name: 'testTool',
      toolUseId: 'test-id',
      input: { arg: 'value' },
    }
    const event = new BeforeToolCallEvent({ agent, toolUse, tool })

    expect(event).toEqual({
      type: 'beforeToolCallEvent',
      agent: agent,
      toolUse: toolUse,
      tool: tool,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    event.toolUse = toolUse
    // @ts-expect-error verifying that property is readonly
    event.tool = tool
  })

  it('creates instance with undefined tool when tool is not found', () => {
    const agent = new Agent()
    const toolUse = {
      name: 'unknownTool',
      toolUseId: 'test-id',
      input: {},
    }
    const event = new BeforeToolCallEvent({ agent, toolUse, tool: undefined })

    expect(event).toEqual({
      type: 'beforeToolCallEvent',
      agent: agent,
      toolUse: toolUse,
      tool: undefined,
    })
  })

  it('returns false for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const toolUse = { name: 'test', toolUseId: 'id', input: {} }
    const event = new BeforeToolCallEvent({ agent, toolUse, tool: undefined })
    expect(event._shouldReverseCallbacks()).toBe(false)
  })
})

describe('AfterToolCallEvent', () => {
  it('creates instance with correct properties on success', () => {
    const agent = new Agent()
    const tool = new FunctionTool({
      name: 'testTool',
      description: 'Test tool',
      inputSchema: {},
      callback: () => 'result',
    })
    const toolUse = {
      name: 'testTool',
      toolUseId: 'test-id',
      input: {},
    }
    const result = new ToolResultBlock({
      toolUseId: 'test-id',
      status: 'success',
      content: [new TextBlock('Success')],
    })
    const event = new AfterToolCallEvent({ agent, toolUse, tool, result })

    expect(event).toEqual({
      type: 'afterToolCallEvent',
      agent: agent,
      toolUse: toolUse,
      tool: tool,
      result: result,
      error: undefined,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    event.toolUse = toolUse
    // @ts-expect-error verifying that property is readonly
    event.tool = tool
    // @ts-expect-error verifying that property is readonly
    event.result = result
  })

  it('creates instance with error property when tool execution fails', () => {
    const agent = new Agent()
    const toolUse = { name: 'test', toolUseId: 'id', input: {} }
    const result = new ToolResultBlock({
      toolUseId: 'id',
      status: 'error',
      content: [new TextBlock('Error')],
    })
    const error = new Error('Tool failed')
    const event = new AfterToolCallEvent({ agent, toolUse, tool: undefined, result, error })

    expect(event).toEqual({
      type: 'afterToolCallEvent',
      agent: agent,
      toolUse: toolUse,
      tool: undefined,
      result: result,
      error: error,
    })
  })

  it('returns true for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const toolUse = { name: 'test', toolUseId: 'id', input: {} }
    const result = new ToolResultBlock({
      toolUseId: 'id',
      status: 'success',
      content: [],
    })
    const event = new AfterToolCallEvent({ agent, toolUse, tool: undefined, result })
    expect(event._shouldReverseCallbacks()).toBe(true)
  })
})

describe('BeforeModelCallEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const event = new BeforeModelCallEvent({ agent })

    expect(event).toEqual({
      type: 'beforeModelCallEvent',
      agent: agent,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
  })

  it('returns false for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const event = new BeforeModelCallEvent({ agent })
    expect(event._shouldReverseCallbacks()).toBe(false)
  })
})

describe('AfterModelCallEvent', () => {
  it('creates instance with correct properties on success', () => {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [{ type: 'textBlock', text: 'Response' }] })
    const stopReason = 'endTurn'
    const response = { message, stopReason }
    const event = new AfterModelCallEvent({ agent, stopData: response })

    expect(event).toEqual({
      type: 'afterModelCallEvent',
      agent: agent,
      stopData: response,
      error: undefined,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    event.stopData = response
  })

  it('creates instance with error property when model invocation fails', () => {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [] })
    const error = new Error('Model failed')
    const response = { message, stopReason: 'error' }
    const event = new AfterModelCallEvent({ agent, stopData: response, error })

    expect(event).toEqual({
      type: 'afterModelCallEvent',
      agent: agent,
      stopData: response,
      error: error,
    })
  })

  it('returns true for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [] })
    const response = { message, stopReason: 'endTurn' }
    const event = new AfterModelCallEvent({ agent, stopData: response })
    expect(event._shouldReverseCallbacks()).toBe(true)
  })

  it('allows retryModelCall to be set when error is present', () => {
    const agent = new Agent()
    const error = new Error('Model failed')
    const event = new AfterModelCallEvent({ agent, error })

    // Initially undefined
    expect(event.retryModelCall).toBeUndefined()

    // Can be set to true
    event.retryModelCall = true
    expect(event.retryModelCall).toBe(true)

    // Can be set to false
    event.retryModelCall = false
    expect(event.retryModelCall).toBe(false)
  })

  it('retryModelCall is optional and defaults to undefined', () => {
    const agent = new Agent()
    const error = new Error('Model failed')
    const event = new AfterModelCallEvent({ agent, error })

    expect(event.retryModelCall).toBeUndefined()
  })
})

describe('ModelStreamEventHook', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const streamEvent = {
      type: 'modelMessageStartEvent' as const,
      role: 'assistant' as const,
    }
    const hookEvent = new ModelStreamEventHook({ agent, event: streamEvent })

    expect(hookEvent).toEqual({
      type: 'modelStreamEventHook',
      agent: agent,
      event: streamEvent,
    })
    // @ts-expect-error verifying that property is readonly
    hookEvent.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    hookEvent.event = streamEvent
  })

  it('returns false for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const streamEvent = {
      type: 'modelMessageStartEvent' as const,
      role: 'assistant' as const,
    }
    const hookEvent = new ModelStreamEventHook({ agent, event: streamEvent })
    expect(hookEvent._shouldReverseCallbacks()).toBe(false)
  })
})

describe('ContentBlockHook', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const contentBlock = new TextBlock('Hello world')
    const hookEvent = new ContentBlockHook({ agent, block: contentBlock })

    expect(hookEvent).toEqual({
      type: 'contentBlockHook',
      agent: agent,
      block: contentBlock,
    })
    // @ts-expect-error verifying that property is readonly
    hookEvent.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    hookEvent.block = contentBlock
  })

  it('returns false for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const contentBlock = new TextBlock('Hello world')
    const hookEvent = new ContentBlockHook({ agent, block: contentBlock })
    expect(hookEvent._shouldReverseCallbacks()).toBe(false)
  })

  it('works with ToolResultBlock', () => {
    const agent = new Agent()
    const toolResultBlock = new ToolResultBlock({
      toolUseId: 'test-id',
      status: 'success',
      content: [new TextBlock('Result')],
    })
    const hookEvent = new ContentBlockHook({ agent, block: toolResultBlock })

    expect(hookEvent).toEqual({
      type: 'contentBlockHook',
      agent: agent,
      block: toolResultBlock,
    })
  })
})

describe('BeforeToolsEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const message = new Message({
      role: 'assistant',
      content: [
        {
          type: 'toolUseBlock',
          name: 'testTool',
          toolUseId: 'test-id',
          input: { arg: 'value' },
        },
      ],
    })
    const event = new BeforeToolsEvent({ agent, message })

    expect(event).toEqual({
      type: 'beforeToolsEvent',
      agent: agent,
      message: message,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    event.message = message
  })

  it('returns false for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [] })
    const event = new BeforeToolsEvent({ agent, message })
    expect(event._shouldReverseCallbacks()).toBe(false)
  })
})

describe('AfterToolsEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const message = new Message({
      role: 'user',
      content: [
        {
          type: 'toolResultBlock',
          toolUseId: 'test-id',
          status: 'success',
          content: [{ type: 'textBlock', text: 'Result' }],
        },
      ],
    })
    const event = new AfterToolsEvent({ agent, message })

    expect(event).toEqual({
      type: 'afterToolsEvent',
      agent: agent,
      message: message,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    event.message = message
  })

  it('returns true for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const message = new Message({ role: 'user', content: [] })
    const event = new AfterToolsEvent({ agent, message })
    expect(event._shouldReverseCallbacks()).toBe(true)
  })
})
