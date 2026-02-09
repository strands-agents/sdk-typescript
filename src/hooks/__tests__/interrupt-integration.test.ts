import { describe, it, expect } from 'vitest'
import { HookRegistryImplementation } from '../registry.js'
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

function createToolEvent(agent: AgentData): BeforeToolCallEvent {
  return new BeforeToolCallEvent({
    agent,
    toolUse: { name: 'test_tool', toolUseId: 'tu-1', input: {} },
    tool: undefined,
  })
}

describe('HookRegistryImplementation interrupt collection', () => {
  it('returns empty interrupts when no exceptions are raised', async () => {
    const registry = new HookRegistryImplementation()
    registry.addCallback(BeforeToolCallEvent, () => {})

    const agent = createMockAgent()
    const event = createToolEvent(agent)
    const result = await registry.invokeCallbacks(event)

    expect(result.event).toBe(event)
    expect(result.interrupts).toStrictEqual([])
  })

  it('collects interrupt from a callback that throws InterruptException', async () => {
    const registry = new HookRegistryImplementation()
    const interrupt = new Interrupt({ id: 'i-1', name: 'approval' })

    registry.addCallback(BeforeToolCallEvent, () => {
      throw new InterruptException(interrupt)
    })

    const agent = createMockAgent()
    const event = createToolEvent(agent)
    const result = await registry.invokeCallbacks(event)

    expect(result.interrupts).toHaveLength(1)
    expect(result.interrupts[0]).toBe(interrupt)
  })

  it('collects interrupts from multiple callbacks', async () => {
    const registry = new HookRegistryImplementation()
    const interrupt1 = new Interrupt({ id: 'i-1', name: 'first' })
    const interrupt2 = new Interrupt({ id: 'i-2', name: 'second' })

    registry.addCallback(BeforeToolCallEvent, () => {
      throw new InterruptException(interrupt1)
    })
    registry.addCallback(BeforeToolCallEvent, () => {
      throw new InterruptException(interrupt2)
    })

    const agent = createMockAgent()
    const event = createToolEvent(agent)
    const result = await registry.invokeCallbacks(event)

    expect(result.interrupts).toHaveLength(2)
    expect(result.interrupts[0]).toBe(interrupt1)
    expect(result.interrupts[1]).toBe(interrupt2)
  })

  it('throws error when duplicate interrupt names are used', async () => {
    const registry = new HookRegistryImplementation()
    const interrupt1 = new Interrupt({ id: 'i-1', name: 'same_name' })
    const interrupt2 = new Interrupt({ id: 'i-2', name: 'same_name' })

    registry.addCallback(BeforeToolCallEvent, () => {
      throw new InterruptException(interrupt1)
    })
    registry.addCallback(BeforeToolCallEvent, () => {
      throw new InterruptException(interrupt2)
    })

    const agent = createMockAgent()
    const event = createToolEvent(agent)

    await expect(registry.invokeCallbacks(event)).rejects.toThrow(
      'interrupt_name=<same_name> | interrupt name used more than once'
    )
  })

  it('propagates non-InterruptException errors normally', async () => {
    const registry = new HookRegistryImplementation()

    registry.addCallback(BeforeToolCallEvent, () => {
      throw new Error('Some other error')
    })

    const agent = createMockAgent()
    const event = createToolEvent(agent)

    await expect(registry.invokeCallbacks(event)).rejects.toThrow('Some other error')
  })

  it('mixes normal callbacks with interrupt-raising callbacks', async () => {
    const registry = new HookRegistryImplementation()
    let normalCallbackExecuted = false
    const interrupt = new Interrupt({ id: 'i-1', name: 'check' })

    registry.addCallback(BeforeToolCallEvent, () => {
      normalCallbackExecuted = true
    })
    registry.addCallback(BeforeToolCallEvent, () => {
      throw new InterruptException(interrupt)
    })

    const agent = createMockAgent()
    const event = createToolEvent(agent)
    const result = await registry.invokeCallbacks(event)

    expect(normalCallbackExecuted).toBe(true)
    expect(result.interrupts).toHaveLength(1)
    expect(result.interrupts[0]).toBe(interrupt)
  })
})
