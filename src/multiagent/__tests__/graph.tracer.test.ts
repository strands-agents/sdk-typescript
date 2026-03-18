import { describe, expect, it, vi, beforeEach, type MockInstance } from 'vitest'
import { Agent } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { TextBlock } from '../../types/messages.js'
import { Tracer } from '../../telemetry/tracer.js'
import { Graph } from '../graph.js'
import { BeforeNodeCallEvent } from '../events.js'
import { Status } from '../state.js'

interface MockTracerInstance {
  startAgentSpan: MockInstance
  endAgentSpan: MockInstance
  startAgentLoopSpan: MockInstance
  endAgentLoopSpan: MockInstance
  startModelInvokeSpan: MockInstance
  endModelInvokeSpan: MockInstance
  startToolCallSpan: MockInstance
  endToolCallSpan: MockInstance
  startMultiAgentSpan: MockInstance
  endMultiAgentSpan: MockInstance
  startNodeSpan: MockInstance
  endNodeSpan: MockInstance
  withSpanContext: MockInstance
}

vi.mock('../../telemetry/tracer.js', () => ({
  Tracer: vi.fn(function () {
    return {
      startAgentSpan: vi.fn().mockReturnValue({ mock: 'agentSpan' }),
      endAgentSpan: vi.fn(),
      startAgentLoopSpan: vi.fn().mockReturnValue({ mock: 'loopSpan' }),
      endAgentLoopSpan: vi.fn(),
      startModelInvokeSpan: vi.fn().mockReturnValue({ mock: 'modelSpan' }),
      endModelInvokeSpan: vi.fn(),
      startToolCallSpan: vi.fn().mockReturnValue({ mock: 'toolSpan' }),
      endToolCallSpan: vi.fn(),
      startMultiAgentSpan: vi.fn().mockReturnValue({ mock: 'multiAgentSpan' }),
      endMultiAgentSpan: vi.fn(),
      startNodeSpan: vi.fn().mockReturnValue({ mock: 'nodeSpan' }),
      endNodeSpan: vi.fn(),
      withSpanContext: vi.fn((_span: unknown, fn: () => unknown) => fn()),
    }
  }),
}))

/**
 * Returns the Tracer mock instance owned by the Graph.
 * Agents are constructed before the Graph, so the Graph's Tracer
 * is always the last one created during Graph construction.
 */
function getGraphTracer(): MockTracerInstance {
  return vi.mocked(Tracer).mock.results.at(-1)!.value
}

function makeAgent(id: string, text = 'reply'): Agent {
  const model = new MockMessageModel().addTurn(new TextBlock(text))
  return new Agent({ model, printer: false, id })
}

function makeAgentWithUsage(id: string, text = 'reply'): Agent {
  const model = new MockMessageModel().addTurn(new TextBlock(text), {
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  })
  return new Agent({ model, printer: false, id })
}

describe('Graph tracer integration', () => {
  let graph: Graph
  let tracer: MockTracerInstance

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('multi-agent span lifecycle', () => {
    it('starts and ends multi-agent span on successful invocation', async () => {
      graph = new Graph({ id: 'test-graph', nodes: [makeAgent('a')], edges: [] })
      tracer = getGraphTracer()

      await graph.invoke('Hello')

      expect(tracer.startMultiAgentSpan).toHaveBeenCalledTimes(1)
      expect(tracer.startMultiAgentSpan).toHaveBeenCalledWith({
        orchestratorId: 'test-graph',
        orchestratorType: 'graph',
        input: 'Hello',
      })
      expect(tracer.endMultiAgentSpan).toHaveBeenCalledTimes(1)

      const [span, endOpts] = tracer.endMultiAgentSpan.mock.calls[0]!
      expect(span).toStrictEqual({ mock: 'multiAgentSpan' })
      expect(endOpts.duration).toBeGreaterThanOrEqual(0)
      expect(endOpts.usage).toStrictEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
      expect(endOpts.error).toBeUndefined()
    })

    it('passes exact usage from result to endMultiAgentSpan', async () => {
      graph = new Graph({ id: 'test-graph', nodes: [makeAgentWithUsage('a')], edges: [] })
      tracer = getGraphTracer()

      await graph.invoke('Hello')

      const [, endOpts] = tracer.endMultiAgentSpan.mock.calls[0]!
      expect(endOpts.usage).toStrictEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
    })

    it('ends multi-agent span with error when maxSteps exceeded', async () => {
      graph = new Graph({
        nodes: [makeAgent('a'), makeAgent('b')],
        edges: [['a', 'b']],
        maxSteps: 1,
      })
      tracer = getGraphTracer()

      await expect(graph.invoke('Hello')).rejects.toThrow('max steps reached')

      const [span, endOpts] = tracer.endMultiAgentSpan.mock.calls[0]!
      expect(span).toStrictEqual({ mock: 'multiAgentSpan' })
      expect(endOpts.error).toBeInstanceOf(Error)
      expect(endOpts.error.message).toContain('max steps reached')
      expect(endOpts.duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe('node span lifecycle', () => {
    it('starts and ends node span for each node execution', async () => {
      graph = new Graph({ nodes: [makeAgent('a'), makeAgent('b')], edges: [['a', 'b']] })
      tracer = getGraphTracer()

      await graph.invoke('Hello')

      expect(tracer.startNodeSpan).toHaveBeenCalledTimes(2)
      expect(tracer.startNodeSpan).toHaveBeenNthCalledWith(1, { nodeId: 'a', nodeType: 'agentNode' })
      expect(tracer.startNodeSpan).toHaveBeenNthCalledWith(2, { nodeId: 'b', nodeType: 'agentNode' })
      expect(tracer.endNodeSpan).toHaveBeenCalledTimes(2)
    })

    it('ends node span with COMPLETED status, duration, and zero usage on success', async () => {
      graph = new Graph({ nodes: [makeAgent('a')], edges: [] })
      tracer = getGraphTracer()

      await graph.invoke('Hello')

      const [span, endOpts] = tracer.endNodeSpan.mock.calls[0]!
      expect(span).toStrictEqual({ mock: 'nodeSpan' })
      expect(endOpts.status).toBe(Status.COMPLETED)
      expect(endOpts.duration).toBeGreaterThanOrEqual(0)
      expect(endOpts.usage).toStrictEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    })

    it('passes exact usage from node result to endNodeSpan', async () => {
      graph = new Graph({ nodes: [makeAgentWithUsage('a')], edges: [] })
      tracer = getGraphTracer()

      await graph.invoke('Hello')

      const [, endOpts] = tracer.endNodeSpan.mock.calls[0]!
      expect(endOpts.status).toBe(Status.COMPLETED)
      expect(endOpts.usage).toStrictEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
    })

    it('ends node span with FAILED status when node agent throws', async () => {
      const model = new MockMessageModel().addTurn(new Error('agent exploded'))
      graph = new Graph({ nodes: [new Agent({ model, printer: false, id: 'a' })], edges: [] })
      tracer = getGraphTracer()

      const result = await graph.invoke('Hello')

      expect(result.status).toBe(Status.FAILED)
      const [span, endOpts] = tracer.endNodeSpan.mock.calls[0]!
      expect(span).toStrictEqual({ mock: 'nodeSpan' })
      expect(endOpts.status).toBe(Status.FAILED)
      expect(endOpts.duration).toBeGreaterThanOrEqual(0)
    })

    it('ends node span with CANCELLED status and zero duration when cancelled by hook', async () => {
      graph = new Graph({ nodes: [makeAgent('a')], edges: [] })
      tracer = getGraphTracer()
      graph.addHook(BeforeNodeCallEvent, (event) => {
        event.cancel = 'cancelled by test'
      })

      await graph.invoke('Hello')

      expect(tracer.endNodeSpan).toHaveBeenCalledWith({ mock: 'nodeSpan' }, { status: Status.CANCELLED, duration: 0 })
    })
  })

  describe('null span handling', () => {
    it('completes successfully when startMultiAgentSpan returns null', async () => {
      graph = new Graph({ nodes: [makeAgent('a')], edges: [] })
      tracer = getGraphTracer()
      tracer.startMultiAgentSpan.mockReturnValue(null)

      const result = await graph.invoke('Hello')

      expect(result.status).toBe(Status.COMPLETED)
      const [span] = tracer.endMultiAgentSpan.mock.calls[0]!
      expect(span).toBeNull()
    })

    it('completes successfully when startNodeSpan returns null', async () => {
      graph = new Graph({ nodes: [makeAgent('a')], edges: [] })
      tracer = getGraphTracer()
      tracer.startNodeSpan.mockReturnValue(null)

      const result = await graph.invoke('Hello')

      expect(result.status).toBe(Status.COMPLETED)
      const [span] = tracer.endNodeSpan.mock.calls[0]!
      expect(span).toBeNull()
    })
  })

  describe('span context propagation', () => {
    it('passes node span to every withSpanContext call during node execution', async () => {
      graph = new Graph({ nodes: [makeAgent('a')], edges: [] })
      tracer = getGraphTracer()

      await graph.invoke('Hello')

      // First call: multiAgentSpan to create nodeSpan, then nodeSpan for node.stream() + gen.next() calls
      expect(tracer.withSpanContext.mock.calls.length).toBeGreaterThanOrEqual(3)

      // First call uses multiAgentSpan to create the nodeSpan
      expect(tracer.withSpanContext.mock.calls[0]![0]).toStrictEqual({ mock: 'multiAgentSpan' })

      // Subsequent calls use nodeSpan for node execution
      for (let i = 1; i < tracer.withSpanContext.mock.calls.length; i++) {
        expect(tracer.withSpanContext.mock.calls[i]![0]).toStrictEqual({ mock: 'nodeSpan' })
        expect(typeof tracer.withSpanContext.mock.calls[i]![1]).toBe('function')
      }
    })
  })

  describe('parallel node execution', () => {
    it('creates separate node spans for parallel source nodes', async () => {
      graph = new Graph({
        nodes: [makeAgent('a'), makeAgent('b'), makeAgent('c')],
        edges: [
          ['a', 'c'],
          ['b', 'c'],
        ],
      })
      tracer = getGraphTracer()

      await graph.invoke('Hello')

      expect(tracer.startNodeSpan).toHaveBeenCalledTimes(3)
      const nodeIds = tracer.startNodeSpan.mock.calls.map((call) => call[0].nodeId)
      expect(nodeIds).toContain('a')
      expect(nodeIds).toContain('b')
      expect(nodeIds).toContain('c')
      expect(tracer.endNodeSpan).toHaveBeenCalledTimes(3)
    })
  })
})
