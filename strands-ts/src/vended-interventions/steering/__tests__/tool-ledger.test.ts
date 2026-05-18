import { describe, expect, it } from 'vitest'
import { Agent } from '../../../agent/agent.js'
import { AfterInvocationEvent, AfterToolCallEvent, BeforeToolCallEvent } from '../../../hooks/events.js'
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

  it('records pending entry on BeforeToolCall', async () => {
    const agent = new Agent()
    const provider = new ToolLedgerProvider()
    provider.initAgent(agent)

    expect(provider.context.type).toBe('toolLedger')
    expect(provider.context.calls).toEqual([])

    await agent['_hooksRegistry'].invokeCallbacks(makeBefore(agent))

    const calls = provider.context.calls as Array<Record<string, unknown>>
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      id: 'tu-1',
      name: 'searchWeb',
      args: { q: 'hi' },
      status: 'pending',
    })
  })

  it('flips pending to success after AfterToolCall', async () => {
    const agent = new Agent()
    const provider = new ToolLedgerProvider()
    provider.initAgent(agent)

    await agent['_hooksRegistry'].invokeCallbacks(makeBefore(agent))
    await agent['_hooksRegistry'].invokeCallbacks(makeAfter(agent, 'success'))

    const calls = provider.context.calls as Array<Record<string, unknown>>
    expect(calls).toHaveLength(1)
    expect(calls[0]?.status).toBe('success')
    expect(calls[0]?.error).toBeNull()
    expect(calls[0]?.endTime).toBeTypeOf('string')
  })

  it('records error status and message', async () => {
    const agent = new Agent()
    const provider = new ToolLedgerProvider()
    provider.initAgent(agent)

    await agent['_hooksRegistry'].invokeCallbacks(makeBefore(agent))
    await agent['_hooksRegistry'].invokeCallbacks(makeAfter(agent, 'error', new Error('boom')))

    const calls = provider.context.calls as Array<Record<string, unknown>>
    expect(calls[0]?.status).toBe('error')
    expect(calls[0]?.error).toBe('boom')
  })

  it('persists ledger to appState on AfterInvocation', async () => {
    const agent = new Agent()
    const provider = new ToolLedgerProvider()
    provider.initAgent(agent)

    await agent['_hooksRegistry'].invokeCallbacks(makeBefore(agent))
    await agent['_hooksRegistry'].invokeCallbacks(new AfterInvocationEvent({ agent, invocationState: {} }))

    const saved = agent.appState.get('strands:steering:toolLedger')
    expect(Array.isArray(saved)).toBe(true)
    expect((saved as unknown[]).length).toBe(1)
  })

  it('rehydrates from appState on initAgent', () => {
    const agent = new Agent()
    agent.appState.set('strands:steering:toolLedger', [
      { id: 'old-1', name: 'oldTool', args: {}, startTime: '2026-01-01T00:00:00Z', status: 'success' },
    ])

    const provider = new ToolLedgerProvider()
    provider.initAgent(agent)

    const calls = provider.context.calls as Array<Record<string, unknown>>
    expect(calls).toHaveLength(1)
    expect(calls[0]?.id).toBe('old-1')
  })

  it('throws when attached to a second agent', () => {
    const provider = new ToolLedgerProvider()
    const agentA = new Agent()
    const agentB = new Agent()

    provider.initAgent(agentA)
    expect(() => provider.initAgent(agentB)).toThrow(/already attached to a different Agent/)
    expect(() => provider.initAgent(agentA)).not.toThrow()
  })

  it('uses a custom name as the appState key when provided', async () => {
    const agent = new Agent()
    const provider = new ToolLedgerProvider({ name: 'my:ledger' })
    provider.initAgent(agent)

    await agent['_hooksRegistry'].invokeCallbacks(makeBefore(agent))
    await agent['_hooksRegistry'].invokeCallbacks(new AfterInvocationEvent({ agent, invocationState: {} }))

    expect(agent.appState.get('my:ledger')).toBeDefined()
    expect(agent.appState.get('strands:steering:toolLedger')).toBeUndefined()
  })

  it('drops oldest entries when ledger exceeds maxEntries', async () => {
    const agent = new Agent()
    const provider = new ToolLedgerProvider({ maxEntries: 2 })
    provider.initAgent(agent)

    for (const id of ['a', 'b', 'c']) {
      await agent['_hooksRegistry'].invokeCallbacks(
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
