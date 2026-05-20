import { describe, expect, it } from 'vitest'
import type { Agent } from '../../../agent/agent.js'
import { createMockAgent, invokeTrackedHook, type MockAgent } from '../../../__fixtures__/agent-helpers.js'
import { AfterToolCallEvent, BeforeToolCallEvent } from '../../../hooks/events.js'
import { TextBlock, ToolResultBlock } from '../../../types/messages.js'
import { ToolLedgerProvider } from '../providers/tool-ledger.js'

describe('ToolLedgerProvider', () => {
  const toolUse = { name: 'searchWeb', toolUseId: 'tu-1', input: { q: 'hi' } }

  function makeBefore(agent: Agent): BeforeToolCallEvent {
    return new BeforeToolCallEvent({ agent, toolUse, tool: undefined, invocationState: {} })
  }

  function makeAfter(agent: Agent, status: 'success' | 'error' = 'success', error?: Error): AfterToolCallEvent {
    return new AfterToolCallEvent({
      agent,
      toolUse,
      tool: undefined,
      result: new ToolResultBlock({
        toolUseId: toolUse.toolUseId,
        status,
        content: [new TextBlock('result text')],
        ...(error !== undefined && { error }),
      }),
      invocationState: {},
      ...(error !== undefined && { error }),
    })
  }

  function setup(config?: { maxEntries?: number }): { agent: MockAgent; provider: ToolLedgerProvider } {
    const agent = createMockAgent()
    const provider = new ToolLedgerProvider(config)
    provider.registerHooks(agent)
    return { agent, provider }
  }

  it('records pending entry on beforeToolCall', async () => {
    const { agent, provider } = setup()

    expect(provider.context.type).toBe('toolLedger')
    expect(provider.context.calls).toEqual([])

    await invokeTrackedHook(agent, makeBefore(agent))

    const calls = provider.context.calls as Array<Record<string, unknown>>
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      id: 'tu-1',
      name: 'searchWeb',
      args: { q: 'hi' },
      status: 'pending',
    })
  })

  it('flips pending to success after afterToolCall', async () => {
    const { agent, provider } = setup()

    await invokeTrackedHook(agent, makeBefore(agent))
    await invokeTrackedHook(agent, makeAfter(agent, 'success'))

    const calls = provider.context.calls as Array<Record<string, unknown>>
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      id: 'tu-1',
      name: 'searchWeb',
      args: { q: 'hi' },
      status: 'success',
      error: null,
      endTime: expect.any(String),
    })
  })

  it('records error status and message', async () => {
    const { agent, provider } = setup()

    await invokeTrackedHook(agent, makeBefore(agent))
    await invokeTrackedHook(agent, makeAfter(agent, 'error', new Error('boom')))

    const calls = provider.context.calls as Array<Record<string, unknown>>
    expect(calls[0]?.status).toBe('error')
    expect(calls[0]?.error).toBe('boom')
  })

  it('drops oldest entries when ledger exceeds maxEntries', async () => {
    const { agent, provider } = setup({ maxEntries: 2 })

    for (const id of ['a', 'b', 'c']) {
      await invokeTrackedHook(
        agent,
        new BeforeToolCallEvent({
          agent,
          toolUse: { name: 't', toolUseId: id, input: {} },
          tool: undefined,
          invocationState: {},
        })
      )
    }

    const calls = provider.context.calls as Array<Record<string, unknown>>
    expect(calls).toHaveLength(2)
    expect(calls.map((c) => c.id)).toEqual(['b', 'c'])
  })
})
