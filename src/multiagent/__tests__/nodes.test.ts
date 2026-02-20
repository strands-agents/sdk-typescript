import { beforeEach, describe, expect, it } from 'vitest'
import { Agent } from '../../agent/agent.js'
import type { InvokeArgs } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { TextBlock } from '../../types/messages.js'
import { MultiAgentState, Status } from '../state.js'
import type { MultiAgentStreamEvent } from '../events.js'
import { AgentNode, Node } from '../nodes.js'
import type { NodeResultUpdate } from '../state.js'

/**
 * Concrete Node subclass for testing the abstract base class.
 */
class TestNode extends Node {
  private readonly _fn: (
    args: InvokeArgs,
    state: MultiAgentState
  ) => AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined>

  constructor(
    id: string,
    fn: (args: InvokeArgs, state: MultiAgentState) => AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined>
  ) {
    super(id)
    this._fn = fn
  }

  async *handle(
    args: InvokeArgs,
    state: MultiAgentState
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined> {
    return yield* this._fn(args, state)
  }
}

describe('Node', () => {
  let state: MultiAgentState

  beforeEach(() => {
    state = new MultiAgentState()
  })

  describe('stream', () => {
    it('returns COMPLETED NodeResult on successful execution', async () => {
      const content = [new TextBlock('result')]
      // eslint-disable-next-line require-yield
      const node = new TestNode('test-node', async function* () {
        return { content }
      })

      const { result } = await collectGenerator(node.stream([], state))

      expect(result).toEqual({
        type: 'nodeResult',
        nodeId: 'test-node',
        status: Status.COMPLETED,
        content,
        duration: expect.any(Number),
      })
    })

    it('catches errors and returns FAILED NodeResult', async () => {
      // eslint-disable-next-line require-yield
      const node = new TestNode('fail-node', async function* () {
        throw new Error('boom')
      })

      const { result } = await collectGenerator(node.stream([], state))

      expect(result).toEqual({
        type: 'nodeResult',
        nodeId: 'fail-node',
        status: Status.FAILED,
        content: [],
        duration: expect.any(Number),
        error: expect.objectContaining({ message: 'boom' }),
      })
    })
  })
})

describe('AgentNode', () => {
  let agent: Agent
  let node: AgentNode
  let state: MultiAgentState

  beforeEach(() => {
    const model = new MockMessageModel().addTurn(new TextBlock('reply'))
    agent = new Agent({ model, printer: false, state: { key1: 'value1' } })
    node = new AgentNode('agent-1', agent)
    state = new MultiAgentState()
  })

  describe('handle', () => {
    it('wraps agent events and returns content', async () => {
      const { items, result } = await collectGenerator(node.stream([new TextBlock('prompt')], state))

      expect(items.length).toBeGreaterThan(0)
      for (const event of items) {
        expect(event).toEqual(
          expect.objectContaining({ type: 'multiAgentNodeStreamEvent', nodeId: 'agent-1', nodeType: 'agentNode' })
        )
      }

      expect(result).toEqual({
        type: 'nodeResult',
        nodeId: 'agent-1',
        status: Status.COMPLETED,
        content: expect.arrayContaining([expect.objectContaining({ type: 'textBlock', text: 'reply' })]),
        duration: expect.any(Number),
      })
    })

    it('restores agent messages and state after execution', async () => {
      const messagesBefore = [...agent.messages]
      const stateBefore = agent.state.getAll()

      await collectGenerator(node.stream([new TextBlock('prompt')], state))

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
