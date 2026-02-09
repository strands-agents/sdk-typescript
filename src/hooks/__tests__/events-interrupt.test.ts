import { describe, it, expect } from 'vitest'
import { BeforeToolCallEvent } from '../events.js'
import { Interrupt, InterruptException, InterruptState } from '../../interrupt.js'
import { AgentState } from '../../agent/state.js'
import { NullConversationManager } from '../../conversation-manager/null-conversation-manager.js'
import type { AgentData } from '../../types/agent.js'

function createMockAgent(): AgentData & { _interruptState: InterruptState } {
  return {
    agentId: 'test',
    state: new AgentState(),
    messages: [],
    conversationManager: new NullConversationManager(),
    _interruptState: new InterruptState(),
  }
}

describe('BeforeToolCallEvent.interrupt', () => {
  it('throws when agent has no interrupt state', () => {
    const agentWithoutState = {
      agentId: 'test',
      state: new AgentState(),
      messages: [] as never[],
      conversationManager: new NullConversationManager(),
    }
    const event = new BeforeToolCallEvent({
      agent: agentWithoutState as never,
      toolUse: { name: 'tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })

    expect(() => event.interrupt('name', 'reason')).toThrow(
      'interrupt() requires an Agent instance with interrupt state'
    )
  })

  it('throws InterruptException on first call', () => {
    const agent = createMockAgent()
    const event = new BeforeToolCallEvent({
      agent,
      toolUse: { name: 'delete_tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })

    expect(() => event.interrupt('for_delete', 'needs approval')).toThrow(InterruptException)
  })

  it('creates and stores interrupt in agent state', () => {
    const agent = createMockAgent()
    const event = new BeforeToolCallEvent({
      agent,
      toolUse: { name: 'delete_tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })

    try {
      event.interrupt('for_delete', 'needs approval')
    } catch {
      // Expected
    }

    expect(agent._interruptState.interrupts.size).toBe(1)
    const interrupt = [...agent._interruptState.interrupts.values()][0]!
    expect(interrupt).toBeInstanceOf(Interrupt)
    expect(interrupt.name).toBe('for_delete')
    expect(interrupt.reason).toBe('needs approval')
  })

  it('generates deterministic ID from toolUseId and name', () => {
    const agent = createMockAgent()
    const event = new BeforeToolCallEvent({
      agent,
      toolUse: { name: 'delete_tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })

    try {
      event.interrupt('for_delete', 'reason')
    } catch {
      // Expected
    }

    const interrupt = [...agent._interruptState.interrupts.values()][0]!
    expect(interrupt.id).toMatch(/^v1:before_tool_call:tu-1:/)
  })

  it('generates same ID for same name (deterministic)', () => {
    const agent1 = createMockAgent()
    const agent2 = createMockAgent()

    const event1 = new BeforeToolCallEvent({
      agent: agent1,
      toolUse: { name: 'tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })
    const event2 = new BeforeToolCallEvent({
      agent: agent2,
      toolUse: { name: 'tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })

    try {
      event1.interrupt('same_name')
    } catch {
      // Expected
    }
    try {
      event2.interrupt('same_name')
    } catch {
      // Expected
    }

    const id1 = [...agent1._interruptState.interrupts.values()][0]!.id
    const id2 = [...agent2._interruptState.interrupts.values()][0]!.id
    expect(id1).toBe(id2)
  })

  it('returns stored response when interrupt already has a response', () => {
    const agent = createMockAgent()
    const event = new BeforeToolCallEvent({
      agent,
      toolUse: { name: 'tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })

    // First call: creates interrupt, throws
    try {
      event.interrupt('check', 'reason')
    } catch {
      // Expected
    }

    // Set response on the interrupt (simulating resume flow)
    const interrupt = [...agent._interruptState.interrupts.values()][0]!
    interrupt.response = 'approved'

    // Second call: returns the response
    const response = event.interrupt('check', 'reason')
    expect(response).toBe('approved')
  })

  it('uses preemptive response when provided', () => {
    const agent = createMockAgent()
    const event = new BeforeToolCallEvent({
      agent,
      toolUse: { name: 'tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })

    // Provide response upfront — should return it immediately
    const response = event.interrupt('check', 'reason', 'preemptive_answer')
    expect(response).toBe('preemptive_answer')
  })

  it('generates different IDs for different names', () => {
    const agent = createMockAgent()
    const event = new BeforeToolCallEvent({
      agent,
      toolUse: { name: 'tool', toolUseId: 'tu-1', input: {} },
      tool: undefined,
    })

    try {
      event.interrupt('name_a')
    } catch {
      // Expected
    }
    try {
      event.interrupt('name_b')
    } catch {
      // Expected
    }

    const ids = [...agent._interruptState.interrupts.keys()]
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})
