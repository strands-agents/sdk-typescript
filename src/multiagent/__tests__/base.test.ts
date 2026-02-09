import { describe, expect, it } from 'vitest'
import { Status, NodeResult, MultiAgentResult, MultiAgentBase } from '../base.js'
import { AgentResult } from '../../types/agent.js'
import { Message, TextBlock } from '../../types/messages.js'
import { Interrupt, InterruptState } from '../../interrupt.js'
import {
  MultiAgentNodeStartEvent,
  MultiAgentNodeStopEvent,
  MultiAgentNodeInputEvent,
  MultiAgentNodeStreamEvent,
  MultiAgentHandoffEvent,
  MultiAgentNodeCancelEvent,
  MultiAgentNodeInterruptEvent,
  MultiAgentResultEvent,
} from '../streaming-events.js'
import {
  MultiAgentInitializedEvent,
  BeforeMultiAgentInvocationEvent,
  AfterMultiAgentInvocationEvent,
  BeforeNodeCallEvent,
  AfterNodeCallEvent,
} from '../hook-events.js'
import type { MultiAgentStreamEvent } from '../types.js'

function createTestAgentResult(text: string = 'Test response'): AgentResult {
  return new AgentResult({
    stopReason: 'endTurn',
    lastMessage: new Message({ role: 'assistant', content: [new TextBlock(text)] }),
  })
}

function createTestMultiAgentBase(
  resultOverride?: MultiAgentResult
): MultiAgentBase & { _interruptState: InterruptState } {
  const result = resultOverride ?? new MultiAgentResult({ status: Status.COMPLETED })

  return new (class extends MultiAgentBase {
    readonly id = 'test-multiagent'
    _interruptState = new InterruptState()

    // eslint-disable-next-line require-yield
    async *stream(): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult> {
      return result
    }

    serializeState(): Record<string, unknown> {
      return {}
    }

    deserializeState(_payload: Record<string, unknown>): void {
      // no-op
    }
  })()
}

describe('Status', () => {
  it('has all expected values', () => {
    expect(Status.PENDING).toBe('pending')
    expect(Status.EXECUTING).toBe('executing')
    expect(Status.COMPLETED).toBe('completed')
    expect(Status.FAILED).toBe('failed')
    expect(Status.INTERRUPTED).toBe('interrupted')
  })
})

describe('NodeResult', () => {
  it('initializes with defaults', () => {
    const agentResult = createTestAgentResult()
    const nodeResult = new NodeResult({ result: agentResult })

    expect(nodeResult.result).toBe(agentResult)
    expect(nodeResult.executionTime).toBe(0)
    expect(nodeResult.status).toBe(Status.PENDING)
    expect(nodeResult.accumulatedUsage).toStrictEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    expect(nodeResult.accumulatedMetrics).toStrictEqual({ latencyMs: 0 })
    expect(nodeResult.executionCount).toBe(0)
    expect(nodeResult.interrupts).toStrictEqual([])
  })

  it('initializes with custom values', () => {
    const agentResult = createTestAgentResult()
    const usage = { inputTokens: 100, outputTokens: 200, totalTokens: 300 }
    const metrics = { latencyMs: 250 }

    const nodeResult = new NodeResult({
      result: agentResult,
      executionTime: 75,
      status: Status.COMPLETED,
      accumulatedUsage: usage,
      accumulatedMetrics: metrics,
      executionCount: 5,
    })

    expect(nodeResult.executionTime).toBe(75)
    expect(nodeResult.status).toBe(Status.COMPLETED)
    expect(nodeResult.accumulatedUsage).toStrictEqual(usage)
    expect(nodeResult.accumulatedMetrics).toStrictEqual(metrics)
    expect(nodeResult.executionCount).toBe(5)
  })

  it('creates independent usage/metrics instances by default', () => {
    const agentResult = createTestAgentResult()
    const nodeResult1 = new NodeResult({ result: agentResult })
    const nodeResult2 = new NodeResult({ result: agentResult })

    nodeResult1.accumulatedUsage.inputTokens = 100
    expect(nodeResult2.accumulatedUsage.inputTokens).toBe(0)
  })

  describe('getAgentResults', () => {
    it('returns single AgentResult', () => {
      const agentResult = createTestAgentResult()
      const nodeResult = new NodeResult({ result: agentResult })

      const results = nodeResult.getAgentResults()
      expect(results).toHaveLength(1)
      expect(results[0]).toBe(agentResult)
    })

    it('returns empty array for Error result', () => {
      const nodeResult = new NodeResult({ result: new Error('Test error'), status: Status.FAILED })
      expect(nodeResult.getAgentResults()).toHaveLength(0)
    })

    it('flattens nested MultiAgentResult', () => {
      const innerResult1 = createTestAgentResult('Response 1')
      const innerResult2 = createTestAgentResult('Response 2')

      const multiAgentResult = new MultiAgentResult({
        results: {
          node1: new NodeResult({ result: innerResult1 }),
          node2: new NodeResult({ result: innerResult2 }),
        },
      })

      const outerNodeResult = new NodeResult({ result: multiAgentResult })
      const agentResults = outerNodeResult.getAgentResults()

      expect(agentResults).toHaveLength(2)
      const texts = agentResults.map((r) => r.toString())
      expect(texts).toContain('Response 1')
      expect(texts).toContain('Response 2')
    })
  })

  describe('toDict / fromDict', () => {
    it('round-trips AgentResult', () => {
      const agentResult = createTestAgentResult('Hello world')
      const nodeResult = new NodeResult({
        result: agentResult,
        executionTime: 100,
        status: Status.COMPLETED,
      })

      const dict = nodeResult.toDict()
      expect(dict.result.type).toBe('agentResult')
      expect(dict.executionTime).toBe(100)
      expect(dict.status).toBe('completed')

      const restored = NodeResult.fromDict(dict)
      expect(restored.executionTime).toBe(100)
      expect(restored.status).toBe(Status.COMPLETED)
      expect(restored.result).toBeInstanceOf(AgentResult)
      expect((restored.result as AgentResult).stopReason).toBe('endTurn')
    })

    it('round-trips Error result', () => {
      const nodeResult = new NodeResult({
        result: new Error('Test error'),
        status: Status.FAILED,
      })

      const dict = nodeResult.toDict()
      expect(dict.result.type).toBe('exception')
      expect((dict.result as { message: string }).message).toBe('Test error')
      expect(dict.status).toBe('failed')

      const restored = NodeResult.fromDict(dict)
      expect(restored.result).toBeInstanceOf(Error)
      expect((restored.result as Error).message).toBe('Test error')
    })

    it('round-trips MultiAgentResult', () => {
      const innerResult = createTestAgentResult('Inner response')
      const multiResult = new MultiAgentResult({
        status: Status.COMPLETED,
        results: {
          test_node: new NodeResult({ result: innerResult }),
        },
        executionTime: 200,
      })

      const nodeResult = new NodeResult({ result: multiResult, status: Status.COMPLETED })
      const dict = nodeResult.toDict()
      expect(dict.result.type).toBe('multiAgentResult')

      const restored = NodeResult.fromDict(dict)
      expect(restored.result).toBeInstanceOf(MultiAgentResult)
      const restoredMulti = restored.result as MultiAgentResult
      expect(restoredMulti.status).toBe(Status.COMPLETED)
      expect(Object.keys(restoredMulti.results)).toContain('test_node')
    })

    it('preserves interrupts during round-trip', () => {
      const interrupt = new Interrupt({ id: 'int-1', name: 'test', reason: 'testing' })
      const nodeResult = new NodeResult({
        result: createTestAgentResult(),
        interrupts: [interrupt],
      })

      const dict = nodeResult.toDict()
      expect(dict.interrupts).toHaveLength(1)
      expect(dict.interrupts[0]!.id).toBe('int-1')

      const restored = NodeResult.fromDict(dict)
      expect(restored.interrupts).toHaveLength(1)
      expect(restored.interrupts[0]!.id).toBe('int-1')
      expect(restored.interrupts[0]!.name).toBe('test')
    })

    it('throws on unsupported result type', () => {
      const badData = {
        result: { type: 'unknown' },
        executionTime: 0,
        status: 'pending',
        accumulatedUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        accumulatedMetrics: { latencyMs: 0 },
        executionCount: 0,
        interrupts: [],
      }

      expect(() => NodeResult.fromDict(badData as never)).toThrow('unsupported result type')
    })

    it('deserializes agentResult with omitted interrupts and content', () => {
      const nodeData = {
        result: {
          type: 'agentResult',
          stopReason: 'endTurn' as const,
          lastMessage: { role: 'assistant' as const, content: undefined },
          metrics: undefined,
          interrupts: undefined,
        },
        executionTime: 0,
        status: 'completed',
        accumulatedUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        accumulatedMetrics: { latencyMs: 0 },
        executionCount: 0,
        interrupts: undefined,
      }

      const restored = NodeResult.fromDict(nodeData as never)
      expect(restored.result).toBeInstanceOf(AgentResult)
      const agentResult = restored.result as AgentResult
      expect(agentResult.lastMessage.content).toStrictEqual([])
      expect(agentResult.interrupts).toStrictEqual([])
      expect(restored.interrupts).toStrictEqual([])
    })
  })
})

describe('MultiAgentResult', () => {
  it('initializes with defaults', () => {
    const result = new MultiAgentResult()

    expect(result.status).toBe(Status.PENDING)
    expect(result.results).toStrictEqual({})
    expect(result.accumulatedUsage).toStrictEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    expect(result.accumulatedMetrics).toStrictEqual({ latencyMs: 0 })
    expect(result.executionCount).toBe(0)
    expect(result.executionTime).toBe(0)
    expect(result.interrupts).toStrictEqual([])
  })

  it('initializes with custom values', () => {
    const agentResult = createTestAgentResult()
    const nodeResult = new NodeResult({ result: agentResult })
    const usage = { inputTokens: 50, outputTokens: 100, totalTokens: 150 }
    const metrics = { latencyMs: 200 }

    const result = new MultiAgentResult({
      status: Status.COMPLETED,
      results: { test_node: nodeResult },
      accumulatedUsage: usage,
      accumulatedMetrics: metrics,
      executionCount: 3,
      executionTime: 300,
    })

    expect(result.status).toBe(Status.COMPLETED)
    expect(result.results).toStrictEqual({ test_node: nodeResult })
    expect(result.accumulatedUsage).toStrictEqual(usage)
    expect(result.accumulatedMetrics).toStrictEqual(metrics)
    expect(result.executionCount).toBe(3)
    expect(result.executionTime).toBe(300)
  })

  it('creates independent usage/metrics instances by default', () => {
    const result1 = new MultiAgentResult()
    const result2 = new MultiAgentResult()

    result1.accumulatedUsage.inputTokens = 200
    result1.accumulatedMetrics.latencyMs = 500
    expect(result2.accumulatedUsage.inputTokens).toBe(0)
    expect(result2.accumulatedMetrics.latencyMs).toBe(0)
  })

  describe('toDict / fromDict', () => {
    it('round-trips successfully', () => {
      const nodeResult = new NodeResult({ result: createTestAgentResult() })
      const result = new MultiAgentResult({
        status: Status.COMPLETED,
        results: { test_node: nodeResult },
        executionTime: 200,
      })

      const dict = result.toDict()
      expect(dict.type).toBe('multiAgentResult')
      expect(dict.status).toBe('completed')
      expect(dict.executionTime).toBe(200)
      expect(dict.results['test_node']).toBeDefined()

      const restored = MultiAgentResult.fromDict(dict)
      expect(restored.status).toBe(Status.COMPLETED)
      expect(restored.executionTime).toBe(200)
      expect(Object.keys(restored.results)).toContain('test_node')
    })

    it('throws on wrong type discriminator', () => {
      expect(() => MultiAgentResult.fromDict({ type: 'wrong' } as never)).toThrow('unexpected type')
    })

    it('fromDict uses defaults when results and interrupts omitted', () => {
      const restored = MultiAgentResult.fromDict({
        type: 'multiAgentResult',
        status: Status.PENDING,
      } as never)

      expect(restored.status).toBe(Status.PENDING)
      expect(restored.results).toStrictEqual({})
      expect(restored.interrupts).toStrictEqual([])
    })

    it('round-trips with interrupts', () => {
      const interrupt = new Interrupt({ id: 'i-1', name: 'confirm', reason: 'need approval', response: null })
      const result = new MultiAgentResult({
        status: Status.INTERRUPTED,
        results: {},
        interrupts: [interrupt],
      })

      const dict = result.toDict()
      expect(dict.interrupts).toHaveLength(1)
      expect(dict.interrupts![0]).toStrictEqual(interrupt.toDict())

      const restored = MultiAgentResult.fromDict(dict)
      expect(restored.interrupts).toHaveLength(1)
      const firstInterrupt = restored.interrupts[0]
      expect(firstInterrupt).toBeDefined()
      expect(firstInterrupt!.id).toBe('i-1')
      expect(firstInterrupt!.name).toBe('confirm')
    })
  })
})

describe('MultiAgentBase', () => {
  it('cannot be instantiated directly', () => {
    // MultiAgentBase is abstract — attempting to instantiate would be a compile error.
    // We verify the pattern works by testing a concrete subclass.
    const instance = createTestMultiAgentBase()
    expect(instance).toBeInstanceOf(MultiAgentBase)
  })

  it('invoke delegates to stream and returns result', async () => {
    const expectedResult = new MultiAgentResult({ status: Status.COMPLETED })
    const instance = createTestMultiAgentBase(expectedResult)

    const result = await instance.invoke('test task')
    expect(result).toBe(expectedResult)
    expect(result.status).toBe(Status.COMPLETED)
  })

  it('invoke consumes all yielded events', async () => {
    const expectedResult = new MultiAgentResult({ status: Status.COMPLETED })
    const events: MultiAgentStreamEvent[] = []

    const instance = new (class extends MultiAgentBase {
      readonly id = 'test'

      async *stream(): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult> {
        const event = new MultiAgentNodeStartEvent({ nodeId: 'node1', nodeType: 'agent' })
        events.push(event)
        yield event
        return expectedResult
      }

      serializeState(): Record<string, unknown> {
        return {}
      }

      deserializeState(_payload: Record<string, unknown>): void {
        // no-op
      }
    })()

    const result = await instance.invoke('test')
    expect(result).toBe(expectedResult)
    expect(events).toHaveLength(1)
  })
})

describe('Streaming Events', () => {
  it('MultiAgentNodeStartEvent has correct type discriminator', () => {
    const event = new MultiAgentNodeStartEvent({ nodeId: 'node1', nodeType: 'agent' })
    expect(event.type).toBe('multiAgentNodeStartEvent')
    expect(event.nodeId).toBe('node1')
    expect(event.nodeType).toBe('agent')
  })

  it('MultiAgentNodeStopEvent has correct type discriminator', () => {
    const nodeResult = new NodeResult({ result: createTestAgentResult(), status: Status.COMPLETED })
    const event = new MultiAgentNodeStopEvent({ nodeId: 'node1', nodeResult })
    expect(event.type).toBe('multiAgentNodeStopEvent')
    expect(event.nodeId).toBe('node1')
    expect(event.nodeResult).toBe(nodeResult)
  })

  it('MultiAgentNodeInputEvent has correct type discriminator', () => {
    const input = [new TextBlock('task context')]
    const event = new MultiAgentNodeInputEvent({ nodeId: 'node1', input })
    expect(event.type).toBe('multiAgentNodeInputEvent')
    expect(event.nodeId).toBe('node1')
    expect(event.input).toBe(input)
  })

  it('MultiAgentNodeStreamEvent wraps agent event', () => {
    const agentEvent = { type: 'modelMessageStartEvent', role: 'assistant' }
    const event = new MultiAgentNodeStreamEvent({ nodeId: 'node1', event: agentEvent })
    expect(event.type).toBe('multiAgentNodeStreamEvent')
    expect(event.nodeId).toBe('node1')
    expect(event.event).toBe(agentEvent)
  })

  it('MultiAgentHandoffEvent supports single handoff', () => {
    const event = new MultiAgentHandoffEvent({
      fromNodeIds: ['agent_a'],
      toNodeIds: ['agent_b'],
      message: 'Need calculations',
    })
    expect(event.type).toBe('multiAgentHandoffEvent')
    expect(event.fromNodeIds).toStrictEqual(['agent_a'])
    expect(event.toNodeIds).toStrictEqual(['agent_b'])
    expect(event.message).toBe('Need calculations')
  })

  it('MultiAgentHandoffEvent supports batch transition without message', () => {
    const event = new MultiAgentHandoffEvent({
      fromNodeIds: ['node1', 'node2'],
      toNodeIds: ['node3', 'node4'],
    })
    expect(event.message).toBeUndefined()
  })

  it('MultiAgentNodeCancelEvent has correct properties', () => {
    const event = new MultiAgentNodeCancelEvent({ nodeId: 'node1', message: 'cancelled by user' })
    expect(event.type).toBe('multiAgentNodeCancelEvent')
    expect(event.nodeId).toBe('node1')
    expect(event.message).toBe('cancelled by user')
  })

  it('MultiAgentNodeInterruptEvent carries interrupts', () => {
    const interrupt = new Interrupt({ id: 'int-1', name: 'approval', reason: 'needs review' })
    const event = new MultiAgentNodeInterruptEvent({ nodeId: 'node1', interrupts: [interrupt] })
    expect(event.type).toBe('multiAgentNodeInterruptEvent')
    expect(event.interrupts).toHaveLength(1)
    expect(event.interrupts[0]!.name).toBe('approval')
  })

  it('MultiAgentResultEvent wraps final result', () => {
    const result = new MultiAgentResult({ status: Status.COMPLETED })
    const event = new MultiAgentResultEvent({ result })
    expect(event.type).toBe('multiAgentResultEvent')
    expect(event.result).toBe(result)
  })
})

describe('Hook Events', () => {
  it('MultiAgentInitializedEvent has correct type', () => {
    const source = createTestMultiAgentBase()
    const event = new MultiAgentInitializedEvent({ source })
    expect(event.type).toBe('multiAgentInitializedEvent')
    expect(event.source).toBe(source)
  })

  it('BeforeMultiAgentInvocationEvent has correct type', () => {
    const source = createTestMultiAgentBase()
    const event = new BeforeMultiAgentInvocationEvent({ source })
    expect(event.type).toBe('beforeMultiAgentInvocationEvent')
    expect(event.source).toBe(source)
  })

  it('AfterMultiAgentInvocationEvent reverses callbacks', () => {
    const source = createTestMultiAgentBase()
    const event = new AfterMultiAgentInvocationEvent({ source })
    expect(event.type).toBe('afterMultiAgentInvocationEvent')
    expect(event._shouldReverseCallbacks()).toBe(true)
  })

  it('BeforeNodeCallEvent has correct properties', () => {
    const source = createTestMultiAgentBase()
    const event = new BeforeNodeCallEvent({ source, nodeId: 'node1' })
    expect(event.type).toBe('beforeNodeCallEvent')
    expect(event.nodeId).toBe('node1')
    expect(event.cancelNode).toBe(false)
  })

  it('BeforeNodeCallEvent.cancelNode can be set to string', () => {
    const source = createTestMultiAgentBase()
    const event = new BeforeNodeCallEvent({ source, nodeId: 'node1' })
    event.cancelNode = 'user cancelled'
    expect(event.cancelNode).toBe('user cancelled')
  })

  it('BeforeNodeCallEvent.interrupt() generates deterministic ID', () => {
    const source = createTestMultiAgentBase()
    source._interruptState = new InterruptState()

    const event = new BeforeNodeCallEvent({ source, nodeId: 'node1' })

    expect(() => event.interrupt('approval', 'needs review')).toThrow('Interrupt raised: approval')

    // Verify interrupt was added to state
    expect(source._interruptState.interrupts.size).toBe(1)
    const interrupt = [...source._interruptState.interrupts.values()][0]!
    expect(interrupt.name).toBe('approval')
    expect(interrupt.reason).toBe('needs review')
    expect(interrupt.id).toMatch(/^v1:before_node_call:/)
  })

  it('BeforeNodeCallEvent.interrupt() returns response when resuming', () => {
    const source = createTestMultiAgentBase()
    source._interruptState = new InterruptState()

    const event = new BeforeNodeCallEvent({ source, nodeId: 'node1' })

    // First call raises exception
    try {
      event.interrupt('approval', 'needs review')
    } catch {
      // expected
    }

    // Set response on the interrupt
    const interrupt = [...source._interruptState.interrupts.values()][0]!
    interrupt.response = 'approved'

    // Second call returns response
    const response = event.interrupt('approval', 'needs review')
    expect(response).toBe('approved')
  })

  it('BeforeNodeCallEvent.interrupt() throws when no interrupt state', () => {
    const source = { id: 'no-state' } as MultiAgentBase
    const event = new BeforeNodeCallEvent({ source, nodeId: 'node1' })

    expect(() => event.interrupt('test')).toThrow('interrupt() requires a MultiAgentBase instance with interrupt state')
  })

  it('AfterNodeCallEvent reverses callbacks', () => {
    const source = createTestMultiAgentBase()
    const event = new AfterNodeCallEvent({ source, nodeId: 'node1' })
    expect(event.type).toBe('afterNodeCallEvent')
    expect(event.nodeId).toBe('node1')
    expect(event._shouldReverseCallbacks()).toBe(true)
  })

  it('BeforeMultiAgentInvocationEvent and AfterMultiAgentInvocationEvent accept invocationState', () => {
    const source = createTestMultiAgentBase()
    const state = { requestId: 'req-1', userId: 'u1' }
    const before = new BeforeMultiAgentInvocationEvent({ source, invocationState: state })
    const after = new AfterMultiAgentInvocationEvent({ source, invocationState: state })
    expect(before.invocationState).toStrictEqual(state)
    expect(after.invocationState).toStrictEqual(state)
  })

  it('BeforeNodeCallEvent and AfterNodeCallEvent accept invocationState', () => {
    const source = createTestMultiAgentBase()
    const state = { requestId: 'req-1' }
    const before = new BeforeNodeCallEvent({ source, nodeId: 'n1', invocationState: state })
    const after = new AfterNodeCallEvent({ source, nodeId: 'n1', invocationState: state })
    expect(before.invocationState).toStrictEqual(state)
    expect(after.invocationState).toStrictEqual(state)
  })

  it('hook events have undefined invocationState when not provided', () => {
    const source = createTestMultiAgentBase()
    const before = new BeforeMultiAgentInvocationEvent({ source })
    const nodeBefore = new BeforeNodeCallEvent({ source, nodeId: 'n1' })
    expect(before.invocationState).toBeUndefined()
    expect(nodeBefore.invocationState).toBeUndefined()
  })
})
