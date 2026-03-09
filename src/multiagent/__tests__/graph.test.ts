import { describe, expect, it } from 'vitest'
import { Agent } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { TextBlock } from '../../types/messages.js'
import { AgentNode } from '../nodes.js'
import { Graph } from '../graph.js'
import { Status } from '../state.js'

function makeNode(id: string, reply: string): AgentNode {
  const model = new MockMessageModel().addTurn(new TextBlock(reply))
  return new AgentNode({ agent: new Agent({ model, printer: false, agentId: id }) })
}

describe('Graph', () => {
  describe('constructor', () => {
    it('defaults id to "graph"', () => {
      const graph = new Graph({ nodes: [makeNode('a', 'hi')], edges: [] })
      expect(graph.id).toBe('graph')
    })

    it('accepts a custom id', () => {
      const graph = new Graph({ nodes: [makeNode('a', 'hi')], edges: [], id: 'my-graph' })
      expect(graph.id).toBe('my-graph')
    })

    it('throws on empty nodes', () => {
      expect(() => new Graph({ nodes: [], edges: [] })).toThrow('at least one node')
    })

    it('throws on duplicate node IDs', () => {
      expect(
        () =>
          new Graph({
            nodes: [makeNode('a', 'hi'), makeNode('a', 'bye')],
            edges: [],
          })
      ).toThrow('Duplicate node ID')
    })

    it('throws on invalid edge source', () => {
      expect(
        () =>
          new Graph({
            nodes: [makeNode('a', 'hi')],
            edges: [{ source: 'missing', target: 'a' }],
          })
      ).toThrow("source 'missing' not found")
    })

    it('throws on invalid edge target', () => {
      expect(
        () =>
          new Graph({
            nodes: [makeNode('a', 'hi')],
            edges: [{ source: 'a', target: 'missing' }],
          })
      ).toThrow("target 'missing' not found")
    })

    it('throws on invalid entry point', () => {
      expect(
        () =>
          new Graph({
            nodes: [makeNode('a', 'hi')],
            edges: [],
            entryPoints: ['missing'],
          })
      ).toThrow("Entry point 'missing' not found")
    })

    it('throws when all nodes have incoming edges and no entry points specified', () => {
      expect(
        () =>
          new Graph({
            nodes: [makeNode('a', 'hi'), makeNode('b', 'bye')],
            edges: [
              { source: 'a', target: 'b' },
              { source: 'b', target: 'a' },
            ],
          })
      ).toThrow('No entry points found')
    })

    it('auto-detects entry points', () => {
      const graph = new Graph({
        nodes: [makeNode('a', 'hi'), makeNode('b', 'bye')],
        edges: [{ source: 'a', target: 'b' }],
      })
      expect(graph.entryPoints).toEqual(['a'])
    })
  })

  describe('linear execution', () => {
    it('executes a single node', async () => {
      const result = await new Graph({ nodes: [makeNode('only', 'hello')], edges: [] }).invoke('go')

      expect(result.results).toHaveLength(1)
      expect(result.results[0]!.nodeId).toBe('only')
      expect(result.results[0]!.status).toBe(Status.COMPLETED)
    })

    it('executes nodes in dependency order', async () => {
      const result = await new Graph({
        nodes: [makeNode('a', 'first'), makeNode('b', 'second')],
        edges: [{ source: 'a', target: 'b' }],
      }).invoke('go')

      expect(result.results.map((r) => r.nodeId)).toEqual(['a', 'b'])
    })

    it('executes a three-node chain', async () => {
      const result = await new Graph({
        nodes: [makeNode('a', 'one'), makeNode('b', 'two'), makeNode('c', 'three')],
        edges: [
          { source: 'a', target: 'b' },
          { source: 'b', target: 'c' },
        ],
      }).invoke('go')

      expect(result.results.map((r) => r.nodeId)).toEqual(['a', 'b', 'c'])
    })
  })

  describe('result shape', () => {
    it('returns MultiAgentResult with status, results, duration', async () => {
      const result = await new Graph({ nodes: [makeNode('a', 'hello')], edges: [] }).invoke('go')

      expect(result.type).toBe('multiAgentResult')
      expect(result.status).toBe(Status.COMPLETED)
      expect(result.results).toHaveLength(1)
      expect(result.results[0]!.nodeId).toBe('a')
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe('parallel execution', () => {
    it('executes independent nodes in parallel', async () => {
      const result = await new Graph({
        nodes: [makeNode('a', 'one'), makeNode('b', 'two')],
        edges: [],
      }).invoke('go')

      const completed = result.results.filter((r) => r.status === Status.COMPLETED)
      expect(completed).toHaveLength(2)
      expect(completed.map((r) => r.nodeId)).toContain('a')
      expect(completed.map((r) => r.nodeId)).toContain('b')
    })

    it('fan-out: one node feeds two parallel nodes', async () => {
      const result = await new Graph({
        nodes: [makeNode('root', 'start'), makeNode('left', 'l'), makeNode('right', 'r')],
        edges: [
          { source: 'root', target: 'left' },
          { source: 'root', target: 'right' },
        ],
      }).invoke('go')

      expect(result.results[0]!.nodeId).toBe('root')
      const nodeIds = result.results.map((r) => r.nodeId)
      expect(nodeIds).toContain('left')
      expect(nodeIds).toContain('right')
      expect(result.results).toHaveLength(3)
    })

    it('fan-in: two nodes feed one node', async () => {
      const result = await new Graph({
        nodes: [makeNode('a', 'one'), makeNode('b', 'two'), makeNode('c', 'merged')],
        edges: [
          { source: 'a', target: 'c' },
          { source: 'b', target: 'c' },
        ],
      }).invoke('go')

      const nodeIds = result.results.map((r) => r.nodeId)
      expect(nodeIds).toContain('a')
      expect(nodeIds).toContain('b')
      expect(nodeIds[2]).toBe('c')
    })
  })

  describe('conditional edges', () => {
    it('skips nodes when edge condition returns false', async () => {
      const result = await new Graph({
        nodes: [makeNode('a', 'start'), makeNode('b', 'skipped')],
        edges: [{ source: 'a', target: 'b', handler: () => false }],
      }).invoke('go')

      expect(result.results).toHaveLength(1)
      expect(result.results[0]!.nodeId).toBe('a')
    })

    it('traverses edges when condition returns true', async () => {
      const result = await new Graph({
        nodes: [makeNode('a', 'start'), makeNode('b', 'reached')],
        edges: [{ source: 'a', target: 'b', handler: () => true }],
      }).invoke('go')

      expect(result.results.map((r) => r.nodeId)).toEqual(['a', 'b'])
    })
  })

  describe('execution limits', () => {
    it('throws when maxNodeExecutions is exceeded', async () => {
      const graph = new Graph({
        nodes: [makeNode('a', 'hi'), makeNode('b', 'bye')],
        edges: [{ source: 'a', target: 'b' }],
        maxNodeExecutions: 1,
      })

      await expect(graph.invoke('go')).rejects.toThrow('Max node executions reached')
    })
  })

  describe('streaming', () => {
    it('yields lifecycle events during execution', async () => {
      const { items } = await collectGenerator(new Graph({ nodes: [makeNode('a', 'hello')], edges: [] }).stream('go'))

      const eventTypes = items.map((e) => e.type)
      expect(eventTypes[0]).toBe('beforeMultiAgentInvocationEvent')
      expect(eventTypes).toContain('nodeStreamUpdateEvent')
      expect(eventTypes).toContain('nodeResultEvent')
      expect(eventTypes).toContain('afterMultiAgentInvocationEvent')
      expect(eventTypes).toContain('multiAgentResultEvent')
    })

    it('yields handoff events between batches', async () => {
      const { items } = await collectGenerator(
        new Graph({
          nodes: [makeNode('a', 'first'), makeNode('b', 'second')],
          edges: [{ source: 'a', target: 'b' }],
        }).stream('go')
      )

      const handoffs = items.filter((e) => e.type === 'multiAgentHandoffEvent')
      expect(handoffs).toHaveLength(1)
    })
  })

  describe('error handling', () => {
    it('captures node failures in results', async () => {
      const model = new MockMessageModel().addTurn(new Error('boom'))
      const failAgent = new Agent({ model, printer: false, agentId: 'fail' })
      const result = await new Graph({
        nodes: [new AgentNode({ agent: failAgent })],
        edges: [],
      }).invoke('go')

      expect(result.results.filter((r) => r.status === Status.FAILED)).toHaveLength(1)
    })
  })
})
