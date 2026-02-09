import { describe, expect, it } from 'vitest'
import { Agent } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { TextBlock, ToolUseBlock, Message } from '../../types/messages.js'
import { InterruptState } from '../../interrupt.js'
import { Status } from '../base.js'
import { Swarm, SwarmNode, SharedContext, SwarmState, SwarmResult } from '../swarm.js'
import type { MultiAgentStreamEvent } from '../types.js'
import {
  MultiAgentInitializedEvent,
  BeforeMultiAgentInvocationEvent,
  AfterMultiAgentInvocationEvent,
  BeforeNodeCallEvent,
  AfterNodeCallEvent,
} from '../hook-events.js'
import type { HookProvider } from '../../hooks/types.js'
import type { HookRegistry } from '../../hooks/registry.js'

function createMockAgent(name: string): { agent: Agent; model: MockMessageModel } {
  const model = new MockMessageModel()
  model.addTurn(new TextBlock('response'))
  const agent = new Agent({ model, name, printer: false })
  return { agent, model }
}

function collectEvents(gen: AsyncGenerator<MultiAgentStreamEvent, SwarmResult>): Promise<{
  events: MultiAgentStreamEvent[]
  result: SwarmResult
}> {
  return (async () => {
    const events: MultiAgentStreamEvent[] = []
    let next = await gen.next()
    while (!next.done) {
      events.push(next.value)
      next = await gen.next()
    }
    return { events, result: next.value }
  })()
}

describe('SwarmNode', () => {
  it('captures initial state on construction', () => {
    const { agent } = createMockAgent('test')
    const node = new SwarmNode({ nodeId: 'test', executor: agent })
    expect(node.nodeId).toBe('test')
    expect(node.executor).toBe(agent)
  })

  it('resets executor state to initial state', async () => {
    const { agent } = createMockAgent('test')
    agent.messages.push(new Message({ role: 'user', content: [new TextBlock('extra')] }))

    const node = new SwarmNode({ nodeId: 'test', executor: agent })
    // Messages were captured at construction, then we mutate
    agent.messages.push(new Message({ role: 'user', content: [new TextBlock('more')] }))

    node.resetExecutorState()
    // Should be back to state at construction time (which includes 'extra')
    expect(agent.messages.length).toBe(1)
  })

  it('resets executor state from initial when swarm interrupt is activated but no context for node', () => {
    const { agent } = createMockAgent('test')
    agent.messages.push(new Message({ role: 'user', content: [new TextBlock('extra')] }))

    const interruptState = new InterruptState()
    interruptState.activate()
    const swarmLike = { _interruptState: interruptState }

    const node = new SwarmNode({
      nodeId: 'test',
      executor: agent,
      swarm: swarmLike as unknown as Swarm,
    })
    agent.messages.push(new Message({ role: 'user', content: [new TextBlock('more')] }))

    node.resetExecutorState()

    expect(agent.messages.length).toBe(1)
  })
})

describe('SharedContext', () => {
  it('adds and retrieves context', () => {
    const { agent } = createMockAgent('test')
    const node = new SwarmNode({ nodeId: 'test', executor: agent })
    const context = new SharedContext()

    context.addContext(node, 'key1', 'value1')
    expect(context.context['test']!['key1']).toBe('value1')
  })

  it('throws on empty key', () => {
    const { agent } = createMockAgent('test')
    const node = new SwarmNode({ nodeId: 'test', executor: agent })
    const context = new SharedContext()

    expect(() => context.addContext(node, '', 'value')).toThrow('non-empty string')
  })

  it('throws on non-serializable value', () => {
    const { agent } = createMockAgent('test')
    const node = new SwarmNode({ nodeId: 'test', executor: agent })
    const context = new SharedContext()

    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(() => context.addContext(node, 'key', circular)).toThrow('not JSON serializable')
  })

  it('throws on null or undefined key', () => {
    const { agent } = createMockAgent('test')
    const node = new SwarmNode({ nodeId: 'test', executor: agent })
    const context = new SharedContext()

    expect(() => context.addContext(node, null as unknown as string, 'v')).toThrow('non-empty string')
    expect(() => context.addContext(node, undefined as unknown as string, 'v')).toThrow('non-empty string')
  })

  it('throws on non-string key', () => {
    const { agent } = createMockAgent('test')
    const node = new SwarmNode({ nodeId: 'test', executor: agent })
    const context = new SharedContext()

    expect(() => context.addContext(node, 1 as unknown as string, 'v')).toThrow('non-empty string')
  })
})

describe('SwarmState', () => {
  describe('shouldContinue', () => {
    const defaultLimits = {
      maxHandoffs: 20,
      maxIterations: 20,
      executionTimeout: 900,
      repetitiveHandoffDetectionWindow: 0,
      repetitiveHandoffMinUniqueAgents: 0,
    }

    it('returns true when within limits', () => {
      const state = new SwarmState({ task: 'test' })
      const [shouldContinue] = state.shouldContinue(defaultLimits)
      expect(shouldContinue).toBe(true)
    })

    it('returns false when max handoffs reached', () => {
      const state = new SwarmState({ task: 'test' })
      const { agent } = createMockAgent('a')
      const node = new SwarmNode({ nodeId: 'a', executor: agent })
      for (let i = 0; i < 5; i++) {
        state.nodeHistory.push(node)
      }
      const [shouldContinue, reason] = state.shouldContinue({ ...defaultLimits, maxHandoffs: 5 })
      expect(shouldContinue).toBe(false)
      expect(reason).toContain('Max handoffs')
    })

    it('returns false when max iterations reached', () => {
      const state = new SwarmState({ task: 'test' })
      const { agent } = createMockAgent('a')
      const node = new SwarmNode({ nodeId: 'a', executor: agent })
      for (let i = 0; i < 3; i++) {
        state.nodeHistory.push(node)
      }
      const [shouldContinue, reason] = state.shouldContinue({ ...defaultLimits, maxIterations: 3 })
      expect(shouldContinue).toBe(false)
      expect(reason).toContain('Max iterations')
    })

    it('detects repetitive handoffs', () => {
      const state = new SwarmState({ task: 'test' })
      const { agent: agentA } = createMockAgent('a')
      const { agent: agentB } = createMockAgent('b')
      const nodeA = new SwarmNode({ nodeId: 'a', executor: agentA })
      const nodeB = new SwarmNode({ nodeId: 'b', executor: agentB })

      // Ping-pong between two agents
      for (let i = 0; i < 4; i++) {
        state.nodeHistory.push(i % 2 === 0 ? nodeA : nodeB)
      }

      const [shouldContinue, reason] = state.shouldContinue({
        ...defaultLimits,
        repetitiveHandoffDetectionWindow: 4,
        repetitiveHandoffMinUniqueAgents: 3,
      })
      expect(shouldContinue).toBe(false)
      expect(reason).toContain('Repetitive handoff')
    })
  })
})

describe('Swarm', () => {
  describe('setup and validation', () => {
    it('creates swarm with agents', () => {
      const { agent: a1 } = createMockAgent('agent1')
      const { agent: a2 } = createMockAgent('agent2')
      const swarm = new Swarm({ nodes: [a1, a2] })

      expect(Object.keys(swarm.nodes)).toHaveLength(2)
      expect(swarm.nodes['agent1']).toBeDefined()
      expect(swarm.nodes['agent2']).toBeDefined()
    })

    it('throws on duplicate agent names', () => {
      const { agent: a1 } = createMockAgent('same')
      const { agent: a2 } = createMockAgent('same')
      expect(() => new Swarm({ nodes: [a1, a2] })).toThrow('not unique')
    })

    it('throws on duplicate agent instances', () => {
      const { agent } = createMockAgent('test')
      expect(() => new Swarm({ nodes: [agent, agent] })).toThrow('Duplicate node instance')
    })

    it('throws on invalid entry point', () => {
      const { agent: a1 } = createMockAgent('agent1')
      const { agent: outsider } = createMockAgent('outsider')
      expect(() => new Swarm({ nodes: [a1], entryPoint: outsider })).toThrow('Entry point agent not found')
    })

    it('throws on tool name conflict', () => {
      const model = new MockMessageModel()
      model.addTurn(new TextBlock('response'))
      const agent = new Agent({
        model,
        name: 'test',
        printer: false,
        tools: [
          {
            name: 'handoff_to_agent',
            description: 'conflict',
            toolSpec: { name: 'handoff_to_agent', description: 'conflict', inputSchema: { type: 'object' } },
            // eslint-disable-next-line require-yield
            async *stream() {
              return new (await import('../../types/messages.js')).ToolResultBlock({
                toolUseId: 'test',
                status: 'success',
                content: [],
              })
            },
          },
        ],
      })
      expect(() => new Swarm({ nodes: [agent] })).toThrow('conflicts with swarm coordination tools')
    })
  })

  describe('execution', () => {
    it('completes without handoff', async () => {
      const { agent } = createMockAgent('agent1')
      const swarm = new Swarm({ nodes: [agent] })

      const { events, result } = await collectEvents(swarm.stream('do something'))

      expect(result.status).toBe(Status.COMPLETED)
      expect(result.nodeHistory).toHaveLength(1)
      expect(result.nodeHistory[0]!.nodeId).toBe('agent1')

      const startEvents = events.filter((e) => e.type === 'multiAgentNodeStartEvent')
      expect(startEvents).toHaveLength(1)

      const stopEvents = events.filter((e) => e.type === 'multiAgentNodeStopEvent')
      expect(stopEvents).toHaveLength(1)

      const resultEvents = events.filter((e) => e.type === 'multiAgentResultEvent')
      expect(resultEvents).toHaveLength(1)
    })

    it('uses custom entry point', async () => {
      const { agent: a1, model: m1 } = createMockAgent('first')
      const { agent: a2 } = createMockAgent('second')

      // Only second should execute, first should not
      m1.addTurn(new Error('should not execute'))

      const swarm = new Swarm({ nodes: [a1, a2], entryPoint: a2 })
      const { result } = await collectEvents(swarm.stream('task'))

      expect(result.status).toBe(Status.COMPLETED)
      expect(result.nodeHistory).toHaveLength(1)
      expect(result.nodeHistory[0]!.nodeId).toBe('second')
    })

    it('handles agent handoff via tool', async () => {
      // Build researcher model from scratch — first turn is the tool call
      const m1 = new MockMessageModel()
      m1.addTurn(
        new ToolUseBlock({
          name: 'handoff_to_agent',
          toolUseId: 'tu-1',
          input: { agent_name: 'writer', message: 'Please write' },
        })
      )
      m1.addTurn(new TextBlock('handing off'))

      const a1 = new Agent({ model: m1, name: 'researcher', printer: false })
      const { agent: a2 } = createMockAgent('writer')

      const swarm = new Swarm({ nodes: [a1, a2] })
      const { events, result } = await collectEvents(swarm.stream('write a blog'))

      expect(result.status).toBe(Status.COMPLETED)
      expect(result.nodeHistory).toHaveLength(2)

      const handoffEvents = events.filter((e) => e.type === 'multiAgentHandoffEvent')
      expect(handoffEvents).toHaveLength(1)
    })

    it('emits stream events for each node', async () => {
      const { agent } = createMockAgent('agent1')
      const swarm = new Swarm({ nodes: [agent] })

      const { events } = await collectEvents(swarm.stream('task'))

      const streamEvents = events.filter((e) => e.type === 'multiAgentNodeStreamEvent')
      expect(streamEvents.length).toBeGreaterThan(0)

      const inputEvents = events.filter((e) => e.type === 'multiAgentNodeInputEvent')
      expect(inputEvents).toHaveLength(1)
      expect(inputEvents[0]!.nodeId).toBe('agent1')
      expect(inputEvents[0]!.input).toBeDefined()
    })

    it('accumulates metrics across nodes', async () => {
      const { agent } = createMockAgent('agent1')
      const swarm = new Swarm({ nodes: [agent] })

      const { result } = await collectEvents(swarm.stream('task'))

      expect(result.accumulatedUsage).toBeDefined()
      expect(result.accumulatedMetrics).toBeDefined()
    })

    it('each agent stream is invoked at most once per run when no handoff', async () => {
      const { agent: a1, model: m1 } = createMockAgent('a1')
      const { agent: a2, model: m2 } = createMockAgent('a2')
      m1.addTurn(new TextBlock('extra'))
      m2.addTurn(new TextBlock('extra'))
      const swarm = new Swarm({ nodes: [a1, a2] })
      await collectEvents(swarm.stream('task'))
      expect(m1.callCount).toBe(1)
      expect(m2.callCount).toBe(0)
    })

    it('accumulates without throwing when agent returns missing or partial metrics', async () => {
      const model = new MockMessageModel()
      model.addTurn(new TextBlock('ok'))
      const agent = new Agent({ model, name: 'minimal', printer: false })
      const swarm = new Swarm({ nodes: [agent] })
      const { result } = await collectEvents(swarm.stream('task'))
      expect(result.status).toBe(Status.COMPLETED)
      expect(result.accumulatedUsage).toBeDefined()
      expect(result.accumulatedMetrics).toBeDefined()
    })
  })

  describe('invoke', () => {
    it('returns SwarmResult from invoke', async () => {
      const { agent } = createMockAgent('agent1')
      const swarm = new Swarm({ nodes: [agent] })

      const result = await swarm.invoke('do something')
      expect(result.status).toBe(Status.COMPLETED)
      expect(result).toBeInstanceOf(SwarmResult)
    })
  })

  describe('limits', () => {
    it('fails when max iterations exceeded', async () => {
      // Build models from scratch — each agent always hands off to the other
      const m1 = new MockMessageModel()
      const m2 = new MockMessageModel()

      for (let i = 0; i < 5; i++) {
        m1.addTurn(
          new ToolUseBlock({
            name: 'handoff_to_agent',
            toolUseId: `tu-${i}a`,
            input: { agent_name: 'a2', message: 'handoff' },
          })
        )
        m1.addTurn(new TextBlock('done'))
        m2.addTurn(
          new ToolUseBlock({
            name: 'handoff_to_agent',
            toolUseId: `tu-${i}b`,
            input: { agent_name: 'a1', message: 'handoff' },
          })
        )
        m2.addTurn(new TextBlock('done'))
      }

      const a1 = new Agent({ model: m1, name: 'a1', printer: false })
      const a2 = new Agent({ model: m2, name: 'a2', printer: false })

      const swarm = new Swarm({ nodes: [a1, a2], maxIterations: 3 })
      const { result } = await collectEvents(swarm.stream('task'))
      expect(result.status).toBe(Status.FAILED)
    })
  })

  describe('MultiAgentInitializedEvent', () => {
    it('fires MultiAgentInitializedEvent on first stream call', async () => {
      const { agent } = createMockAgent('agent1')
      const callbackNames: string[] = []

      const hookProvider: HookProvider = {
        registerCallbacks(registry: HookRegistry): void {
          registry.addCallback(MultiAgentInitializedEvent, () => {
            callbackNames.push('multi_agent_initialized_event')
          })
        },
      }

      const swarm = new Swarm({ nodes: [agent], hooks: [hookProvider] })
      await collectEvents(swarm.stream('task'))

      expect(callbackNames).toContain('multi_agent_initialized_event')
    })

    it('fires MultiAgentInitializedEvent only once across multiple stream calls', async () => {
      const { agent } = createMockAgent('agent1')
      let initCount = 0

      const hookProvider: HookProvider = {
        registerCallbacks(registry: HookRegistry): void {
          registry.addCallback(MultiAgentInitializedEvent, () => {
            initCount++
          })
        },
      }

      const swarm = new Swarm({ nodes: [agent], hooks: [hookProvider] })
      await collectEvents(swarm.stream('task1'))

      // Need a fresh model turn for second invocation
      ;(agent.model as MockMessageModel).addTurn(new TextBlock('response2'))
      await collectEvents(swarm.stream('task2'))

      expect(initCount).toBe(1)
    })

    it('fires events in correct lifecycle order', async () => {
      const { agent } = createMockAgent('agent1')
      const eventNames: string[] = []

      const hookProvider: HookProvider = {
        registerCallbacks(registry: HookRegistry): void {
          registry.addCallback(MultiAgentInitializedEvent, () => {
            eventNames.push('MultiAgentInitializedEvent')
          })
          registry.addCallback(BeforeMultiAgentInvocationEvent, () => {
            eventNames.push('BeforeMultiAgentInvocationEvent')
          })
          registry.addCallback(BeforeNodeCallEvent, () => {
            eventNames.push('BeforeNodeCallEvent')
          })
          registry.addCallback(AfterNodeCallEvent, () => {
            eventNames.push('AfterNodeCallEvent')
          })
          registry.addCallback(AfterMultiAgentInvocationEvent, () => {
            eventNames.push('AfterMultiAgentInvocationEvent')
          })
        },
      }

      const swarm = new Swarm({ nodes: [agent], hooks: [hookProvider] })
      await collectEvents(swarm.stream('task'))

      expect(eventNames).toStrictEqual([
        'MultiAgentInitializedEvent',
        'BeforeMultiAgentInvocationEvent',
        'BeforeNodeCallEvent',
        'AfterNodeCallEvent',
        'AfterMultiAgentInvocationEvent',
      ])
    })
  })

  describe('hooks', () => {
    it('invokes BeforeNodeCallEvent and AfterNodeCallEvent', async () => {
      const { agent } = createMockAgent('agent1')
      const beforeCalls: string[] = []
      const afterCalls: string[] = []

      const hookProvider: HookProvider = {
        registerCallbacks(registry: HookRegistry): void {
          registry.addCallback(BeforeNodeCallEvent, (event) => {
            beforeCalls.push(event.nodeId)
          })
          registry.addCallback(AfterNodeCallEvent, (event) => {
            afterCalls.push(event.nodeId)
          })
        },
      }

      const swarm = new Swarm({ nodes: [agent], hooks: [hookProvider] })
      await collectEvents(swarm.stream('task'))

      expect(beforeCalls).toStrictEqual(['agent1'])
      expect(afterCalls).toStrictEqual(['agent1'])
    })

    it('supports node cancellation via hook', async () => {
      const { agent } = createMockAgent('agent1')

      const hookProvider: HookProvider = {
        registerCallbacks(registry: HookRegistry): void {
          registry.addCallback(BeforeNodeCallEvent, (event) => {
            event.cancelNode = 'cancelled for testing'
          })
        },
      }

      const swarm = new Swarm({ nodes: [agent], hooks: [hookProvider] })
      const { events, result } = await collectEvents(swarm.stream('task'))

      expect(result.status).toBe(Status.FAILED)
      const cancelEvents = events.filter((e) => e.type === 'multiAgentNodeCancelEvent')
      expect(cancelEvents).toHaveLength(1)
    })

    it('supports interrupt from BeforeNodeCallEvent hook', async () => {
      const { agent } = createMockAgent('agent1')

      const hookProvider: HookProvider = {
        registerCallbacks(registry: HookRegistry): void {
          registry.addCallback(BeforeNodeCallEvent, (event) => {
            event.interrupt('approval', 'needs review')
          })
        },
      }

      const swarm = new Swarm({ nodes: [agent], hooks: [hookProvider] })
      const { events, result } = await collectEvents(swarm.stream('task'))

      expect(result.status).toBe(Status.INTERRUPTED)
      const interruptEvents = events.filter((e) => e.type === 'multiAgentNodeInterruptEvent')
      expect(interruptEvents).toHaveLength(1)
      expect(result.interrupts).toHaveLength(1)
    })

    it('passes invocationState to Before/AfterMultiAgentInvocation and Before/AfterNodeCall', async () => {
      const { agent } = createMockAgent('agent1')
      const invocationState = { requestId: 'r1', traceId: 't1' }
      const seenBeforeInv: Record<string, unknown>[] = []
      const seenAfterInv: Record<string, unknown>[] = []
      const seenBeforeNode: Record<string, unknown>[] = []
      const seenAfterNode: Record<string, unknown>[] = []

      const hookProvider: HookProvider = {
        registerCallbacks(registry: HookRegistry): void {
          registry.addCallback(BeforeMultiAgentInvocationEvent, (e) => {
            seenBeforeInv.push(e.invocationState ?? { __none: true })
          })
          registry.addCallback(AfterMultiAgentInvocationEvent, (e) => {
            seenAfterInv.push(e.invocationState ?? { __none: true })
          })
          registry.addCallback(BeforeNodeCallEvent, (e) => {
            seenBeforeNode.push(e.invocationState ?? { __none: true })
          })
          registry.addCallback(AfterNodeCallEvent, (e) => {
            seenAfterNode.push(e.invocationState ?? { __none: true })
          })
        },
      }

      const swarm = new Swarm({ nodes: [agent], hooks: [hookProvider] })
      await collectEvents(swarm.stream('task', { invocationState }))

      expect(seenBeforeInv).toHaveLength(1)
      expect(seenBeforeInv[0]).toStrictEqual(invocationState)
      expect(seenAfterInv).toHaveLength(1)
      expect(seenAfterInv[0]).toStrictEqual(invocationState)
      expect(seenBeforeNode).toHaveLength(1)
      expect(seenBeforeNode[0]).toStrictEqual(invocationState)
      expect(seenAfterNode).toHaveLength(1)
      expect(seenAfterNode[0]).toStrictEqual(invocationState)
    })
  })

  describe('handoff', () => {
    it('handoff_to_agent with nonexistent agent returns error and does not crash', async () => {
      const model = new MockMessageModel()
      model
        .addTurn(
          new ToolUseBlock({
            name: 'handoff_to_agent',
            toolUseId: 'tu-1',
            input: { agent_name: 'nonexistent', message: 'please help' },
          })
        )
        .addTurn(new TextBlock('done'))
      const agent = new Agent({ model, name: 'a1', printer: false })
      const swarm = new Swarm({ nodes: [agent] })
      const { result } = await collectEvents(swarm.stream('task'))
      expect(result.status).toBe(Status.COMPLETED)
      expect(result.nodeHistory).toHaveLength(1)
      const hasToolResultWithError = agent.messages.some((m) =>
        m.content.some((c) => {
          if (c.type !== 'toolResultBlock') return false
          const tr = c as { content: { text?: string; json?: unknown }[] }
          const text = tr.content?.map((t) => ('text' in t ? String(t.text) : JSON.stringify(t))).join(' ')
          return text.includes('not found in swarm')
        })
      )
      expect(hasToolResultWithError).toBe(true)
    })
  })

  describe('serialization', () => {
    it('serializes and deserializes state', async () => {
      const { agent } = createMockAgent('agent1')
      const swarm = new Swarm({ nodes: [agent] })

      await collectEvents(swarm.stream('test task'))

      const serialized = swarm.serializeState()
      expect(serialized['type']).toBe('swarm')
      expect(serialized['id']).toBe('default_swarm')
      expect(serialized['status']).toBe(Status.COMPLETED)
    })
  })
})
