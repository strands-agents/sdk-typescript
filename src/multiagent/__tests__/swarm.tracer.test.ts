import { describe, expect, it, vi, beforeEach, type MockInstance } from 'vitest'
import { Agent } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { TextBlock } from '../../types/messages.js'
import type { JSONValue } from '../../types/json.js'
import { Tracer } from '../../telemetry/tracer.js'
import { Swarm } from '../swarm.js'
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
 * Returns the Tracer mock instance owned by the Swarm.
 * Agents are constructed before the Swarm, so the Swarm's Tracer
 * is always the last one created during Swarm construction.
 */
function getSwarmTracer(): MockTracerInstance {
  return vi.mocked(Tracer).mock.results.at(-1)!.value
}

function createHandoffAgent(
  agentId: string,
  handoff: { agentId?: string; message: string; context?: Record<string, unknown> },
  description: string = `Agent ${agentId}`
): Agent {
  const model = new MockMessageModel()
    .addTurn({
      type: 'toolUseBlock',
      name: 'strands_structured_output',
      toolUseId: 'tool-1',
      input: handoff as JSONValue,
    })
    .addTurn(new TextBlock('Done'))
  return new Agent({ model, printer: false, id: agentId, description })
}

function createHandoffAgentWithUsage(
  agentId: string,
  handoff: { agentId?: string; message: string; context?: Record<string, unknown> },
  description: string = `Agent ${agentId}`
): Agent {
  const model = new MockMessageModel()
    .addTurn(
      {
        type: 'toolUseBlock',
        name: 'strands_structured_output',
        toolUseId: 'tool-1',
        input: handoff as JSONValue,
      },
      { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
    )
    .addTurn(new TextBlock('Done'))
  return new Agent({ model, printer: false, id: agentId, description })
}

function createFinalAgent(agentId: string, description: string = `Agent ${agentId}`): Agent {
  return createHandoffAgent(agentId, { message: 'final response' }, description)
}

function createFinalAgentWithUsage(agentId: string, description: string = `Agent ${agentId}`): Agent {
  return createHandoffAgentWithUsage(agentId, { message: 'final response' }, description)
}

describe('Swarm tracer integration', () => {
  let swarm: Swarm
  let tracer: MockTracerInstance

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('multi-agent span lifecycle', () => {
    it('starts and ends multi-agent span on successful invocation', async () => {
      swarm = new Swarm({ id: 'test-swarm', nodes: [createFinalAgent('a')] })
      tracer = getSwarmTracer()

      await swarm.invoke('Hello')

      expect(tracer.startMultiAgentSpan).toHaveBeenCalledTimes(1)
      expect(tracer.startMultiAgentSpan).toHaveBeenCalledWith({
        orchestratorId: 'test-swarm',
        orchestratorType: 'swarm',
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
      swarm = new Swarm({ id: 'test-swarm', nodes: [createFinalAgentWithUsage('a')] })
      tracer = getSwarmTracer()

      await swarm.invoke('Hello')

      const [, endOpts] = tracer.endMultiAgentSpan.mock.calls[0]!
      expect(endOpts.usage).toStrictEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
    })

    it('ends multi-agent span with error when maxSteps exceeded', async () => {
      swarm = new Swarm({
        nodes: [
          createHandoffAgent('a', { agentId: 'b', message: 'go' }),
          createHandoffAgent('b', { agentId: 'a', message: 'go' }),
        ],
        maxSteps: 1,
      })
      tracer = getSwarmTracer()

      await expect(swarm.invoke('Hello')).rejects.toThrow('swarm reached step limit')

      const [span, endOpts] = tracer.endMultiAgentSpan.mock.calls[0]!
      expect(span).toStrictEqual({ mock: 'multiAgentSpan' })
      expect(endOpts.error).toBeInstanceOf(Error)
      expect(endOpts.error.message).toContain('swarm reached step limit')
      expect(endOpts.duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe('node span lifecycle', () => {
    it('starts and ends node span for each agent in handoff chain', async () => {
      swarm = new Swarm({
        nodes: [createHandoffAgent('a', { agentId: 'b', message: 'go to b' }), createFinalAgent('b')],
      })
      tracer = getSwarmTracer()

      await swarm.invoke('Hello')

      expect(tracer.startNodeSpan).toHaveBeenCalledTimes(2)
      expect(tracer.startNodeSpan).toHaveBeenNthCalledWith(1, { nodeId: 'a', nodeType: 'agentNode' })
      expect(tracer.startNodeSpan).toHaveBeenNthCalledWith(2, { nodeId: 'b', nodeType: 'agentNode' })
      expect(tracer.endNodeSpan).toHaveBeenCalledTimes(2)
    })

    it('ends node span with COMPLETED status, duration, and zero usage on success', async () => {
      swarm = new Swarm({ nodes: [createFinalAgent('a')] })
      tracer = getSwarmTracer()

      await swarm.invoke('Hello')

      const [span, endOpts] = tracer.endNodeSpan.mock.calls[0]!
      expect(span).toStrictEqual({ mock: 'nodeSpan' })
      expect(endOpts.status).toBe(Status.COMPLETED)
      expect(endOpts.duration).toBeGreaterThanOrEqual(0)
      expect(endOpts.usage).toStrictEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    })

    it('passes exact usage from node result to endNodeSpan', async () => {
      swarm = new Swarm({ nodes: [createFinalAgentWithUsage('a')] })
      tracer = getSwarmTracer()

      await swarm.invoke('Hello')

      const [, endOpts] = tracer.endNodeSpan.mock.calls[0]!
      expect(endOpts.status).toBe(Status.COMPLETED)
      expect(endOpts.usage).toStrictEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
    })

    it('ends node span with error when node agent throws', async () => {
      const model = new MockMessageModel().addTurn(new Error('agent exploded'))
      swarm = new Swarm({ nodes: [new Agent({ model, printer: false, id: 'a', description: 'Agent a' })] })
      tracer = getSwarmTracer()

      const result = await swarm.invoke('Hello')

      expect(result.status).toBe(Status.FAILED)
      const [span, endOpts] = tracer.endNodeSpan.mock.calls[0]!
      expect(span).toStrictEqual({ mock: 'nodeSpan' })
      expect(endOpts.status).toBe(Status.FAILED)
      expect(endOpts.duration).toBeGreaterThanOrEqual(0)
    })

    it('ends node span with CANCELLED status and zero duration when cancelled by hook', async () => {
      swarm = new Swarm({ nodes: [createFinalAgent('a')] })
      tracer = getSwarmTracer()
      swarm.addHook(BeforeNodeCallEvent, (event) => {
        event.cancel = 'cancelled by test'
      })

      await swarm.invoke('Hello')

      expect(tracer.endNodeSpan).toHaveBeenCalledWith({ mock: 'nodeSpan' }, { status: Status.CANCELLED, duration: 0 })
    })
  })

  describe('null span handling', () => {
    it('completes successfully when startMultiAgentSpan returns null', async () => {
      swarm = new Swarm({ nodes: [createFinalAgent('a')] })
      tracer = getSwarmTracer()
      tracer.startMultiAgentSpan.mockReturnValue(null)

      const result = await swarm.invoke('Hello')

      expect(result.status).toBe(Status.COMPLETED)
      const [span] = tracer.endMultiAgentSpan.mock.calls[0]!
      expect(span).toBeNull()
    })

    it('completes successfully when startNodeSpan returns null', async () => {
      swarm = new Swarm({ nodes: [createFinalAgent('a')] })
      tracer = getSwarmTracer()
      tracer.startNodeSpan.mockReturnValue(null)

      const result = await swarm.invoke('Hello')

      expect(result.status).toBe(Status.COMPLETED)
      const [span] = tracer.endNodeSpan.mock.calls[0]!
      expect(span).toBeNull()
    })
  })

  describe('span context propagation', () => {
    it('passes node span to every withSpanContext call during node execution', async () => {
      swarm = new Swarm({ nodes: [createFinalAgent('a')] })
      tracer = getSwarmTracer()

      await swarm.invoke('Hello')

      // node.stream() init + gen.next() per iteration (at least 2: first result + done)
      expect(tracer.withSpanContext.mock.calls.length).toBeGreaterThanOrEqual(3)
      for (const call of tracer.withSpanContext.mock.calls) {
        expect(call[0]).toStrictEqual({ mock: 'nodeSpan' })
        expect(typeof call[1]).toBe('function')
      }
    })
  })

  describe('handoff chain tracing', () => {
    it('creates node spans for each agent in a multi-hop handoff', async () => {
      swarm = new Swarm({
        nodes: [
          createHandoffAgent('a', { agentId: 'b', message: 'go to b' }),
          createHandoffAgent('b', { agentId: 'c', message: 'go to c' }),
          createFinalAgent('c'),
        ],
      })
      tracer = getSwarmTracer()

      await swarm.invoke('Hello')

      expect(tracer.startNodeSpan).toHaveBeenCalledTimes(3)
      const nodeIds = tracer.startNodeSpan.mock.calls.map((call) => call[0].nodeId)
      expect(nodeIds).toStrictEqual(['a', 'b', 'c'])
      expect(tracer.endNodeSpan).toHaveBeenCalledTimes(3)
    })

    it('accumulates usage across handoff chain', async () => {
      swarm = new Swarm({
        nodes: [createHandoffAgentWithUsage('a', { agentId: 'b', message: 'go to b' }), createFinalAgentWithUsage('b')],
      })
      tracer = getSwarmTracer()

      await swarm.invoke('Hello')

      const [, endOpts] = tracer.endMultiAgentSpan.mock.calls[0]!
      expect(endOpts.usage).toStrictEqual({ inputTokens: 20, outputTokens: 10, totalTokens: 30 })
    })
  })
})
