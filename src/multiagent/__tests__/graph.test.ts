import { describe, expect, it } from 'vitest'
import { Agent } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { Message, TextBlock } from '../../types/messages.js'
import { InterruptState } from '../../interrupt.js'
import { Status } from '../base.js'
import { GraphBuilder, GraphNode, GraphState, GraphResult, type GraphExecutor } from '../graph.js'
import type { MultiAgentStreamEvent } from '../types.js'
import { Swarm } from '../swarm.js'

class DelayingMockModel extends MockMessageModel {
  constructor(private readonly _delayMs: number) {
    super()
  }

  override async *stream(
    messages: Parameters<MockMessageModel['stream']>[0],
    options?: Parameters<MockMessageModel['stream']>[1]
  ): AsyncGenerator<import('../../models/streaming.js').ModelStreamEvent> {
    await new Promise((r) => globalThis.setTimeout(r, this._delayMs))
    yield* super.stream(messages, options)
  }
}
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

function collectEvents(gen: AsyncGenerator<MultiAgentStreamEvent, GraphResult>): Promise<{
  events: MultiAgentStreamEvent[]
  result: GraphResult
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

describe('GraphNode', () => {
  it('captures initial state on construction', () => {
    const { agent } = createMockAgent('a')
    const builder = new GraphBuilder()
    const node = builder.addNode(agent, 'a')
    expect(node.nodeId).toBe('a')
    expect(node.executor).toBe(agent)
    expect(node.dependencies.size).toBe(0)
    expect(node.executionStatus).toBe(Status.PENDING)
    expect(node.result).toBeNull()
  })

  it('resets executor state when graph is not in interrupt state', () => {
    const { agent } = createMockAgent('a')
    const builder = new GraphBuilder()
    const node = builder.addNode(agent, 'a')
    ;(agent as unknown as { messages: unknown[] }).messages = [
      { role: 'user', content: [{ type: 'textBlock', text: 'extra' }] },
    ]
    builder.build()
    node.resetExecutorState()
    expect(agent.messages.length).toBe(0)
  })

  it('resets executor state from initial when graph interrupt is activated but no context for node', () => {
    const { agent } = createMockAgent('a')
    const builder = new GraphBuilder()
    const node = builder.addNode(agent, 'a')
    const graph = builder.build()
    const interruptState = new InterruptState()
    interruptState.activate()
    ;(graph as unknown as { _interruptState: InterruptState })._interruptState = interruptState
    agent.messages.push(new Message({ role: 'user', content: [new TextBlock('extra')] }))
    node.resetExecutorState()
    expect(agent.messages.length).toBe(0)
  })

  it('uses empty initial state when executor is MultiAgentBase (not Agent)', () => {
    const { agent: inner } = createMockAgent('inner')
    const swarm = new Swarm({ nodes: [inner] })
    const builder = new GraphBuilder()
    const node = builder.addNode(swarm, 'nested')
    expect(node.executor).toBe(swarm)
    expect((node as unknown as { _initialMessages: unknown[] })._initialMessages).toStrictEqual([])
    builder.build()
    node.resetExecutorState()
    expect(node.executionStatus).toBe(Status.PENDING)
    expect(node.result).toBeNull()
  })
})

describe('GraphEdge', () => {
  it('shouldTraverse returns true when no condition', () => {
    const { agent: a1 } = createMockAgent('a1')
    const { agent: a2 } = createMockAgent('a2')
    const builder = new GraphBuilder()
    builder.addNode(a1, 'a1')
    builder.addNode(a2, 'a2')
    const edge = builder.addEdge('a1', 'a2')
    const state = new GraphState()
    expect(edge.shouldTraverse(state)).toBe(true)
  })

  it('shouldTraverse uses condition when provided', () => {
    const { agent: a1 } = createMockAgent('a1')
    const { agent: a2 } = createMockAgent('a2')
    const builder = new GraphBuilder()
    builder.addNode(a1, 'a1')
    builder.addNode(a2, 'a2')
    const edge = builder.addEdge('a1', 'a2', (s) => s.executionOrder.length > 0)
    const state = new GraphState()
    expect(edge.shouldTraverse(state)).toBe(false)
    state.executionOrder.push(edge.fromNode)
    expect(edge.shouldTraverse(state)).toBe(true)
  })
})

describe('GraphState', () => {
  describe('shouldContinue', () => {
    it('returns true when within limits', () => {
      const state = new GraphState()
      const [ok] = state.shouldContinue(undefined, undefined)
      expect(ok).toBe(true)
    })

    it('returns false when max node executions reached', () => {
      const state = new GraphState()
      state.executionOrder = [{} as GraphNode, {} as GraphNode, {} as GraphNode]
      const [ok, reason] = state.shouldContinue(3, undefined)
      expect(ok).toBe(false)
      expect(reason).toContain('Max node executions')
    })

    it('returns false when execution timeout exceeded', () => {
      const state = new GraphState()
      state.startTime = Date.now() / 1000 - 100
      state.executionTime = 50000
      const [ok, reason] = state.shouldContinue(undefined, 10)
      expect(ok).toBe(false)
      expect(reason).toContain('Execution timed out')
    })
  })
})

describe('GraphBuilder', () => {
  it('adds nodes and builds graph', () => {
    const { agent: a1 } = createMockAgent('a1')
    const { agent: a2 } = createMockAgent('a2')
    const builder = new GraphBuilder()
    const n1 = builder.addNode(a1, 'first')
    const n2 = builder.addNode(a2, 'second')
    builder.addEdge(n1, n2)
    const graph = builder.build()
    expect(Object.keys(graph.nodes)).toHaveLength(2)
    expect(graph.entryPoints).toHaveLength(1)
    expect(graph.entryPoints[0]!.nodeId).toBe('first')
  })

  it('throws on duplicate node id', () => {
    const { agent } = createMockAgent('a')
    const builder = new GraphBuilder()
    builder.addNode(agent, 'x')
    expect(() => builder.addNode(createMockAgent('b').agent, 'x')).toThrow('already exists')
  })

  it('throws on duplicate node instance', () => {
    const { agent } = createMockAgent('a')
    const builder = new GraphBuilder()
    builder.addNode(agent, 'a1')
    expect(() => builder.addNode(agent, 'a2')).toThrow('Duplicate node instance')
  })

  it('throws when building empty graph', () => {
    const builder = new GraphBuilder()
    expect(() => builder.build()).toThrow('at least one node')
  })

  it('auto-detects entry points when none set', () => {
    const { agent: a1 } = createMockAgent('a1')
    const { agent: a2 } = createMockAgent('a2')
    const builder = new GraphBuilder()
    builder.addNode(a1, 'a1')
    builder.addNode(a2, 'a2')
    builder.addEdge('a1', 'a2')
    const graph = builder.build()
    expect(graph.entryPoints.some((n) => n.nodeId === 'a1')).toBe(true)
  })

  it('setEntryPoint uses explicit entry', () => {
    const { agent: a1 } = createMockAgent('a1')
    const { agent: a2 } = createMockAgent('a2')
    const builder = new GraphBuilder()
    builder.addNode(a1, 'a1')
    builder.addNode(a2, 'a2')
    builder.addEdge('a1', 'a2')
    builder.setEntryPoint('a2')
    const graph = builder.build()
    expect(graph.entryPoints).toHaveLength(1)
    expect(graph.entryPoints[0]!.nodeId).toBe('a2')
  })

  it('throws when addEdge references nonexistent node', () => {
    const { agent } = createMockAgent('a1')
    const builder = new GraphBuilder()
    builder.addNode(agent, 'a1')
    expect(() => builder.addEdge('a1', 'nonexistent')).toThrow("Target node 'nonexistent' not found")
    expect(() => builder.addEdge('nonexistent', 'a1')).toThrow("Source node 'nonexistent' not found")
  })

  it('throws when setEntryPoint references nonexistent node', () => {
    const { agent } = createMockAgent('a1')
    const builder = new GraphBuilder()
    builder.addNode(agent, 'a1')
    expect(() => builder.setEntryPoint('missing')).toThrow("Node 'missing' not found")
  })

  it('throws when build has no entry points and all nodes have dependencies', () => {
    const { agent: a1 } = createMockAgent('a1')
    const { agent: a2 } = createMockAgent('a2')
    const builder = new GraphBuilder()
    builder.addNode(a1, 'a1')
    builder.addNode(a2, 'a2')
    builder.addEdge('a1', 'a2')
    builder.addEdge('a2', 'a1')
    expect(() => builder.build()).toThrow('No entry points found')
  })

  it('setSessionManager adds session manager as hook provider', () => {
    const { agent: a1 } = createMockAgent('a1')
    const mockSessionManager: HookProvider = {
      registerCallbacks: () => {},
    }
    const builder = new GraphBuilder()
    builder.addNode(a1, 'a1')
    const result = builder.setSessionManager(mockSessionManager)
    expect(result).toBe(builder)
    const graph = builder.build()
    expect(graph).toBeDefined()
  })

  it('setSessionManager appends to existing hook providers', () => {
    const { agent: a1 } = createMockAgent('a1')
    const existingHook: HookProvider = { registerCallbacks: () => {} }
    const mockSessionManager: HookProvider = { registerCallbacks: () => {} }
    const builder = new GraphBuilder()
    builder.addNode(a1, 'a1')
    builder.setHookProviders([existingHook])
    builder.setSessionManager(mockSessionManager)
    const graph = builder.build()
    expect(graph).toBeDefined()
  })
})

describe('Graph', () => {
  describe('execution', () => {
    it('runs linear graph and returns GraphResult', async () => {
      const { agent: a1 } = createMockAgent('a1')
      const { agent: a2 } = createMockAgent('a2')
      const builder = new GraphBuilder()
      builder.addNode(a1, 'a1')
      builder.addNode(a2, 'a2')
      builder.addEdge('a1', 'a2')
      const graph = builder.build()
      const result = (await graph.invoke('task')) as GraphResult
      expect(result).toBeInstanceOf(GraphResult)
      expect(result.status).toBe(Status.COMPLETED)
      expect(result.results['a1']).toBeDefined()
      expect(result.results['a2']).toBeDefined()
      expect(result.executionOrder).toHaveLength(2)
    })

    it('emits stream events for each node', async () => {
      const { agent: a1 } = createMockAgent('a1')
      const { agent: a2 } = createMockAgent('a2')
      const builder = new GraphBuilder()
      builder.addNode(a1, 'a1')
      builder.addNode(a2, 'a2')
      builder.addEdge('a1', 'a2')
      const graph = builder.build()
      const { events, result } = await collectEvents(graph.stream('task'))
      const starts = events.filter((e) => e.type === 'multiAgentNodeStartEvent')
      const stops = events.filter((e) => e.type === 'multiAgentNodeStopEvent')
      const inputEvents = events.filter((e) => e.type === 'multiAgentNodeInputEvent')
      expect(starts).toHaveLength(2)
      expect(stops).toHaveLength(2)
      expect(inputEvents).toHaveLength(2)
      expect(inputEvents.map((e) => e.nodeId).sort()).toStrictEqual(['a1', 'a2'])
      expect(result.status).toBe(Status.COMPLETED)
    })

    it('keeps streaming node events when there are gaps between queue pulls', async () => {
      const model = new DelayingMockModel(250)
      model.addTurn(new TextBlock('slow response'))
      const agent = new Agent({ model, name: 'slow', printer: false })
      const builder = new GraphBuilder()
      builder.addNode(agent, 'slow')
      const graph = builder.build()

      const { events, result } = await collectEvents(graph.stream('task'))
      const stopEvents = events.filter((e) => e.type === 'multiAgentNodeStopEvent')
      const streamEvents = events.filter((e) => e.type === 'multiAgentNodeStreamEvent')
      const deltaEvents = streamEvents.filter((e) => {
        const inner = (e as { event?: { type?: string } }).event
        return inner?.type === 'modelContentBlockDeltaEvent'
      })

      expect(stopEvents).toHaveLength(1)
      expect(deltaEvents.length).toBeGreaterThan(0)
      expect(result.status).toBe(Status.COMPLETED)
    })

    it('builds node input from dependency results', async () => {
      const m1 = new MockMessageModel()
      m1.addTurn(new TextBlock('output from a1'))
      const m2 = new MockMessageModel()
      m2.addTurn(new TextBlock('output from a2'))
      const a1 = new Agent({ model: m1, name: 'a1', printer: false })
      const a2 = new Agent({ model: m2, name: 'a2', printer: false })
      const builder = new GraphBuilder()
      builder.addNode(a1, 'a1')
      builder.addNode(a2, 'a2')
      builder.addEdge('a1', 'a2')
      const graph = builder.build()
      const result = await graph.invoke('original task')
      expect(result.status).toBe(Status.COMPLETED)
      expect(result.results['a2']).toBeDefined()
    })

    it('runs parallel entry points', async () => {
      const { agent: a1 } = createMockAgent('a1')
      const { agent: a2 } = createMockAgent('a2')
      const builder = new GraphBuilder()
      builder.addNode(a1, 'a1')
      builder.addNode(a2, 'a2')
      const graph = builder.build()
      const result = await graph.invoke('task')
      expect(result.status).toBe(Status.COMPLETED)
      expect(Object.keys(result.results)).toHaveLength(2)
    })

    it('respects conditional edge', async () => {
      const { agent: a1 } = createMockAgent('a1')
      const { agent: a2 } = createMockAgent('a2')
      const builder = new GraphBuilder()
      const n1 = builder.addNode(a1, 'a1')
      const n2 = builder.addNode(a2, 'a2')
      builder.addEdge(n1, n2, (state) => state.results['a1'] !== undefined)
      const graph = builder.build()
      const result = await graph.invoke('task')
      expect(result.status).toBe(Status.COMPLETED)
      expect(result.results['a2']).toBeDefined()
    })

    it('requires all incoming dependencies before running a node', async () => {
      const { agent: a1 } = createMockAgent('a1')
      const { agent: a2 } = createMockAgent('a2')
      const { agent: a3 } = createMockAgent('a3')
      const builder = new GraphBuilder()
      builder.addNode(a1, 'a1')
      builder.addNode(a2, 'a2')
      builder.addNode(a3, 'a3')
      builder.addEdge('a1', 'a3')
      builder.addEdge('a2', 'a3')
      builder.setEntryPoint('a1')
      const graph = builder.build()
      const result = (await graph.invoke('task')) as GraphResult
      expect(result.status).toBe(Status.COMPLETED)
      expect(result.results['a1']).toBeDefined()
      expect(result.results['a2']).toBeUndefined()
      expect(result.results['a3']).toBeUndefined()
      expect(result.executionOrder.map((node) => node.nodeId)).toStrictEqual(['a1'])
    })

    it('throws Unsupported executor type for node when executor is not Agent or MultiAgentBase', async () => {
      const fakeExecutor = {
        stream: async function* () {
          yield 1
        },
      }
      const builder = new GraphBuilder()
      builder.addNode(fakeExecutor as unknown as GraphExecutor, 'bad')
      const graph = builder.build()
      await expect(graph.invoke('task')).rejects.toThrow("Unsupported executor type for node 'bad'")
    })

    it('fail-fast when node throws during stream', async () => {
      const model = new MockMessageModel()
      model.addTurn(new Error('node failed'))
      const agent = new Agent({ model, name: 'fail', printer: false })
      const builder = new GraphBuilder()
      builder.addNode(agent, 'fail')
      const graph = builder.build()
      await expect(graph.invoke('task')).rejects.toThrow('node failed')
      const payload = graph.serializeState()
      expect(payload.status).toBe(Status.FAILED)
    })

    it('completes with ContentBlock list input', async () => {
      const { agent } = createMockAgent('a')
      const builder = new GraphBuilder()
      builder.addNode(agent, 'a')
      const graph = builder.build()
      const result = await graph.invoke([new TextBlock('task')])
      expect(result.status).toBe(Status.COMPLETED)
    })

    it('accumulates without throwing when node returns missing or partial metrics', async () => {
      const model = new MockMessageModel()
      model.addTurn(new TextBlock('ok'))
      const agent = new Agent({ model, name: 'minimal', printer: false })
      const builder = new GraphBuilder()
      builder.addNode(agent, 'minimal')
      const graph = builder.build()
      const result = await graph.invoke('task')
      expect(result.status).toBe(Status.COMPLETED)
      expect(result.accumulatedUsage).toBeDefined()
      expect(result.accumulatedMetrics).toBeDefined()
    })

    it('fails node when execution exceeds nodeTimeout', async () => {
      const model = new DelayingMockModel(250)
      model.addTurn(new TextBlock('ok'))
      const agent = new Agent({ model, name: 'slow', printer: false })
      const builder = new GraphBuilder()
      builder.addNode(agent, 'slow')
      builder.setNodeTimeout(0.1)
      const graph = builder.build()
      await expect(graph.invoke('task')).rejects.toThrow('timed out')
      const payload = graph.serializeState()
      expect(payload.status).toBe(Status.FAILED)
      expect((payload.node_results as Record<string, { status: string }>)['slow']?.status).toBe(Status.FAILED)
    })

    it('cyclic graph with resetOnRevisit runs cycle and respects max node executions', async () => {
      const { agent: a1, model: m1 } = createMockAgent('a1')
      m1.addTurn(new TextBlock('again'))
      const { agent: a2 } = createMockAgent('a2')
      const { agent: a3 } = createMockAgent('a3')
      const builder = new GraphBuilder()
      const n1 = builder.addNode(a1, 'a1')
      const n2 = builder.addNode(a2, 'a2')
      const n3 = builder.addNode(a3, 'a3')
      builder.addEdge(n1, n2)
      builder.addEdge(n2, n3)
      builder.addEdge(n3, n1, (state) => state.results['a3'] !== undefined)
      builder.setEntryPoint('a1')
      builder.setMaxNodeExecutions(6)
      builder.resetOnRevisit(true)
      const graph = builder.build()
      const result = (await graph.invoke('task')) as GraphResult
      expect(result.status).toBe(Status.FAILED)
      const order = result.executionOrder.map((n: GraphNode) => n.nodeId)
      expect(order.filter((id) => id === 'a1').length).toBeGreaterThanOrEqual(2)
      expect(order).toContain('a1')
      expect(order).toContain('a2')
      expect(order).toContain('a3')
      expect(m1.callCount).toBeGreaterThanOrEqual(2)
    })

    it('does not revisit completed nodes when resetOnRevisit is disabled', async () => {
      const { agent: a1 } = createMockAgent('a1')
      const { agent: a2 } = createMockAgent('a2')
      const builder = new GraphBuilder()
      builder.addNode(a1, 'a1')
      builder.addNode(a2, 'a2')
      builder.addEdge('a1', 'a2')
      builder.addEdge('a2', 'a1')
      builder.setEntryPoint('a1')
      builder.setMaxNodeExecutions(10)
      const graph = builder.build()
      const result = (await graph.invoke('task')) as GraphResult
      expect(result.status).toBe(Status.COMPLETED)
      expect(result.executionOrder.map((node) => node.nodeId)).toStrictEqual(['a1', 'a2'])
      expect(result.results['a1']).toBeDefined()
      expect(result.results['a2']).toBeDefined()
    })

    it('nested multi-agent node completes and produces result', async () => {
      const { agent: inner } = createMockAgent('inner')
      const swarm = new Swarm({ nodes: [inner] })
      const { agent: outer } = createMockAgent('outer')
      const builder = new GraphBuilder()
      builder.addNode(outer, 'outer')
      builder.addNode(swarm, 'nested')
      builder.addEdge('outer', 'nested')
      const graph = builder.build()
      const result = await graph.invoke('task')
      expect(result.status).toBe(Status.COMPLETED)
      expect(result.results['nested']).toBeDefined()
      expect(result.results['outer']).toBeDefined()
    })
  })

  describe('limits', () => {
    it('fails when max node executions exceeded', async () => {
      const { agent: a1 } = createMockAgent('a1')
      const { agent: a2 } = createMockAgent('a2')
      const builder = new GraphBuilder()
      builder.addNode(a1, 'a1')
      builder.addNode(a2, 'a2')
      builder.addEdge('a1', 'a2')
      builder.setMaxNodeExecutions(1)
      const graph = builder.build()
      const result = await graph.invoke('task')
      expect(result.status).toBe(Status.FAILED)
    })
  })

  describe('MultiAgentInitializedEvent', () => {
    it('fires MultiAgentInitializedEvent on first stream call (not constructor)', async () => {
      const { agent } = createMockAgent('a')
      const callbackNames: string[] = []

      const hookProvider: HookProvider = {
        registerCallbacks(registry: HookRegistry): void {
          registry.addCallback(MultiAgentInitializedEvent, () => {
            callbackNames.push('multi_agent_initialized_event')
          })
        },
      }

      const builder = new GraphBuilder()
      builder.addNode(agent, 'a')
      builder.setHookProviders([hookProvider])
      const graph = builder.build()

      // After construction, event should NOT have fired
      expect(callbackNames).toHaveLength(0)

      // After first stream, event should fire
      await collectEvents(graph.stream('task'))
      expect(callbackNames).toContain('multi_agent_initialized_event')
    })

    it('fires MultiAgentInitializedEvent only once across multiple stream calls', async () => {
      const { agent } = createMockAgent('a')
      let initCount = 0

      const hookProvider: HookProvider = {
        registerCallbacks(registry: HookRegistry): void {
          registry.addCallback(MultiAgentInitializedEvent, () => {
            initCount++
          })
        },
      }

      const builder = new GraphBuilder()
      builder.addNode(agent, 'a')
      builder.setHookProviders([hookProvider])
      const graph = builder.build()

      await collectEvents(graph.stream('task1'))
      ;(agent.model as MockMessageModel).addTurn(new TextBlock('response2'))
      await collectEvents(graph.stream('task2'))

      expect(initCount).toBe(1)
    })

    it('fires events in correct lifecycle order', async () => {
      const { agent } = createMockAgent('a')
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

      const builder = new GraphBuilder()
      builder.addNode(agent, 'a')
      builder.setHookProviders([hookProvider])
      const graph = builder.build()

      await collectEvents(graph.stream('task'))

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
      const { agent } = createMockAgent('a')
      const builder = new GraphBuilder()
      builder.addNode(agent, 'a')
      const beforeCalls: string[] = []
      const afterCalls: string[] = []
      const provider: HookProvider = {
        registerCallbacks(registry: HookRegistry): void {
          registry.addCallback(BeforeNodeCallEvent, (e) => {
            beforeCalls.push(e.nodeId)
          })
          registry.addCallback(AfterNodeCallEvent, (e) => {
            afterCalls.push(e.nodeId)
          })
        },
      }
      builder.setHookProviders([provider])
      const graph = builder.build()
      await graph.invoke('task')
      expect(beforeCalls).toContain('a')
      expect(afterCalls).toContain('a')
    })

    it('supports node cancellation via hook', async () => {
      const { agent } = createMockAgent('a')
      const builder = new GraphBuilder()
      builder.addNode(agent, 'a')
      const provider: HookProvider = {
        registerCallbacks(registry: HookRegistry): void {
          registry.addCallback(BeforeNodeCallEvent, (e) => {
            e.cancelNode = true
          })
        },
      }
      builder.setHookProviders([provider])
      const graph = builder.build()
      await expect(graph.invoke('task')).rejects.toThrow('cancelled')
    })

    it('passes invocationState to BeforeNodeCallEvent and AfterNodeCallEvent', async () => {
      const { agent } = createMockAgent('a')
      const builder = new GraphBuilder()
      builder.addNode(agent, 'a')
      const seen: Record<string, unknown>[] = []
      const provider: HookProvider = {
        registerCallbacks(registry: HookRegistry): void {
          registry.addCallback(BeforeNodeCallEvent, (e) => {
            seen.push(e.invocationState ?? { __none: true })
          })
          registry.addCallback(AfterNodeCallEvent, (e) => {
            seen.push(e.invocationState ?? { __none: true })
          })
        },
      }
      builder.setHookProviders([provider])
      const graph = builder.build()
      const invocationState = { requestId: 'r1' }
      await graph.invoke('task', { invocationState })
      expect(seen.length).toBeGreaterThanOrEqual(2)
      expect(seen.every((s) => (s as { requestId?: string }).requestId === 'r1')).toBe(true)
    })
  })

  describe('serialization', () => {
    it('serializes and deserializes state', async () => {
      const { agent: a1 } = createMockAgent('a1')
      const { agent: a2 } = createMockAgent('a2')
      const builder = new GraphBuilder()
      builder.addNode(a1, 'a1')
      builder.addNode(a2, 'a2')
      builder.addEdge('a1', 'a2')
      const graph = builder.build()
      await graph.invoke('task')
      const payload = graph.serializeState()
      expect(payload.type).toBe('graph')
      expect(payload.status).toBe(Status.COMPLETED)
      expect(Array.isArray(payload.completed_nodes)).toBe(true)
      const graph2 = builder.build()
      graph2.deserializeState(payload)
      expect(graph2.state.status).toBe(Status.COMPLETED)
    })
  })
})
