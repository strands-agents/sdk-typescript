import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerBeforeToolCall, LedgerAfterToolCall, LedgerProvider } from '../ledger-provider.js'
import { SteeringContext } from '../../core/context.js'
import { BeforeToolCallEvent, AfterToolCallEvent } from '../../../../hooks/events.js'
import { TextBlock, ToolResultBlock } from '../../../../types/messages.js'
import type { AgentData } from '../../../../types/agent.js'
import { AgentState } from '../../../../agent/state.js'
import { NullConversationManager } from '../../../../conversation-manager/null-conversation-manager.js'
import type { JSONValue } from '../../../../types/json.js'

function createMockAgent(): AgentData {
  return {
    agentId: 'test-agent',
    state: new AgentState(),
    messages: [],
    conversationManager: new NullConversationManager(),
  }
}

interface LedgerData {
  session_start: string
  tool_calls: Array<{
    tool_use_id: string
    tool_name: string
    tool_args: JSONValue
    status: string
    timestamp: string
    completion_timestamp?: string
    result?: JSONValue
    error?: string | null
  }>
  conversation_history: JSONValue[]
  session_metadata: Record<string, JSONValue>
}

describe('LedgerBeforeToolCall', () => {
  let callback: LedgerBeforeToolCall
  let context: SteeringContext

  beforeEach(() => {
    callback = new LedgerBeforeToolCall()
    context = new SteeringContext()
  })

  it('creates initial ledger on first tool call', () => {
    const event = new BeforeToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'test_tool', toolUseId: 'tu-1', input: { key: 'value' } },
      tool: undefined,
    })

    callback.update(event, context)

    const ledger = context.get('ledger') as unknown as LedgerData
    expect(ledger).toBeDefined()
    expect(ledger.session_start).toBeDefined()
    expect(ledger.tool_calls).toHaveLength(1)
    expect(ledger.tool_calls[0]!.tool_name).toBe('test_tool')
    expect(ledger.tool_calls[0]!.tool_use_id).toBe('tu-1')
    expect(ledger.tool_calls[0]!.status).toBe('pending')
    expect(ledger.tool_calls[0]!.tool_args).toStrictEqual({ key: 'value' })
  })

  it('appends to existing ledger on subsequent tool calls', () => {
    const event1 = new BeforeToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'tool_a', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })
    const event2 = new BeforeToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'tool_b', toolUseId: 'tu-2', input: {} },
      tool: undefined,
    })

    callback.update(event1, context)
    callback.update(event2, context)

    const ledger = context.get('ledger') as unknown as LedgerData
    expect(ledger.tool_calls).toHaveLength(2)
    expect(ledger.tool_calls[0]!.tool_name).toBe('tool_a')
    expect(ledger.tool_calls[1]!.tool_name).toBe('tool_b')
  })
})

describe('LedgerAfterToolCall', () => {
  let beforeCallback: LedgerBeforeToolCall
  let afterCallback: LedgerAfterToolCall
  let context: SteeringContext

  beforeEach(() => {
    beforeCallback = new LedgerBeforeToolCall()
    afterCallback = new LedgerAfterToolCall()
    context = new SteeringContext()
  })

  it('updates pending tool call with success status', () => {
    // Record the before event
    const beforeEvent = new BeforeToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'test_tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })
    beforeCallback.update(beforeEvent, context)

    // Record the after event
    const afterEvent = new AfterToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'test_tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
      result: new ToolResultBlock({
        toolUseId: 'tu-1',
        status: 'success',
        content: [new TextBlock('result data')],
      }),
    })
    afterCallback.update(afterEvent, context)

    const ledger = context.get('ledger') as unknown as LedgerData
    expect(ledger.tool_calls[0]!.status).toBe('success')
    expect(ledger.tool_calls[0]!.completion_timestamp).toBeDefined()
    expect(ledger.tool_calls[0]!.error).toBeNull()
  })

  it('updates pending tool call with error status', () => {
    const beforeEvent = new BeforeToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'test_tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })
    beforeCallback.update(beforeEvent, context)

    const afterEvent = new AfterToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'test_tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
      result: new ToolResultBlock({
        toolUseId: 'tu-1',
        status: 'error',
        content: [new TextBlock('something went wrong')],
      }),
      error: new Error('tool crashed'),
    })
    afterCallback.update(afterEvent, context)

    const ledger = context.get('ledger') as unknown as LedgerData
    expect(ledger.tool_calls[0]!.status).toBe('error')
    expect(ledger.tool_calls[0]!.error).toBe('Error: tool crashed')
  })

  it('handles parallel tool calls matching by toolUseId', () => {
    // Two tools started
    const before1 = new BeforeToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'tool_a', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })
    const before2 = new BeforeToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'tool_b', toolUseId: 'tu-2', input: {} },
      tool: undefined,
    })
    beforeCallback.update(before1, context)
    beforeCallback.update(before2, context)

    // Second tool completes first
    const after2 = new AfterToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'tool_b', toolUseId: 'tu-2', input: {} },
      tool: undefined,
      result: new ToolResultBlock({
        toolUseId: 'tu-2',
        status: 'success',
        content: [new TextBlock('done')],
      }),
    })
    afterCallback.update(after2, context)

    const ledger = context.get('ledger') as unknown as LedgerData
    // First tool still pending, second completed
    expect(ledger.tool_calls[0]!.status).toBe('pending')
    expect(ledger.tool_calls[1]!.status).toBe('success')
  })

  it('does nothing when ledger has no data', () => {
    const afterEvent = new AfterToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'test_tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
      result: new ToolResultBlock({
        toolUseId: 'tu-1',
        status: 'success',
        content: [new TextBlock('done')],
      }),
    })

    // Should not throw
    afterCallback.update(afterEvent, context)
    expect(context.get('ledger')).toBeUndefined()
  })

  it('does not update when toolUseId does not match any pending call', () => {
    // Add a pending tool call
    const beforeEvent = new BeforeToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'tool_a', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })
    beforeCallback.update(beforeEvent, context)

    // Try to complete a different toolUseId that does not exist
    const afterEvent = new AfterToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'unknown', toolUseId: 'tu-999', input: {} },
      tool: undefined,
      result: new ToolResultBlock({
        toolUseId: 'tu-999',
        status: 'success',
        content: [new TextBlock('result')],
      }),
    })
    afterCallback.update(afterEvent, context)

    // Original tool should still be pending
    const ledger = context.get('ledger') as unknown as LedgerData
    expect(ledger.tool_calls[0]!.status).toBe('pending')
    expect(ledger.tool_calls[0]!.completion_timestamp).toBeUndefined()
  })

  it('handles all parallel tool calls completing in reverse order', () => {
    // Add three pending tool calls
    for (let i = 0; i < 3; i++) {
      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: { name: `tool_${i}`, toolUseId: `tu-${i}`, input: {} },
        tool: undefined,
      })
      beforeCallback.update(event, context)
    }

    // Complete in reverse order: 2, 1, 0
    for (const i of [2, 1, 0]) {
      const event = new AfterToolCallEvent({
        agent: createMockAgent(),
        toolUse: { name: `tool_${i}`, toolUseId: `tu-${i}`, input: {} },
        tool: undefined,
        result: new ToolResultBlock({
          toolUseId: `tu-${i}`,
          status: 'success',
          content: [new TextBlock(`result_${i}`)],
        }),
      })
      afterCallback.update(event, context)
    }

    const ledger = context.get('ledger') as unknown as LedgerData
    expect(ledger.tool_calls.every((call) => call.status === 'success')).toBe(true)
  })

  it('handles mixed success and failure in parallel tool calls', () => {
    // Add two pending tool calls
    for (let i = 0; i < 2; i++) {
      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: { name: `tool_${i}`, toolUseId: `tu-${i}`, input: {} },
        tool: undefined,
      })
      beforeCallback.update(event, context)
    }

    // First succeeds
    const successEvent = new AfterToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'tool_0', toolUseId: 'tu-0', input: {} },
      tool: undefined,
      result: new ToolResultBlock({
        toolUseId: 'tu-0',
        status: 'success',
        content: [new TextBlock('ok')],
      }),
    })
    afterCallback.update(successEvent, context)

    // Second fails
    const failEvent = new AfterToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'tool_1', toolUseId: 'tu-1', input: {} },
      tool: undefined,
      result: new ToolResultBlock({
        toolUseId: 'tu-1',
        status: 'error',
        content: [new TextBlock('failed')],
      }),
      error: new Error('test error'),
    })
    afterCallback.update(failEvent, context)

    const ledger = context.get('ledger') as unknown as LedgerData
    expect(ledger.tool_calls[0]!.status).toBe('success')
    expect(ledger.tool_calls[0]!.error).toBeNull()
    expect(ledger.tool_calls[1]!.status).toBe('error')
    expect(ledger.tool_calls[1]!.error).toBe('Error: test error')
  })

  it('stores toolUseId in ledger entries', () => {
    const event = new BeforeToolCallEvent({
      agent: createMockAgent(),
      toolUse: { name: 'test_tool', toolUseId: 'test-id-123', input: {} },
      tool: undefined,
    })
    beforeCallback.update(event, context)

    const ledger = context.get('ledger') as unknown as LedgerData
    expect(ledger.tool_calls[0]!.tool_use_id).toBe('test-id-123')
  })

  it('tracks three parallel tool calls all as pending', () => {
    for (const name of ['tool_a', 'tool_b', 'tool_c']) {
      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: { name, toolUseId: `tu-${name}`, input: {} },
        tool: undefined,
      })
      beforeCallback.update(event, context)
    }

    const ledger = context.get('ledger') as unknown as LedgerData
    expect(ledger.tool_calls).toHaveLength(3)
    expect(ledger.tool_calls.every((call) => call.status === 'pending')).toBe(true)
    expect(ledger.tool_calls.map((call) => call.tool_name)).toStrictEqual(['tool_a', 'tool_b', 'tool_c'])
  })
})

describe('LedgerProvider', () => {
  it('provides both before and after tool call callbacks', () => {
    const provider = new LedgerProvider()
    const callbacks = provider.contextProviders()

    expect(callbacks).toHaveLength(2)
    expect(callbacks[0]).toBeInstanceOf(LedgerBeforeToolCall)
    expect(callbacks[1]).toBeInstanceOf(LedgerAfterToolCall)
  })
})
