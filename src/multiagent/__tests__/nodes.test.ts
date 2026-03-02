import { beforeEach, describe, expect, it } from 'vitest'
import { Agent } from '../../agent/agent.js'
import type { InvokeArgs } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { TextBlock } from '../../types/messages.js'
import { MultiAgentResult, NodeResult, Status } from '../state.js'
import type { MultiAgentStreamEvent } from '../events.js'
import { MultiAgentHandoffEvent, NodeStreamUpdateEvent } from '../events.js'
import { AgentNode, MultiAgentNode, Node } from '../nodes.js'
import type { MultiAgentBase } from '../base.js'
import type { NodeResultUpdate } from '../state.js'

/**
 * Concrete Node subclass for testing the abstract base class.
 */
class TestNode extends Node {
  private readonly _fn: (args: InvokeArgs) => AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined>

  constructor(
    id: string,
    fn: (args: InvokeArgs) => AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined>
  ) {
    super(id, {})
    this._fn = fn
  }

  async *handle(args: InvokeArgs): AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined> {
    return yield* this._fn(args)
  }
}

describe('Node', () => {
  describe('stream', () => {
    it('returns COMPLETED NodeResult on successful execution', async () => {
      const content = [new TextBlock('result')]
      // eslint-disable-next-line require-yield
      const node = new TestNode('test-node', async function* () {
        return { content }
      })

      const { result } = await collectGenerator(node.stream([]))

      expect(result).toEqual({
        type: 'nodeResult',
        nodeId: 'test-node',
        status: Status.COMPLETED,
        content,
        terminus: false,
        duration: expect.any(Number),
      })
    })

    it('catches errors and returns FAILED NodeResult', async () => {
      // eslint-disable-next-line require-yield
      const node = new TestNode('fail-node', async function* () {
        throw new Error('boom')
      })

      const { result } = await collectGenerator(node.stream([]))

      expect(result).toEqual({
        type: 'nodeResult',
        nodeId: 'fail-node',
        status: Status.FAILED,
        content: [],
        terminus: false,
        duration: expect.any(Number),
        error: expect.objectContaining({ message: 'boom' }),
      })
    })
  })
})

describe('AgentNode', () => {
  let agent: Agent
  let node: AgentNode

  beforeEach(() => {
    const model = new MockMessageModel().addTurn(new TextBlock('reply'))
    agent = new Agent({ model, printer: false, state: { key1: 'value1' } })
    node = new AgentNode({ id: 'agent-1', agent })
  })

  describe('handle', () => {
    it('wraps agent events and returns content', async () => {
      const { items, result } = await collectGenerator(node.stream([new TextBlock('prompt')]))

      const streamEvents = items.filter((e) => e.type === 'nodeStreamUpdateEvent')
      expect(streamEvents.length).toBeGreaterThan(0)
      for (const event of streamEvents) {
        expect(event).toEqual(
          expect.objectContaining({ type: 'nodeStreamUpdateEvent', nodeId: 'agent-1', nodeType: 'agentNode' })
        )
      }

      const resultEvent = items.find((e) => e.type === 'nodeResultEvent')
      expect(resultEvent).toEqual(
        expect.objectContaining({ type: 'nodeResultEvent', nodeId: 'agent-1', nodeType: 'agentNode', result })
      )

      expect(result).toEqual({
        type: 'nodeResult',
        nodeId: 'agent-1',
        status: Status.COMPLETED,
        content: expect.arrayContaining([expect.objectContaining({ type: 'textBlock', text: 'reply' })]),
        terminus: false,
        duration: expect.any(Number),
      })
    })

    it('restores agent messages and state after execution', async () => {
      const messagesBefore = [...agent.messages]
      const stateBefore = agent.state.getAll()

      await collectGenerator(node.stream([new TextBlock('prompt')]))

      expect(agent.messages).toStrictEqual(messagesBefore)
      expect(agent.state.getAll()).toStrictEqual(stateBefore)
    })
  })

  describe('agent', () => {
    it('exposes the wrapped agent instance', () => {
      expect(node.agent).toBe(agent)
    })
  })
})

describe('MultiAgentNode', () => {
  const content = [new TextBlock('inner-result')]

  /**
   * Creates a mock orchestrator that yields the given events and returns a result with the given content.
   */
  function mockOrchestrator(id: string, events: MultiAgentStreamEvent[]): MultiAgentBase {
    return {
      id,
      invoke: async () => new MultiAgentResult({ results: [], duration: 0 }),
      async *stream() {
        for (const event of events) {
          yield event
        }
        return new MultiAgentResult({
          results: [new NodeResult({ nodeId: id, status: Status.COMPLETED, duration: 0, content, terminus: true })],
          duration: 0,
        })
      },
    }
  }

  let node: MultiAgentNode

  beforeEach(() => {
    const orchestrator = mockOrchestrator('inner', [])
    node = new MultiAgentNode({ orchestrator })
  })

  describe('handle', () => {
    it('passes through inner NodeStreamUpdateEvents', async () => {
      const innerUpdate = new MultiAgentHandoffEvent({ source: 'x', targets: ['y'] })
      const innerEvent = new NodeStreamUpdateEvent({
        nodeId: 'deep-node',
        nodeType: 'agentNode',
        event: innerUpdate,
      })
      const orchestrator = mockOrchestrator('inner', [innerEvent])
      node = new MultiAgentNode({ orchestrator })

      const { items } = await collectGenerator(node.stream([]))

      const streamEvents = items.filter((e) => e.type === 'nodeStreamUpdateEvent') as NodeStreamUpdateEvent[]
      const passthrough = streamEvents.find((e) => e.nodeId === 'deep-node')
      expect(passthrough).toBe(innerEvent)
    })

    it('wraps non-NodeStreamUpdateEvents with this node identity', async () => {
      const handoff = new MultiAgentHandoffEvent({ source: 'a', targets: ['b'] })
      const orchestrator = mockOrchestrator('inner', [handoff])
      node = new MultiAgentNode({ orchestrator })

      const { items } = await collectGenerator(node.stream([]))

      const streamEvents = items.filter((e) => e.type === 'nodeStreamUpdateEvent') as NodeStreamUpdateEvent[]
      const wrapped = streamEvents.find((e) => e.nodeId === 'inner' && e.event === handoff)
      expect(wrapped).toBeDefined()
      expect(wrapped!.nodeType).toBe('multiAgentNode')
    })

    it('returns orchestrator content', async () => {
      const { result } = await collectGenerator(node.stream([]))

      expect(result).toEqual(
        expect.objectContaining({
          nodeId: 'inner',
          status: Status.COMPLETED,
          content,
        })
      )
    })
  })

  describe('orchestrator', () => {
    it('exposes the wrapped orchestrator instance', () => {
      const orchestrator = mockOrchestrator('test', [])
      node = new MultiAgentNode({ orchestrator })
      expect(node.orchestrator).toBe(orchestrator)
    })
  })
})
