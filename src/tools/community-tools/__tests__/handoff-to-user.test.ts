import { Agent } from '../../../agent/agent.js'
import { Interrupt, InterruptException } from '../../../interrupt.js'
import type { JSONValue } from '../../../types/json.js'
import type { ToolContext } from '../../tool.js'
import { describe, expect, it } from 'vitest'
import { handoffToUser } from '../handoff-to-user.js'
import { getToolResultText, runToolStream } from './test-helpers.js'

function createContext(input: Record<string, unknown>, interrupt: ToolContext['interrupt']): ToolContext {
  const agent = new Agent()
  return {
    toolUse: {
      name: 'handoff_to_user',
      toolUseId: 'test-handoff',
      input: input as JSONValue,
    },
    agent,
    interrupt,
  }
}

describe('handoff_to_user tool', () => {
  it('sets stop_event_loop when breakout_of_loop is true', async () => {
    const ctx = createContext(
      {
        message: 'Task completed. Please review.',
        breakout_of_loop: true,
      },
      () => ''
    )
    const block = await runToolStream(handoffToUser, ctx)
    const text = getToolResultText(block)

    expect(text).toContain('Agent handoff completed')
    expect(ctx.agent.state.get('stop_event_loop')).toBe(true)
  })

  it('uses interrupt response when breakout_of_loop is false', async () => {
    const ctx = createContext(
      {
        message: 'Please confirm.',
        breakout_of_loop: false,
      },
      () => 'approved'
    )
    const block = await runToolStream(handoffToUser, ctx)
    const text = getToolResultText(block)

    expect(text).toContain('User response received: approved')
    expect(ctx.agent.state.get('stop_event_loop')).toBeUndefined()
  })

  it('propagates framework interrupts for human-in-the-loop flow', async () => {
    const interrupt = new Interrupt({
      id: 'interrupt-1',
      name: 'handoff_to_user',
      reason: { message: 'Need human response' },
    })
    const ctx = createContext(
      {
        message: 'Need confirmation',
      },
      () => {
        throw new InterruptException(interrupt)
      }
    )

    const block = await runToolStream(handoffToUser, ctx)
    const text = getToolResultText(block)
    expect(block.status).toBe('error')
    expect(text).toContain('Interrupt raised: handoff_to_user')
  })
})
