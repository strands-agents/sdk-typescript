import { describe, expect, it, vi } from 'vitest'
import { Agent } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { TextBlock } from '../../types/messages.js'
import { createHandoffTool } from '../handoff-tool.js'

function makeAgent(id: string): Agent {
  const model = new MockMessageModel().addTurn(new TextBlock('hi'))
  return new Agent({ model, printer: false, agentId: id })
}

describe('createHandoffTool', () => {
  it('calls onHandoff with target agent and reason', async () => {
    const onHandoff = vi.fn()
    const agents = new Map([
      ['a', makeAgent('a')],
      ['b', makeAgent('b')],
    ])
    const handoff = createHandoffTool({ agents, onHandoff })

    const result = await handoff.invoke({ agent_name: 'b', reason: 'needs writing' })

    expect(onHandoff).toHaveBeenCalledWith({ targetAgent: 'b', reason: 'needs writing' })
    expect(result).toEqual({ status: 'success', message: 'Handing off to b: needs writing' })
  })

  it('passes context when provided', async () => {
    const onHandoff = vi.fn()
    const agents = new Map([['a', makeAgent('a')]])
    const handoff = createHandoffTool({ agents, onHandoff })

    await handoff.invoke({ agent_name: 'a', reason: 'test', context: { key: 'val' } })

    expect(onHandoff).toHaveBeenCalledWith({
      targetAgent: 'a',
      reason: 'test',
      context: { key: 'val' },
    })
  })

  it('returns error for unknown agent', async () => {
    const onHandoff = vi.fn()
    const agents = new Map([['a', makeAgent('a')]])
    const handoff = createHandoffTool({ agents, onHandoff })

    const result = await handoff.invoke({ agent_name: 'missing', reason: 'test' })

    expect(onHandoff).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 'error',
      message: "Agent 'missing' not found. Available: a",
    })
  })
})
