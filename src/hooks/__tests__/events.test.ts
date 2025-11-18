import { describe, it, expect } from 'vitest'
import {
  BeforeInvocationEvent,
  AfterInvocationEvent,
  MessageAddedEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  ModelStreamEventHook,
} from '../events.js'
import { Agent } from '../../agent/agent.js'
import { Message, ToolResultBlock, TextBlock } from '../../types/messages.js'
import { FunctionTool } from '../../tools/function-tool.js'

describe('BeforeInvocationEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const event = new BeforeInvocationEvent({ agent })

    expect(event.agent).toBe(agent)
    expect(event.type).toBe('beforeInvocationEvent')
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

    expect(event.agent).toBe(agent)
    expect(event.type).toBe('afterInvocationEvent')
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

    expect(event.agent).toBe(agent)
    expect(event.message).toBe(message)
    expect(event.type).toBe('messageAddedEvent')
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

    expect(event.agent).toBe(agent)
    expect(event.toolUse).toEqual(toolUse)
    expect(event.tool).toBe(tool)
    expect(event.type).toBe('beforeToolCallEvent')
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

    expect(event.agent).toBe(agent)
    expect(event.toolUse).toEqual(toolUse)
    expect(event.tool).toBeUndefined()
    expect(event.type).toBe('beforeToolCallEvent')
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

    expect(event.agent).toBe(agent)
    expect(event.toolUse).toEqual(toolUse)
    expect(event.tool).toBe(tool)
    expect(event.result).toBe(result)
    expect(event.error).toBeUndefined()
    expect(event.type).toBe('afterToolCallEvent')
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

    expect(event.agent).toBe(agent)
    expect(event.error).toBe(error)
    expect(event.result.status).toBe('error')
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

    expect(event.agent).toBe(agent)
    expect(event.type).toBe('beforeModelCallEvent')
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
    const event = new AfterModelCallEvent({ agent, message, stopReason })

    expect(event.agent).toBe(agent)
    expect(event.message).toBe(message)
    expect(event.stopReason).toBe(stopReason)
    expect(event.error).toBeUndefined()
    expect(event.type).toBe('afterModelCallEvent')
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    event.message = message
    // @ts-expect-error verifying that property is readonly
    event.stopReason = stopReason
  })

  it('creates instance with error property when model invocation fails', () => {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [] })
    const error = new Error('Model failed')
    const event = new AfterModelCallEvent({ agent, message, stopReason: 'error', error })

    expect(event.agent).toBe(agent)
    expect(event.error).toBe(error)
    expect(event.stopReason).toBe('error')
  })

  it('returns true for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [] })
    const event = new AfterModelCallEvent({ agent, message, stopReason: 'endTurn' })
    expect(event._shouldReverseCallbacks()).toBe(true)
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

    expect(hookEvent.agent).toBe(agent)
    expect(hookEvent.event).toEqual(streamEvent)
    expect(hookEvent.type).toBe('modelStreamEventHook')
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
