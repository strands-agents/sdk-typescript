import { beforeEach, describe, expect, it } from 'vitest'
import { Agent } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { TextBlock, ToolUseBlock } from '../../types/messages.js'
import { Swarm, SwarmNode, SharedContext, SwarmError } from '../swarm.js'

/**
 * Helper to create a simple agent that responds with text.
 */
function createTextAgent(text: string): Agent {
  const model = new MockMessageModel().addTurn(new TextBlock(text))
  return new Agent({ model, printer: false })
}

/**
 * Helper to create an agent that calls handoff_to_agent tool then the model ends.
 * The MockMessageModel in single-turn mode reuses the same turn, so we use multi-turn:
 * Turn 1: tool use (handoff_to_agent) → agent executes tool, sets pending handoff, model called again
 * Turn 2: text response (endTurn) → agent loop ends
 */
function createHandoffAgent(targetName: string, reason: string): Agent {
  const model = new MockMessageModel()
    .addTurn(
      new ToolUseBlock({
        name: 'handoff_to_agent',
        toolUseId: 'tool-1',
        input: { agent_name: targetName, reason },
      })
    )
    .addTurn(new TextBlock('handing off'))
  return new Agent({ model, printer: false })
}

describe('SharedContext', () => {
  let ctx: SharedContext

  beforeEach(() => {
    ctx = new SharedContext()
  })

  it('stores and retrieves values by namespace and key', () => {
    ctx.set('agent-1', 'key1', 'value1')
    expect(ctx.get('agent-1', 'key1')).toBe('value1')
  })

  it('returns undefined for missing keys', () => {
    expect(ctx.get('missing', 'key')).toBeUndefined()
  })

  it('returns empty map for missing namespace', () => {
    expect(ctx.getNamespace('missing').size).toBe(0)
  })

  it('serializes and deserializes', () => {
    ctx.set('ns1', 'a', 1)
    ctx.set('ns1', 'b', 'two')
    ctx.set('ns2', 'c', true)

    const json = ctx.toJSON()
    const restored = SharedContext.fromJSON(json)

    expect(restored.get('ns1', 'a')).toBe(1)
    expect(restored.get('ns1', 'b')).toBe('two')
    expect(restored.get('ns2', 'c')).toBe(true)
  })
})

describe('SwarmNode', () => {
  it('resets agent to initial state', async () => {
    const agent = createTextAgent('hello')
    const node = new SwarmNode('test', agent)

    await agent.invoke('prompt')
    expect(agent.messages.length).toBeGreaterThan(0)

    node.reset()
    expect(agent.messages.length).toBe(0)
  })
})

describe('Swarm', () => {
  describe('constructor', () => {
    it('throws if entry point not found', () => {
      const node = new SwarmNode('a', createTextAgent('hi'))
      expect(() => new Swarm([node], { entryPoint: 'missing' })).toThrow(SwarmError)
    })

    it('creates with valid entry point', () => {
      const node = new SwarmNode('a', createTextAgent('hi'))
      const swarm = new Swarm([node], { entryPoint: 'a' })
      expect(swarm.nodes.has('a')).toBe(true)
    })
  })

  describe('invoke', () => {
    it('completes when agent does not handoff', async () => {
      const node = new SwarmNode('agent-a', createTextAgent('I am done'))
      const swarm = new Swarm([node], { entryPoint: 'agent-a' })

      const result = await swarm.invoke('do something')

      expect(result.state.completed).toBe(true)
      expect(result.state.currentNode).toBe('agent-a')
      expect(result.state.nodeHistory).toEqual(['agent-a'])
      expect(result.metrics.totalHandoffs).toBe(0)
    })

    it('handles handoff between agents', async () => {
      const agentA = createHandoffAgent('agent-b', 'need specialist')
      const agentB = createTextAgent('specialist done')

      const nodeA = new SwarmNode('agent-a', agentA)
      const nodeB = new SwarmNode('agent-b', agentB)

      const swarm = new Swarm([nodeA, nodeB], { entryPoint: 'agent-a' })
      const result = await swarm.invoke('complex task')

      expect(result.state.completed).toBe(true)
      expect(result.state.nodeHistory).toEqual(['agent-a', 'agent-b'])
      expect(result.metrics.totalHandoffs).toBe(1)
    })
  })

  describe('stream', () => {
    it('yields NodeStreamUpdateEvent during execution', async () => {
      const node = new SwarmNode('a', createTextAgent('hello'))
      const swarm = new Swarm([node], { entryPoint: 'a' })

      const { items, result } = await collectGenerator(swarm.stream('task'))

      const streamEvents = items.filter((e) => e.type === 'nodeStreamUpdateEvent')
      expect(streamEvents.length).toBeGreaterThan(0)
      expect(result.state.completed).toBe(true)
    })

    it('yields MultiAgentHandoffEvent on handoff', async () => {
      const agentA = createHandoffAgent('b', 'handoff reason')
      const agentB = createTextAgent('done')

      const swarm = new Swarm([new SwarmNode('a', agentA), new SwarmNode('b', agentB)], { entryPoint: 'a' })

      const { items } = await collectGenerator(swarm.stream('task'))

      const handoffEvents = items.filter((e) => e.type === 'multiAgentHandoffEvent')
      expect(handoffEvents.length).toBe(1)
      expect(handoffEvents[0]).toEqual(expect.objectContaining({ source: 'a', targets: ['b'] }))
    })

    it('yields NodeResultEvent on completion', async () => {
      const node = new SwarmNode('a', createTextAgent('result'))
      const swarm = new Swarm([node], { entryPoint: 'a' })

      const { items } = await collectGenerator(swarm.stream('task'))

      const resultEvents = items.filter((e) => e.type === 'nodeResultEvent')
      expect(resultEvents.length).toBe(1)
    })

    it('yields MultiAgentResultEvent at end', async () => {
      const node = new SwarmNode('a', createTextAgent('done'))
      const swarm = new Swarm([node], { entryPoint: 'a' })

      const { items } = await collectGenerator(swarm.stream('task'))

      const resultEvents = items.filter((e) => e.type === 'multiAgentResultEvent')
      expect(resultEvents.length).toBe(1)
    })
  })

  describe('continuation checks', () => {
    /**
     * For continuation check tests, we need agents that can handoff repeatedly.
     * MockMessageModel in multi-turn mode exhausts turns, so we create fresh agents
     * for each node that have enough turns for the test scenario.
     */
    function makeHandoffAgent(target: string, turns: number): Agent {
      const model = new MockMessageModel()
      for (let i = 0; i < turns; i++) {
        model.addTurn(
          new ToolUseBlock({
            name: 'handoff_to_agent',
            toolUseId: `tool-${i}`,
            input: { agent_name: target, reason: 'keep going' },
          })
        )
        model.addTurn(new TextBlock('done'))
      }
      return new Agent({ model, printer: false })
    }

    it('throws SwarmError when max handoffs exceeded', async () => {
      const swarm = new Swarm(
        [new SwarmNode('a', makeHandoffAgent('b', 3)), new SwarmNode('b', makeHandoffAgent('a', 3))],
        { entryPoint: 'a', maxHandoffs: 2, repetitiveHandoffWindow: 0 }
      )

      await expect(swarm.invoke('task')).rejects.toThrow('Max handoffs reached: 2')
    })

    it('throws SwarmError when max iterations exceeded', async () => {
      const swarm = new Swarm(
        [new SwarmNode('a', makeHandoffAgent('b', 3)), new SwarmNode('b', makeHandoffAgent('a', 3))],
        { entryPoint: 'a', maxIterations: 2, maxHandoffs: 100, repetitiveHandoffWindow: 0 }
      )

      await expect(swarm.invoke('task')).rejects.toThrow('Max iterations reached: 2')
    })

    it('throws SwarmError on repetitive handoffs', async () => {
      const swarm = new Swarm(
        [new SwarmNode('a', makeHandoffAgent('b', 6)), new SwarmNode('b', makeHandoffAgent('a', 6))],
        {
          entryPoint: 'a',
          maxHandoffs: 100,
          maxIterations: 100,
          repetitiveHandoffWindow: 4,
          repetitiveHandoffMinUnique: 3,
        }
      )

      await expect(swarm.invoke('task')).rejects.toThrow('Repetitive handoff detected')
    })
  })

  describe('shared context', () => {
    it('stores handoff context in shared context', async () => {
      const model = new MockMessageModel()
        .addTurn(
          new ToolUseBlock({
            name: 'handoff_to_agent',
            toolUseId: 'tool-1',
            input: {
              agent_name: 'b',
              reason: 'need help',
              context: { finding: 'important data' },
            },
          })
        )
        .addTurn(new TextBlock('done'))

      const agentA = new Agent({ model, printer: false })
      const agentB = createTextAgent('got it')

      const sharedContext = new SharedContext()
      const swarm = new Swarm([new SwarmNode('a', agentA), new SwarmNode('b', agentB)], {
        entryPoint: 'a',
        sharedContext,
      })

      await swarm.invoke('task')

      expect(sharedContext.get('a', 'finding')).toBe('important data')
    })
  })

  describe('handoff_to_agent tool', () => {
    it('returns error for unknown agent', async () => {
      const model = new MockMessageModel()
        .addTurn(
          new ToolUseBlock({
            name: 'handoff_to_agent',
            toolUseId: 'tool-1',
            input: { agent_name: 'nonexistent', reason: 'test' },
          })
        )
        .addTurn(new TextBlock('ok'))

      const agent = new Agent({ model, printer: false })
      const swarm = new Swarm([new SwarmNode('a', agent)], { entryPoint: 'a' })

      // Should complete without handoff since the tool returns an error
      const result = await swarm.invoke('task')
      expect(result.state.completed).toBe(true)
      expect(result.metrics.totalHandoffs).toBe(0)
    })
  })

  describe('toJSON', () => {
    it('serializes swarm configuration', () => {
      const node = new SwarmNode('a', createTextAgent('hi'))
      const swarm = new Swarm([node], {
        entryPoint: 'a',
        maxHandoffs: 10,
        maxIterations: 20,
      })

      const json = swarm.toJSON()
      expect(json).toEqual(
        expect.objectContaining({
          entryPoint: 'a',
          maxHandoffs: 10,
          maxIterations: 20,
        })
      )
    })
  })
})
