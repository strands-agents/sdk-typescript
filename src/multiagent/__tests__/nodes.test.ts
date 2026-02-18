import { describe, expect, it } from 'vitest'
import { Agent } from '../../agent/agent.js'
import type { InvokeArgs } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { TextBlock } from '../../types/messages.js'
import { MultiAgentState } from '../base.js'
import { MultiAgentNodeStreamEvent } from '../events.js'
import { AgentNode, Node } from '../nodes.js'
import type { NodeResultUpdate } from '../results.js'
import { Status } from '../status.js'
import type { MultiAgentStreamEvent } from '../events.js'

/**
 * Concrete Node subclass for testing the abstract base class.
 */
class TestNode extends Node {
  private _fn!: (
    args: InvokeArgs,
    state: MultiAgentState
  ) => AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined>

  constructor(
    id: string,
    fn: (args: InvokeArgs, state: MultiAgentState) => AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined>
  ) {
    super(id)
    this.fn = fn
  }

  private set fn(
    value: (
      args: InvokeArgs,
      state: MultiAgentState
    ) => AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined>
  ) {
    this._fn = value
  }

  async *handle(
    args: InvokeArgs,
    state: MultiAgentState
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined> {
    return yield* this._fn(args, state)
  }
}

describe('Node', () => {
  it('returns COMPLETED NodeResult on successful execution', async () => {
    const content = [new TextBlock('result')]
    // eslint-disable-next-line require-yield
    const node = new TestNode('test-node', async function* () {
      return { content }
    })

    const { result } = await collectGenerator(node.stream([], new MultiAgentState()))

    expect(result.nodeId).toBe('test-node')
    expect(result.status).toBe(Status.COMPLETED)
    expect(result.content).toStrictEqual(content)
    expect(result.error).toBeUndefined()
  })

  it('catches errors and returns FAILED NodeResult', async () => {
    // eslint-disable-next-line require-yield
    const node = new TestNode('fail-node', async function* () {
      throw new Error('boom')
    })

    const { result } = await collectGenerator(node.stream([], new MultiAgentState()))

    expect(result.nodeId).toBe('fail-node')
    expect(result.status).toBe(Status.FAILED)
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error!.message).toBe('boom')
    expect(result.content).toStrictEqual([])
  })

  it('measures duration in seconds', async () => {
    // eslint-disable-next-line require-yield
    const node = new TestNode('slow-node', async function* () {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50))
      return { content: [new TextBlock('done')] }
    })

    const { result } = await collectGenerator(node.stream([], new MultiAgentState()))

    expect(result.duration).toBeGreaterThan(0)
    // Duration should be in seconds (not milliseconds)
    expect(result.duration).toBeLessThan(5)
  })

  it('measures duration even on failure', async () => {
    // eslint-disable-next-line require-yield
    const node = new TestNode('fail-slow', async function* () {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 20))
      throw new Error('delayed failure')
    })

    const { result } = await collectGenerator(node.stream([], new MultiAgentState()))

    expect(result.status).toBe(Status.FAILED)
    expect(result.duration).toBeGreaterThan(0)
  })
})

describe('AgentNode', () => {
  it('yields MultiAgentNodeStreamEvent for each agent event', async () => {
    const model = new MockMessageModel().addTurn(new TextBlock('hello'))
    const agent = new Agent({ model, printer: false })
    const node = new AgentNode('agent-1', agent)

    const { items } = await collectGenerator(node.stream([new TextBlock('prompt')], new MultiAgentState()))

    const streamEvents = items.filter((e) => e.type === 'multiAgentNodeStreamEvent')
    expect(streamEvents.length).toBeGreaterThan(0)
    for (const event of streamEvents) {
      expect(event).toBeInstanceOf(MultiAgentNodeStreamEvent)
      expect(event.nodeId).toBe('agent-1')
    }
  })

  it('returns content from the agent last message', async () => {
    const model = new MockMessageModel().addTurn(new TextBlock('response text'))
    const agent = new Agent({ model, printer: false })
    const node = new AgentNode('agent-2', agent)

    const { result } = await collectGenerator(node.stream([new TextBlock('prompt')], new MultiAgentState()))

    expect(result.status).toBe(Status.COMPLETED)
    expect(result.content).toStrictEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'textBlock', text: 'response text' })])
    )
  })

  it('snapshot/restore: agent messages unchanged after execution', async () => {
    const model = new MockMessageModel().addTurn(new TextBlock('reply'))
    const agent = new Agent({ model, printer: false })
    const messagesBefore = [...agent.messages]

    const node = new AgentNode('agent-3', agent)
    await collectGenerator(node.stream([new TextBlock('prompt')], new MultiAgentState()))

    expect(agent.messages).toStrictEqual(messagesBefore)
  })

  it('snapshot/restore: agent state unchanged after execution', async () => {
    const model = new MockMessageModel().addTurn(new TextBlock('reply'))
    const agent = new Agent({ model, printer: false, state: { key1: 'value1' } })
    const stateBefore = agent.state.getAll()

    const node = new AgentNode('agent-4', agent)
    await collectGenerator(node.stream([new TextBlock('prompt')], new MultiAgentState()))

    expect(agent.state.getAll()).toStrictEqual(stateBefore)
  })

  it('exposes the wrapped agent via getter', () => {
    const model = new MockMessageModel().addTurn(new TextBlock('hi'))
    const agent = new Agent({ model, printer: false })
    const node = new AgentNode('agent-5', agent)

    expect(node.agent).toBe(agent)
  })
})
