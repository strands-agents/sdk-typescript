import { describe, expect, it } from 'vitest'
import {
  InitializedEvent,
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
  ContentBlockEvent,
  ModelMessageEvent,
  ToolResultEvent,
  ToolStreamUpdateEvent,
  AgentResultEvent,
} from '../events.js'
import { Agent } from '../../agent/agent.js'
import { AgentResult } from '../../types/agent.js'
import { AgentMetrics } from '../../telemetry/meter.js'
import { Message, TextBlock, ToolResultBlock, ToolUseBlock } from '../../types/messages.js'
import { FunctionTool } from '../../tools/function-tool.js'
import { ToolStreamEvent } from '../../tools/tool.js'

describe('InitializedEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const event = new InitializedEvent({ agent })

    expect(event).toEqual({
      type: 'initializedEvent',
      agent: agent,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
  })

  it('returns false for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const event = new InitializedEvent({ agent })
    expect(event._shouldReverseCallbacks()).toBe(false)
  })
})

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
    const message = new Message({ role: 'assistant', content: [new TextBlock('Hello')] })
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
      cancel: false,
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
      cancel: false,
    })
  })

  it('returns false for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const toolUse = { name: 'test', toolUseId: 'id', input: {} }
    const event = new BeforeToolCallEvent({ agent, toolUse, tool: undefined })
    expect(event._shouldReverseCallbacks()).toBe(false)
  })

  it('allows cancel to be set to true', () => {
    const agent = new Agent()
    const toolUse = { name: 'test', toolUseId: 'id', input: {} }
    const event = new BeforeToolCallEvent({ agent, toolUse, tool: undefined })

    expect(event.cancel).toBe(false)
    event.cancel = true
    expect(event.cancel).toBe(true)
  })

  it('allows cancel to be set to a string message', () => {
    const agent = new Agent()
    const toolUse = { name: 'test', toolUseId: 'id', input: {} }
    const event = new BeforeToolCallEvent({ agent, toolUse, tool: undefined })

    event.cancel = 'tool not allowed'
    expect(event.cancel).toBe('tool not allowed')
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

  it('allows retry to be set when error is present', () => {
    const agent = new Agent()
    const toolUse = { name: 'test', toolUseId: 'id', input: {} }
    const result = new ToolResultBlock({
      toolUseId: 'id',
      status: 'error',
      content: [new TextBlock('Error')],
    })
    const error = new Error('Tool failed')
    const event = new AfterToolCallEvent({ agent, toolUse, tool: undefined, result, error })

    expect(event.retry).toBeUndefined()

    event.retry = true
    expect(event.retry).toBe(true)

    event.retry = false
    expect(event.retry).toBe(false)
  })

  it('allows retry to be set on success', () => {
    const agent = new Agent()
    const toolUse = { name: 'test', toolUseId: 'id', input: {} }
    const result = new ToolResultBlock({
      toolUseId: 'id',
      status: 'success',
      content: [new TextBlock('Success')],
    })
    const event = new AfterToolCallEvent({ agent, toolUse, tool: undefined, result })

    expect(event.retry).toBeUndefined()

    event.retry = true
    expect(event.retry).toBe(true)
  })
})

describe('BeforeModelCallEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const event = new BeforeModelCallEvent({ agent, model: agent.model })

    expect(event).toEqual({
      type: 'beforeModelCallEvent',
      agent: agent,
      model: agent.model,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
  })

  it('returns false for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const event = new BeforeModelCallEvent({ agent, model: agent.model })
    expect(event._shouldReverseCallbacks()).toBe(false)
  })
})

describe('AfterModelCallEvent', () => {
  it('creates instance with correct properties on success', () => {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [new TextBlock('Response')] })
    const stopReason = 'endTurn'
    const response = { message, stopReason }
    const event = new AfterModelCallEvent({ agent, model: agent.model, stopData: response })

    expect(event).toEqual({
      type: 'afterModelCallEvent',
      agent: agent,
      model: agent.model,
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
    const event = new AfterModelCallEvent({ agent, model: agent.model, stopData: response, error })

    expect(event).toEqual({
      type: 'afterModelCallEvent',
      agent: agent,
      model: agent.model,
      stopData: response,
      error: error,
    })
  })

  it('returns true for _shouldReverseCallbacks', () => {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [] })
    const response = { message, stopReason: 'endTurn' }
    const event = new AfterModelCallEvent({ agent, model: agent.model, stopData: response })
    expect(event._shouldReverseCallbacks()).toBe(true)
  })

  it('allows retry to be set when error is present', () => {
    const agent = new Agent()
    const error = new Error('Model failed')
    const event = new AfterModelCallEvent({ agent, model: agent.model, error })

    // Initially undefined
    expect(event.retry).toBeUndefined()

    // Can be set to true
    event.retry = true
    expect(event.retry).toBe(true)

    // Can be set to false
    event.retry = false
    expect(event.retry).toBe(false)
  })

  it('retry is optional and defaults to undefined', () => {
    const agent = new Agent()
    const error = new Error('Model failed')
    const event = new AfterModelCallEvent({ agent, model: agent.model, error })

    expect(event.retry).toBeUndefined()
  })
})

describe('ModelStreamUpdateEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const streamEvent = {
      type: 'modelMessageStartEvent' as const,
      role: 'assistant' as const,
    }
    const hookEvent = new ModelStreamUpdateEvent({ agent, event: streamEvent })

    expect(hookEvent).toEqual({
      type: 'modelStreamUpdateEvent',
      agent: agent,
      event: streamEvent,
    })
    // @ts-expect-error verifying that property is readonly
    hookEvent.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    hookEvent.event = streamEvent
  })
})

describe('ContentBlockEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const contentBlock = new TextBlock('Hello')
    const event = new ContentBlockEvent({ agent, contentBlock })

    expect(event).toEqual({
      type: 'contentBlockEvent',
      agent: agent,
      contentBlock: contentBlock,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    event.contentBlock = contentBlock
  })
})

describe('ModelMessageEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [new TextBlock('Hello')] })
    const event = new ModelMessageEvent({ agent, message, stopReason: 'endTurn' })

    expect(event).toEqual({
      type: 'modelMessageEvent',
      agent: agent,
      message: message,
      stopReason: 'endTurn',
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    event.message = message
    // @ts-expect-error verifying that property is readonly
    event.stopReason = 'endTurn'
  })
})

describe('ToolResultEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const toolResult = new ToolResultBlock({
      toolUseId: 'test-id',
      status: 'success',
      content: [new TextBlock('Result')],
    })
    const event = new ToolResultEvent({ agent, result: toolResult })

    expect(event).toEqual({
      type: 'toolResultEvent',
      agent: agent,
      result: toolResult,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    event.result = toolResult
  })
})

describe('ToolStreamUpdateEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const toolStreamEvent = new ToolStreamEvent({ data: 'progress' })
    const event = new ToolStreamUpdateEvent({ agent, event: toolStreamEvent })

    expect(event).toEqual({
      type: 'toolStreamUpdateEvent',
      agent: agent,
      event: toolStreamEvent,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    event.event = toolStreamEvent
  })
})

describe('AgentResultEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const result = new AgentResult({
      stopReason: 'endTurn',
      lastMessage: new Message({ role: 'assistant', content: [new TextBlock('Done')] }),
      metrics: new AgentMetrics(),
    })
    const event = new AgentResultEvent({ agent, result })

    expect(event).toEqual({
      type: 'agentResultEvent',
      agent: agent,
      result: result,
    })
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
    // @ts-expect-error verifying that property is readonly
    event.result = result
  })
})

describe('BeforeToolsEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const message = new Message({
      role: 'assistant',
      content: [
        new ToolUseBlock({
          name: 'testTool',
          toolUseId: 'test-id',
          input: { arg: 'value' },
        }),
      ],
    })
    const event = new BeforeToolsEvent({ agent, message })

    expect(event).toEqual({
      type: 'beforeToolsEvent',
      agent: agent,
      message: message,
      cancel: false,
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

  it('allows cancel to be set to true', () => {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [] })
    const event = new BeforeToolsEvent({ agent, message })

    expect(event.cancel).toBe(false)
    event.cancel = true
    expect(event.cancel).toBe(true)
  })

  it('allows cancel to be set to a string message', () => {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [] })
    const event = new BeforeToolsEvent({ agent, message })

    event.cancel = 'tools not allowed'
    expect(event.cancel).toBe('tools not allowed')
  })
})

describe('AfterToolsEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const message = new Message({
      role: 'user',
      content: [
        new ToolResultBlock({
          toolUseId: 'test-id',
          status: 'success',
          content: [new TextBlock('Result')],
        }),
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

// ===================== toJSON serialization tests =====================

describe('toJSON serialization', () => {
  describe('InitializedEvent', () => {
    it('excludes agent and returns only type', () => {
      const agent = new Agent()
      const event = new InitializedEvent({ agent })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({ type: 'initializedEvent' })
    })
  })

  describe('BeforeInvocationEvent', () => {
    it('excludes agent and returns only type', () => {
      const agent = new Agent()
      const event = new BeforeInvocationEvent({ agent })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({ type: 'beforeInvocationEvent' })
    })
  })

  describe('AfterInvocationEvent', () => {
    it('excludes agent and returns only type', () => {
      const agent = new Agent()
      const event = new AfterInvocationEvent({ agent })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({ type: 'afterInvocationEvent' })
    })
  })

  describe('BeforeModelCallEvent', () => {
    it('excludes agent and model and returns only type', () => {
      const agent = new Agent()
      const event = new BeforeModelCallEvent({ agent, model: agent.model })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({ type: 'beforeModelCallEvent' })
    })
  })

  describe('MessageAddedEvent', () => {
    it('includes message and excludes agent', () => {
      const agent = new Agent()
      const message = new Message({ role: 'assistant', content: [new TextBlock('Hello')] })
      const event = new MessageAddedEvent({ agent, message })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'messageAddedEvent',
        message: { role: 'assistant', content: [{ text: 'Hello' }] },
      })
    })
  })

  describe('ModelStreamUpdateEvent', () => {
    it('includes stream event and excludes agent', () => {
      const agent = new Agent()
      const streamEvent = {
        type: 'modelContentBlockDeltaEvent' as const,
        delta: { type: 'textDelta' as const, text: 'Hi' },
      }
      const event = new ModelStreamUpdateEvent({ agent, event: streamEvent })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'modelStreamUpdateEvent',
        event: { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: 'Hi' } },
      })
    })
  })

  describe('ContentBlockEvent', () => {
    it('includes content block and excludes agent', () => {
      const agent = new Agent()
      const contentBlock = new TextBlock('Hello world')
      const event = new ContentBlockEvent({ agent, contentBlock })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'contentBlockEvent',
        contentBlock: { text: 'Hello world' },
      })
    })
  })

  describe('ModelMessageEvent', () => {
    it('includes message and stopReason, excludes agent', () => {
      const agent = new Agent()
      const message = new Message({ role: 'assistant', content: [new TextBlock('Done')] })
      const event = new ModelMessageEvent({ agent, message, stopReason: 'endTurn' })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'modelMessageEvent',
        message: { role: 'assistant', content: [{ text: 'Done' }] },
        stopReason: 'endTurn',
      })
    })
  })

  describe('ToolResultEvent', () => {
    it('includes result and excludes agent', () => {
      const agent = new Agent()
      const result = new ToolResultBlock({
        toolUseId: 'tool-1',
        status: 'success',
        content: [new TextBlock('42')],
      })
      const event = new ToolResultEvent({ agent, result })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'toolResultEvent',
        result: { toolResult: { toolUseId: 'tool-1', status: 'success', content: [{ text: '42' }] } },
      })
    })
  })

  describe('ToolStreamUpdateEvent', () => {
    it('includes tool stream event and excludes agent', () => {
      const agent = new Agent()
      const toolStreamEvent = new ToolStreamEvent({ data: { progress: 50 } })
      const event = new ToolStreamUpdateEvent({ agent, event: toolStreamEvent })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'toolStreamUpdateEvent',
        event: { type: 'toolStreamEvent', data: { progress: 50 } },
      })
    })
  })

  describe('AgentResultEvent', () => {
    it('includes result and excludes agent', () => {
      const agent = new Agent()
      const result = new AgentResult({
        stopReason: 'endTurn',
        lastMessage: new Message({ role: 'assistant', content: [new TextBlock('Done')] }),
        metrics: new AgentMetrics(),
      })
      const event = new AgentResultEvent({ agent, result })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'agentResultEvent',
        result: {
          type: 'agentResult',
          stopReason: 'endTurn',
          lastMessage: { role: 'assistant', content: [{ text: 'Done' }] },
        },
      })
    })
  })

  describe('BeforeToolCallEvent', () => {
    it('includes toolUse and excludes agent, tool, and cancel', () => {
      const agent = new Agent()
      const tool = new FunctionTool({
        name: 'testTool',
        description: 'Test',
        inputSchema: {},
        callback: () => 'result',
      })
      const toolUse = { name: 'testTool', toolUseId: 'id-1', input: { query: 'hello' } }
      const event = new BeforeToolCallEvent({ agent, toolUse, tool })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'beforeToolCallEvent',
        toolUse: { name: 'testTool', toolUseId: 'id-1', input: { query: 'hello' } },
      })
    })
  })

  describe('AfterToolCallEvent', () => {
    it('includes toolUse and result, excludes agent and tool on success', () => {
      const agent = new Agent()
      const toolUse = { name: 'calc', toolUseId: 'id-1', input: {} }
      const result = new ToolResultBlock({
        toolUseId: 'id-1',
        status: 'success',
        content: [new TextBlock('42')],
      })
      const event = new AfterToolCallEvent({ agent, toolUse, tool: undefined, result })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'afterToolCallEvent',
        toolUse: { name: 'calc', toolUseId: 'id-1', input: {} },
        result: { toolResult: { toolUseId: 'id-1', status: 'success', content: [{ text: '42' }] } },
      })
    })

    it('converts error to message string and excludes retry', () => {
      const agent = new Agent()
      const toolUse = { name: 'calc', toolUseId: 'id-1', input: {} }
      const result = new ToolResultBlock({
        toolUseId: 'id-1',
        status: 'error',
        content: [new TextBlock('Error')],
      })
      const error = new Error('Tool crashed')
      const event = new AfterToolCallEvent({ agent, toolUse, tool: undefined, result, error })
      event.retry = true
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'afterToolCallEvent',
        toolUse: { name: 'calc', toolUseId: 'id-1', input: {} },
        result: { toolResult: { toolUseId: 'id-1', status: 'error', content: [{ text: 'Error' }] } },
        error: { message: 'Tool crashed' },
      })
    })
  })

  describe('AfterModelCallEvent', () => {
    it('includes stopData and excludes agent and model on success', () => {
      const agent = new Agent()
      const message = new Message({ role: 'assistant', content: [new TextBlock('Hi')] })
      const stopData = { message, stopReason: 'endTurn' as const }
      const event = new AfterModelCallEvent({ agent, model: agent.model, stopData })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'afterModelCallEvent',
        stopData: {
          message: { role: 'assistant', content: [{ text: 'Hi' }] },
          stopReason: 'endTurn',
        },
      })
    })

    it('converts error to message string and excludes retry', () => {
      const agent = new Agent()
      const error = new Error('Model failed')
      const event = new AfterModelCallEvent({ agent, model: agent.model, error })
      event.retry = true
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'afterModelCallEvent',
        error: { message: 'Model failed' },
      })
    })
  })

  describe('BeforeToolsEvent', () => {
    it('includes message and excludes agent and cancel', () => {
      const agent = new Agent()
      const message = new Message({
        role: 'assistant',
        content: [new ToolUseBlock({ name: 'calc', toolUseId: 'id-1', input: {} })],
      })
      const event = new BeforeToolsEvent({ agent, message })
      event.cancel = 'not allowed'
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'beforeToolsEvent',
        message: { role: 'assistant', content: [{ toolUse: { name: 'calc', toolUseId: 'id-1', input: {} } }] },
      })
    })
  })

  describe('AfterToolsEvent', () => {
    it('includes message and excludes agent', () => {
      const agent = new Agent()
      const message = new Message({
        role: 'user',
        content: [
          new ToolResultBlock({
            toolUseId: 'id-1',
            status: 'success',
            content: [new TextBlock('Done')],
          }),
        ],
      })
      const event = new AfterToolsEvent({ agent, message })
      const json = JSON.parse(JSON.stringify(event))

      expect(json).toStrictEqual({
        type: 'afterToolsEvent',
        message: {
          role: 'user',
          content: [{ toolResult: { toolUseId: 'id-1', status: 'success', content: [{ text: 'Done' }] } }],
        },
      })
    })
  })

  describe('agent reference is never serialized', () => {
    it('JSON.stringify output never contains agent properties', () => {
      const agent = new Agent()
      // Add messages to make agent heavy
      agent.messages.push(new Message({ role: 'user', content: [new TextBlock('Hello '.repeat(100))] }))

      const event = new ModelStreamUpdateEvent({
        agent,
        event: { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: 'Hi' } },
      })
      const json = JSON.stringify(event)

      // Should be small (no agent serialized)
      expect(json.length).toBeLessThan(200)
      expect(json).not.toContain('Hello Hello')
      expect(json).not.toContain('appState')
      expect(json).not.toContain('toolRegistry')
    })
  })
})

// ===================== Serialization completeness tests =====================
// Ensures that if a new field is added to an event class, it must either be
// included in toJSON() or explicitly added to the exclusion set.

describe('toJSON serialization completeness', () => {
  /**
   * Fields that should NEVER appear in toJSON() output.
   * If you add a new field to an event and it should be excluded from wire serialization,
   * add it here. Otherwise, add it to toJSON() so it gets serialized.
   */
  const EXCLUDED_FIELDS = new Set(['agent', 'model', 'tool', 'cancel', 'retry', '_interruptState'])

  /**
   * Fields where toJSON() transforms the value (e.g., Error to message object).
   * These appear in both instance and JSON but with different shapes.
   */
  const TRANSFORMED_FIELDS = new Set(['error'])

  // Helper: create a fully-populated instance of each event class
  function createEventInstances(): Array<{ name: string; event: { toJSON(): Record<string, unknown> } }> {
    const agent = new Agent()
    const message = new Message({ role: 'assistant', content: [new TextBlock('test')] })
    const toolUse = { name: 'test', toolUseId: 'id-1', input: {} }
    const result = new ToolResultBlock({ toolUseId: 'id-1', status: 'success', content: [new TextBlock('ok')] })
    const tool = new FunctionTool({ name: 'test', description: 'Test', inputSchema: {}, callback: () => 'ok' })
    const error = new Error('test error')
    const stopData = { message, stopReason: 'endTurn' as const }
    const streamEvent = {
      type: 'modelContentBlockDeltaEvent' as const,
      delta: { type: 'textDelta' as const, text: 'Hi' },
    }
    const contentBlock = new TextBlock('test')
    const toolStreamEvent = new ToolStreamEvent({ data: { progress: 50 } })
    const agentResult = new AgentResult({
      stopReason: 'endTurn',
      lastMessage: message,
      metrics: new AgentMetrics(),
    })

    return [
      { name: 'InitializedEvent', event: new InitializedEvent({ agent }) },
      { name: 'BeforeInvocationEvent', event: new BeforeInvocationEvent({ agent }) },
      { name: 'AfterInvocationEvent', event: new AfterInvocationEvent({ agent }) },
      { name: 'BeforeModelCallEvent', event: new BeforeModelCallEvent({ agent, model: agent.model }) },
      {
        name: 'AfterModelCallEvent',
        event: Object.assign(new AfterModelCallEvent({ agent, model: agent.model, stopData, error }), { retry: true }),
      },
      { name: 'MessageAddedEvent', event: new MessageAddedEvent({ agent, message }) },
      { name: 'ModelStreamUpdateEvent', event: new ModelStreamUpdateEvent({ agent, event: streamEvent }) },
      { name: 'ContentBlockEvent', event: new ContentBlockEvent({ agent, contentBlock }) },
      { name: 'ModelMessageEvent', event: new ModelMessageEvent({ agent, message, stopReason: 'endTurn' }) },
      { name: 'ToolResultEvent', event: new ToolResultEvent({ agent, result }) },
      { name: 'ToolStreamUpdateEvent', event: new ToolStreamUpdateEvent({ agent, event: toolStreamEvent }) },
      { name: 'AgentResultEvent', event: new AgentResultEvent({ agent, result: agentResult }) },
      { name: 'BeforeToolCallEvent', event: new BeforeToolCallEvent({ agent, toolUse, tool }) },
      {
        name: 'AfterToolCallEvent',
        event: Object.assign(new AfterToolCallEvent({ agent, toolUse, tool, result, error }), { retry: true }),
      },
      { name: 'BeforeToolsEvent', event: new BeforeToolsEvent({ agent, message }) },
      { name: 'AfterToolsEvent', event: new AfterToolsEvent({ agent, message }) },
    ]
  }

  const eventInstances = createEventInstances()

  it.each(eventInstances)('$name: toJSON() includes all fields except known exclusions', ({ event }) => {
    const instanceKeys = new Set(Object.keys(event))
    const jsonKeys = new Set(Object.keys(event.toJSON()))

    // Every instance key should either be in JSON output, in the exclusion set, or transformed
    for (const key of instanceKeys) {
      if (!jsonKeys.has(key) && !TRANSFORMED_FIELDS.has(key)) {
        expect(EXCLUDED_FIELDS).toContain(key)
      }
    }

    // Every JSON key should come from the instance or be a known transformation
    for (const key of jsonKeys) {
      expect(instanceKeys.has(key) || TRANSFORMED_FIELDS.has(key)).toBe(true)
    }
  })

  it.each(eventInstances)('$name: toJSON() never includes agent', ({ event }) => {
    const json = event.toJSON()
    expect(json).not.toHaveProperty('agent')
  })
})
