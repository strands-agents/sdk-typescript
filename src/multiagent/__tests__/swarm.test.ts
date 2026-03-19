import { describe, expect, it, vi } from 'vitest'
import { Agent } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { BeforeNodeCallEvent, MultiAgentInitializedEvent } from '../events.js'
import type { JSONValue } from '../../types/json.js'
import { TextBlock } from '../../types/messages.js'
import { Status, MultiAgentState } from '../state.js'
import { AgentNode } from '../nodes.js'
import { Swarm } from '../swarm.js'

/**
 * Creates an agent that produces a structured output handoff via the strands_structured_output tool.
 * The model returns a toolUseBlock with the handoff payload, then a text block to finish.
 */
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

/**
 * Creates a simple agent that produces a final response (no handoff).
 */
function createFinalAgent(agentId: string, message: string, description: string = `Agent ${agentId}`): Agent {
  return createHandoffAgent(agentId, { message }, description)
}

describe('Swarm', () => {
  describe('constructor', () => {
    it('defaults id to "swarm"', () => {
      const swarm = new Swarm({
        nodes: [createFinalAgent('a', 'hi')],
        start: 'a',
      })
      expect(swarm.id).toBe('swarm')
    })

    it('accepts a custom id', () => {
      const swarm = new Swarm({
        nodes: [createFinalAgent('a', 'hi')],
        start: 'a',
        id: 'my-swarm',
      })
      expect(swarm.id).toBe('my-swarm')
    })

    it('accepts AgentNodeOptions with per-node config', () => {
      const swarm = new Swarm({
        nodes: [{ agent: createFinalAgent('a', 'hi') }],
        start: 'a',
      })
      expect(swarm.nodes.get('a')).toBeInstanceOf(AgentNode)
    })

    it('defaults start to the first node when not specified', () => {
      const swarm = new Swarm({
        nodes: [createFinalAgent('first', 'hi'), createFinalAgent('second', 'bye')],
      })

      expect(swarm.start.id).toBe('first')
    })

    it('throws when start references unknown agent', () => {
      expect(
        () =>
          new Swarm({
            nodes: [createFinalAgent('a', 'hi')],
            start: 'missing',
          })
      ).toThrow('start=<missing> | start references unknown agent')
    })

    it('throws when nodes list is empty', () => {
      expect(() => new Swarm({ nodes: [] })).toThrow('nodes list is empty')
    })

    it('throws on duplicate agent ids', () => {
      const agent = createFinalAgent('a', 'hi')
      expect(
        () =>
          new Swarm({
            nodes: [agent, agent],
            start: 'a',
          })
      ).toThrow('agent_id=<a> | duplicate agent id')
    })

    it('throws when maxSteps < 1', () => {
      expect(
        () =>
          new Swarm({
            nodes: [createFinalAgent('a', 'hi')],
            start: 'a',
            maxSteps: 0,
          })
      ).toThrow('max_steps=<0> | must be at least 1')
    })
  })

  describe('invoke', () => {
    it('returns completed result with content and duration', async () => {
      const swarm = new Swarm({
        nodes: [createFinalAgent('a', 'final answer')],
        start: 'a',
      })

      const result = await swarm.invoke('hello')

      expect(result).toEqual(
        expect.objectContaining({
          status: Status.COMPLETED,
          duration: expect.any(Number),
          content: expect.arrayContaining([expect.objectContaining({ type: 'textBlock', text: 'Done' })]),
        })
      )
      expect(result.results.map((r) => r.nodeId)).toStrictEqual(['a'])
    })

    it('hands off from A to B and returns final output', async () => {
      const swarm = new Swarm({
        nodes: [
          createHandoffAgent('a', { agentId: 'b', message: 'please handle this' }),
          createFinalAgent('b', 'done by b'),
        ],
        start: 'a',
      })

      const result = await swarm.invoke('start')

      expect(result.status).toBe(Status.COMPLETED)
      expect(result.results.map((r) => r.nodeId)).toStrictEqual(['a', 'b'])
    })

    it('chains handoffs across multiple agents (A → B → C)', async () => {
      const swarm = new Swarm({
        nodes: [
          createHandoffAgent('a', { agentId: 'b', message: 'go to b' }),
          createHandoffAgent('b', { agentId: 'c', message: 'go to c' }),
          createFinalAgent('c', 'final from c'),
        ],
        start: 'a',
      })

      const result = await swarm.invoke('start')

      expect(result.status).toBe(Status.COMPLETED)
      expect(result.results.map((r) => r.nodeId)).toStrictEqual(['a', 'b', 'c'])
    })

    it('passes serialized context in handoff input', async () => {
      const contextData = { key: 'value', num: 42 }
      const agentB = createFinalAgent('b', 'done')
      const streamSpy = vi.spyOn(agentB, 'stream')

      const swarm = new Swarm({
        nodes: [createHandoffAgent('a', { agentId: 'b', message: 'handle this', context: contextData }), agentB],
        start: 'a',
      })

      await swarm.invoke('start')

      expect(streamSpy).toHaveBeenCalled()
      const args = streamSpy.mock.calls[0]![0] as TextBlock[]
      const texts = args.map((b) => b.text)
      expect(texts).toContainEqual('handle this')
      expect(texts).toContainEqual(expect.stringContaining(JSON.stringify(contextData, null, 2)))
    })

    it('excludes current agent from handoff schema', async () => {
      const agentA = createHandoffAgent('a', { agentId: 'b', message: 'go to b' })
      const agentB = createFinalAgent('b', 'done')
      const streamSpyA = vi.spyOn(agentA, 'stream')
      const streamSpyB = vi.spyOn(agentB, 'stream')

      const swarm = new Swarm({
        nodes: [agentA, agentB],
        start: 'a',
      })

      await swarm.invoke('start')

      // Agent A's handoff schema allows B but rejects A
      const schemaA = streamSpyA.mock.calls[0]![1]!.structuredOutputSchema!
      expect(schemaA.parse({ agentId: 'b', message: 'ok' })).toStrictEqual({ agentId: 'b', message: 'ok' })
      expect(() => schemaA.parse({ agentId: 'a', message: 'ok' })).toThrow()

      // Agent B's handoff schema allows A but rejects B
      const schemaB = streamSpyB.mock.calls[0]![1]!.structuredOutputSchema!
      expect(schemaB.parse({ agentId: 'a', message: 'ok' })).toStrictEqual({ agentId: 'a', message: 'ok' })
      expect(() => schemaB.parse({ agentId: 'b', message: 'ok' })).toThrow()
    })

    it('throws when maxSteps is exceeded', async () => {
      const swarm = new Swarm({
        nodes: [createHandoffAgent('a', { agentId: 'b', message: 'to b' }), createFinalAgent('b', 'done')],
        start: 'a',
        maxSteps: 1,
      })

      await expect(swarm.invoke('start')).rejects.toThrow('swarm reached step limit')
    })

    it('returns cancelled result with custom message when cancel is a string', async () => {
      const swarm = new Swarm({
        nodes: [createFinalAgent('a', 'hi')],
        start: 'a',
      })

      swarm.addHook(BeforeNodeCallEvent, (event: BeforeNodeCallEvent) => {
        event.cancel = 'agent not ready'
      })

      const { items, result } = await collectGenerator(swarm.stream('go'))

      expect(result.status).toBe(Status.CANCELLED)

      const cancelEvent = items.find((e) => e.type === 'nodeCancelEvent')
      expect(cancelEvent).toEqual(
        expect.objectContaining({ nodeId: 'a', state: expect.any(MultiAgentState), message: 'agent not ready' })
      )
    })

    it('returns failed result when agent throws', async () => {
      const model = new MockMessageModel().addTurn(new Error('agent exploded'))
      const agent = new Agent({ model, printer: false, id: 'a', description: 'Agent a' })

      const swarm = new Swarm({
        nodes: [{ agent }],
        start: 'a',
      })

      const result = await swarm.invoke('go')

      expect(result.status).toBe(Status.FAILED)
      expect(result.results).toHaveLength(1)
      expect(result.results[0]).toEqual(expect.objectContaining({ nodeId: 'a', status: Status.FAILED }))
    })

    it('calls initialize only once across invocations', async () => {
      let callCount = 0

      const swarm = new Swarm({
        nodes: [createFinalAgent('a', 'hi')],
        start: 'a',
      })

      swarm.addHook(MultiAgentInitializedEvent, () => {
        callCount++
      })

      await swarm.invoke('first')
      await swarm.invoke('second')

      expect(callCount).toBe(1)
    })

    it('preserves agent messages and state after execution', async () => {
      const agent = createFinalAgent('a', 'reply')
      const messagesBefore = [...agent.messages]
      const stateBefore = agent.appState.getAll()

      const swarm = new Swarm({
        nodes: [agent],
        start: 'a',
      })

      await swarm.invoke('hello')

      expect(agent.messages).toStrictEqual(messagesBefore)
      expect(agent.appState.getAll()).toStrictEqual(stateBefore)
    })
  })

  describe('stream', () => {
    it('yields lifecycle events in correct order for single agent', async () => {
      const swarm = new Swarm({
        nodes: [createFinalAgent('a', 'reply')],
        start: 'a',
      })

      const { items, result } = await collectGenerator(swarm.stream('go'))
      const eventTypes = items.map((e) => e.type)

      expect(result.status).toBe(Status.COMPLETED)
      expect(result.results.map((r) => r.nodeId)).toStrictEqual(['a'])
      expect(eventTypes).toStrictEqual([
        'beforeMultiAgentInvocationEvent',
        'beforeNodeCallEvent',
        // nodeStreamUpdateEvents from agent execution
        ...eventTypes.filter((t) => t === 'nodeStreamUpdateEvent'),
        'nodeResultEvent',
        'afterNodeCallEvent',
        'afterMultiAgentInvocationEvent',
        'multiAgentResultEvent',
      ])
    })

    it('yields handoff event between agents', async () => {
      const swarm = new Swarm({
        nodes: [createHandoffAgent('a', { agentId: 'b', message: 'go' }), createFinalAgent('b', 'done')],
        start: 'a',
      })

      const { items } = await collectGenerator(swarm.stream('start'))
      const handoffEvents = items.filter((e) => e.type === 'multiAgentHandoffEvent')

      expect(handoffEvents).toHaveLength(1)
      expect(handoffEvents[0]).toEqual(
        expect.objectContaining({
          type: 'multiAgentHandoffEvent',
          source: 'a',
          targets: ['b'],
          state: expect.any(MultiAgentState),
        })
      )
    })

    it('returns cancelled result with default message when cancel is true', async () => {
      const swarm = new Swarm({
        nodes: [createFinalAgent('a', 'hi')],
        start: 'a',
      })

      swarm.addHook(BeforeNodeCallEvent, (event: BeforeNodeCallEvent) => {
        event.cancel = true
      })

      const { items, result } = await collectGenerator(swarm.stream('go'))

      expect(result.status).toBe(Status.CANCELLED)
      expect(result.results).toHaveLength(1)
      expect(result.results[0]).toEqual(expect.objectContaining({ nodeId: 'a', status: Status.CANCELLED, duration: 0 }))

      const cancelEvent = items.find((e) => e.type === 'nodeCancelEvent')
      expect(cancelEvent).toEqual(
        expect.objectContaining({ nodeId: 'a', state: expect.any(MultiAgentState), message: 'node cancelled by hook' })
      )
    })

    it('returns cancelled result with custom message when cancel is a string', async () => {
      const swarm = new Swarm({
        nodes: [createFinalAgent('a', 'hi')],
        start: 'a',
      })

      swarm.addHook(BeforeNodeCallEvent, (event: BeforeNodeCallEvent) => {
        event.cancel = 'agent not ready'
      })

      const { items, result } = await collectGenerator(swarm.stream('go'))

      expect(result.status).toBe(Status.CANCELLED)

      const cancelEvent = items.find((e) => e.type === 'nodeCancelEvent')
      expect(cancelEvent).toEqual(
        expect.objectContaining({ nodeId: 'a', state: expect.any(MultiAgentState), message: 'agent not ready' })
      )
    })
  })
})
