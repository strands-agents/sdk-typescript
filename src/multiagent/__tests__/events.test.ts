import { describe, expect, it } from 'vitest'
import {
  MultiAgentInitializedEvent,
  BeforeMultiAgentInvocationEvent,
  AfterMultiAgentInvocationEvent,
  BeforeNodeCallEvent,
  AfterNodeCallEvent,
  NodeStreamUpdateEvent,
  NodeResultEvent,
  NodeCancelEvent,
  MultiAgentHandoffEvent,
  MultiAgentResultEvent,
} from '../events.js'
import { MultiAgentResult, MultiAgentState, NodeResult, Status } from '../state.js'
import type { MultiAgentBase } from '../base.js'
import type { AgentStreamEvent } from '../../types/agent.js'

const mockOrchestrator: MultiAgentBase = {
  id: 'test-orchestrator',
  invoke: async () => new MultiAgentResult({ results: [], duration: 0 }),
  // eslint-disable-next-line require-yield
  async *stream() {
    return new MultiAgentResult({ results: [], duration: 0 })
  },
  addHook: () => () => {},
}

describe('MultiAgentInitializedEvent', () => {
  it('creates instance with correct properties', () => {
    const event = new MultiAgentInitializedEvent({ orchestrator: mockOrchestrator })

    expect(event).toEqual({
      type: 'multiAgentInitializedEvent',
      orchestrator: mockOrchestrator,
    })
    // @ts-expect-error verifying that property is readonly
    event.orchestrator = mockOrchestrator
  })

  it('returns false for _shouldReverseCallbacks', () => {
    const event = new MultiAgentInitializedEvent({ orchestrator: mockOrchestrator })
    expect(event._shouldReverseCallbacks()).toBe(false)
  })
})

describe('BeforeMultiAgentInvocationEvent', () => {
  it('creates instance with correct properties', () => {
    const state = new MultiAgentState()
    const event = new BeforeMultiAgentInvocationEvent({ orchestrator: mockOrchestrator, state })

    expect(event).toEqual({
      type: 'beforeMultiAgentInvocationEvent',
      orchestrator: mockOrchestrator,
      state,
    })
    // @ts-expect-error verifying that property is readonly
    event.orchestrator = mockOrchestrator
    // @ts-expect-error verifying that property is readonly
    event.state = state
  })

  it('returns false for _shouldReverseCallbacks', () => {
    const state = new MultiAgentState()
    const event = new BeforeMultiAgentInvocationEvent({ orchestrator: mockOrchestrator, state })
    expect(event._shouldReverseCallbacks()).toBe(false)
  })
})

describe('AfterMultiAgentInvocationEvent', () => {
  it('creates instance with correct properties', () => {
    const state = new MultiAgentState()
    const event = new AfterMultiAgentInvocationEvent({ orchestrator: mockOrchestrator, state })

    expect(event).toEqual({
      type: 'afterMultiAgentInvocationEvent',
      orchestrator: mockOrchestrator,
      state,
    })
    // @ts-expect-error verifying that property is readonly
    event.orchestrator = mockOrchestrator
    // @ts-expect-error verifying that property is readonly
    event.state = state
  })

  it('returns true for _shouldReverseCallbacks', () => {
    const state = new MultiAgentState()
    const event = new AfterMultiAgentInvocationEvent({ orchestrator: mockOrchestrator, state })
    expect(event._shouldReverseCallbacks()).toBe(true)
  })
})

describe('BeforeNodeCallEvent', () => {
  it('creates instance with correct properties', () => {
    const state = new MultiAgentState()
    const event = new BeforeNodeCallEvent({ orchestrator: mockOrchestrator, state, nodeId: 'node-1' })

    expect(event).toEqual({
      type: 'beforeNodeCallEvent',
      orchestrator: mockOrchestrator,
      state,
      nodeId: 'node-1',
      cancel: false,
    })
    // @ts-expect-error verifying that property is readonly
    event.orchestrator = mockOrchestrator
    // @ts-expect-error verifying that property is readonly
    event.state = state
    // @ts-expect-error verifying that property is readonly
    event.nodeId = 'node-1'
  })

  it('returns false for _shouldReverseCallbacks', () => {
    const state = new MultiAgentState()
    const event = new BeforeNodeCallEvent({ orchestrator: mockOrchestrator, state, nodeId: 'node-1' })
    expect(event._shouldReverseCallbacks()).toBe(false)
  })

  it('allows cancel to be set to true', () => {
    const state = new MultiAgentState()
    const event = new BeforeNodeCallEvent({ orchestrator: mockOrchestrator, state, nodeId: 'node-1' })

    expect(event.cancel).toBe(false)
    event.cancel = true
    expect(event.cancel).toBe(true)
  })

  it('allows cancel to be set to a string message', () => {
    const state = new MultiAgentState()
    const event = new BeforeNodeCallEvent({ orchestrator: mockOrchestrator, state, nodeId: 'node-1' })

    event.cancel = 'node is not ready'
    expect(event.cancel).toBe('node is not ready')
  })
})

describe('AfterNodeCallEvent', () => {
  it('creates instance with correct properties', () => {
    const state = new MultiAgentState()
    const error = new Error('node failed')
    const event = new AfterNodeCallEvent({ orchestrator: mockOrchestrator, state, nodeId: 'node-1', error })

    expect(event).toEqual({
      type: 'afterNodeCallEvent',
      orchestrator: mockOrchestrator,
      state,
      nodeId: 'node-1',
      error,
    })
    // @ts-expect-error verifying that property is readonly
    event.orchestrator = mockOrchestrator
    // @ts-expect-error verifying that property is readonly
    event.state = state
    // @ts-expect-error verifying that property is readonly
    event.nodeId = 'node-1'
  })

  it('returns true for _shouldReverseCallbacks', () => {
    const state = new MultiAgentState()
    const event = new AfterNodeCallEvent({ orchestrator: mockOrchestrator, state, nodeId: 'node-1' })
    expect(event._shouldReverseCallbacks()).toBe(true)
  })
})

describe('NodeStreamUpdateEvent', () => {
  it('creates instance with correct properties', () => {
    const state = new MultiAgentState()
    const innerEvent = { type: 'beforeInvocationEvent' } as AgentStreamEvent
    const event = new NodeStreamUpdateEvent({ nodeId: 'node-1', nodeType: 'agentNode', state, event: innerEvent })

    expect(event).toEqual({
      type: 'nodeStreamUpdateEvent',
      nodeId: 'node-1',
      nodeType: 'agentNode',
      state,
      event: innerEvent,
    })
    // @ts-expect-error verifying that property is readonly
    event.nodeId = 'node-1'
    // @ts-expect-error verifying that property is readonly
    event.nodeType = 'agentNode'
    // @ts-expect-error verifying that property is readonly
    event.state = state
    // @ts-expect-error verifying that property is readonly
    event.event = innerEvent
  })
})

describe('NodeResultEvent', () => {
  it('creates instance with correct properties', () => {
    const state = new MultiAgentState()
    const result = new NodeResult({ nodeId: 'node-1', status: Status.COMPLETED, duration: 100 })
    const event = new NodeResultEvent({ nodeId: 'node-1', nodeType: 'agentNode', state, result })

    expect(event).toEqual({
      type: 'nodeResultEvent',
      nodeId: 'node-1',
      nodeType: 'agentNode',
      state,
      result,
    })
    // @ts-expect-error verifying that property is readonly
    event.nodeId = 'node-1'
    // @ts-expect-error verifying that property is readonly
    event.nodeType = 'agentNode'
    // @ts-expect-error verifying that property is readonly
    event.state = state
    // @ts-expect-error verifying that property is readonly
    event.result = result
  })
})

describe('NodeCancelEvent', () => {
  it('creates instance with correct properties', () => {
    const state = new MultiAgentState()
    const event = new NodeCancelEvent({ nodeId: 'node-1', state, message: 'cancelled by hook' })

    expect(event).toEqual({
      type: 'nodeCancelEvent',
      nodeId: 'node-1',
      state,
      message: 'cancelled by hook',
    })
    // @ts-expect-error verifying that property is readonly
    event.nodeId = 'node-1'
    // @ts-expect-error verifying that property is readonly
    event.state = state
    // @ts-expect-error verifying that property is readonly
    event.message = 'cancelled by hook'
  })
})

describe('MultiAgentHandoffEvent', () => {
  it('creates instance with correct properties', () => {
    const state = new MultiAgentState()
    const event = new MultiAgentHandoffEvent({ source: 'node-a', targets: ['node-b', 'node-c'], state })

    expect(event).toEqual({
      type: 'multiAgentHandoffEvent',
      source: 'node-a',
      targets: ['node-b', 'node-c'],
      state,
    })
    // @ts-expect-error verifying that property is readonly
    event.source = 'node-a'
    // @ts-expect-error verifying that property is readonly
    event.targets = []
    // @ts-expect-error verifying that property is readonly
    event.state = state
  })
})

describe('MultiAgentResultEvent', () => {
  it('creates instance with correct properties', () => {
    const result = new MultiAgentResult({ results: [], duration: 0 })
    const event = new MultiAgentResultEvent({ result })

    expect(event).toEqual({
      type: 'multiAgentResultEvent',
      result,
    })
    // @ts-expect-error verifying that property is readonly
    event.result = result
  })
})
