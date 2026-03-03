import { describe, expect, it } from 'vitest'
import { Agent } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { TextBlock } from '../../types/messages.js'
import { AgentNode } from '../nodes.js'
import { Graph } from '../graph.js'

function makeAgent(reply: string): Agent {
  const model = new MockMessageModel().addTurn(new TextBlock(reply))
  return new Agent({ model, printer: false })
}

function makeNode(id: string, reply: string): AgentNode {
  return new AgentNode({ id, agent: makeAgent(reply) })
}

describe('Graph', () => {
  describe('constructor validation', () => {
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
      const graph = new Graph({
        nodes: [makeNode('only', 'hello')],
        edges: [],
      })

      const result = await graph.invoke('go')

      expect(result.completedNodes).toBe(1)
      expect(result.totalNodes).toBe(1)
      expect(result.executionOrder).toEqual(['only'])
    })

    it('executes nodes in dependency order', async () => {
      const graph = new Graph({
        nodes: [makeNode('a', 'first'), makeNode('b', 'second')],
        edges: [{ source: 'a', target: 'b' }],
      })

      const result = await graph.invoke('go')

      expect(result.executionOrder).toEqual(['a', 'b'])
      expect(result.completedNodes).toBe(2)
    })

    it('executes a three-node chain', async () => {
      const graph = new Graph({
        nodes: [makeNode('a', 'one'), makeNode('b', 'two'), makeNode('c', 'three')],
        edges: [
          { source: 'a', target: 'b' },
          { source: 'b', target: 'c' },
        ],
      })

      const result = await graph.invoke('go')

      expect(result.executionOrder).toEqual(['a', 'b', 'c'])
    })
  })

  describe('parallel execution', () => {
    it('executes independent nodes in parallel', async () => {
      const graph = new Graph({
        nodes: [makeNode('a', 'one'), makeNode('b', 'two')],
        edges: [],
      })

      const result = await graph.invoke('go')

      expect(result.completedNodes).toBe(2)
      expect(result.executionOrder).toHaveLength(2)
      expect(result.executionOrder).toContain('a')
      expect(result.executionOrder).toContain('b')
    })

    it('fan-out: one node feeds two parallel nodes', async () => {
      const graph = new Graph({
        nodes: [makeNode('root', 'start'), makeNode('left', 'l'), makeNode('right', 'r')],
        edges: [
          { source: 'root', target: 'left' },
          { source: 'root', target: 'right' },
        ],
      })

      const result = await graph.invoke('go')

      expect(result.executionOrder[0]).toBe('root')
      expect(result.executionOrder).toContain('left')
      expect(result.executionOrder).toContain('right')
      expect(result.completedNodes).toBe(3)
    })

    it('fan-in: two nodes feed one node', async () => {
      const graph = new Graph({
        nodes: [makeNode('a', 'one'), makeNode('b', 'two'), makeNode('c', 'merged')],
        edges: [
          { source: 'a', target: 'c' },
          { source: 'b', target: 'c' },
        ],
      })

      const result = await graph.invoke('go')

      // a and b run first (parallel), then c
      expect(result.executionOrder).toContain('a')
      expect(result.executionOrder).toContain('b')
      expect(result.executionOrder[2]).toBe('c')
    })
  })

  describe('conditional edges', () => {
    it('skips nodes when edge condition returns false', async () => {
      const graph = new Graph({
        nodes: [makeNode('a', 'start'), makeNode('b', 'skipped')],
        edges: [{ source: 'a', target: 'b', handler: () => false }],
      })

      const result = await graph.invoke('go')

      expect(result.executionOrder).toEqual(['a'])
      expect(result.completedNodes).toBe(1)
    })

    it('traverses edges when condition returns true', async () => {
      const graph = new Graph({
        nodes: [makeNode('a', 'start'), makeNode('b', 'reached')],
        edges: [{ source: 'a', target: 'b', handler: () => true }],
      })

      const result = await graph.invoke('go')

      expect(result.executionOrder).toEqual(['a', 'b'])
    })
  })

  describe('execution limits', () => {
    it('throws when maxNodeExecutions is exceeded', async () => {
      const graph = new Graph({
        nodes: [makeNode('a', 'hi'), makeNode('b', 'bye')],
        edges: [{ source: 'a', target: 'b' }],
        maxNodeExecutions: 1,
      })

      // a executes (step 1), then b would be step 2 which exceeds limit
      await expect(graph.invoke('go')).rejects.toThrow('Max node executions reached')
    })
  })

  describe('streaming', () => {
    it('yields events during execution', async () => {
      const graph = new Graph({
        nodes: [makeNode('a', 'hello')],
        edges: [],
      })

      const { items, result } = await collectGenerator(graph.stream('go'))

      // Should have node stream events, result events, and final multiAgentResultEvent
      expect(items.length).toBeGreaterThan(0)
      const resultEvents = items.filter((e) => e.type === 'multiAgentResultEvent')
      expect(resultEvents).toHaveLength(1)
      expect(result.completedNodes).toBe(1)
    })

    it('yields handoff events between batches', async () => {
      const graph = new Graph({
        nodes: [makeNode('a', 'first'), makeNode('b', 'second')],
        edges: [{ source: 'a', target: 'b' }],
      })

      const { items } = await collectGenerator(graph.stream('go'))

      const handoffs = items.filter((e) => e.type === 'multiAgentHandoffEvent')
      expect(handoffs).toHaveLength(1)
    })
  })

  describe('error handling', () => {
    it('propagates node execution errors', async () => {
      const model = new MockMessageModel().addTurn(new Error('boom'))
      const failAgent = new Agent({ model, printer: false })
      const graph = new Graph({
        nodes: [new AgentNode({ id: 'fail', agent: failAgent })],
        edges: [],
      })

      // The node catches the error and returns FAILED status
      const result = await graph.invoke('go')
      expect(result.failedNodes).toBe(1)
    })
  })
})
