import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Agent } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { Message, TextBlock } from '../../types/messages.js'
import { SNAPSHOT_SCHEMA_VERSION } from '../../types/snapshot.js'
import type { Snapshot } from '../../types/snapshot.js'
import { takeSnapshot, loadSnapshot } from '../snapshot.js'
import { Graph } from '../graph.js'
import { Swarm } from '../swarm.js'
import { MultiAgentState, NodeResult, Status } from '../state.js'
import { logger } from '../../logging/logger.js'

const MOCK_TIMESTAMP = '2026-01-15T12:00:00.000Z'

/** Extract per-node snapshots from a snapshot's data, casting through unknown. */
function getNodeSnapshots(snapshot: Snapshot): Record<string, Snapshot> {
  return snapshot.data.nodes as unknown as Record<string, Snapshot>
}

function makeAgent(id: string, text = 'reply'): Agent {
  const model = new MockMessageModel().addTurn(new TextBlock(text))
  return new Agent({ model, printer: false, id })
}

/** Get the underlying Agent from an orchestrator node (AgentNode.agent returns AgentBase). */
function getAgent(orchestrator: Graph | Swarm, nodeId: string): Agent {
  return (orchestrator.nodes.get(nodeId) as unknown as { agent: Agent }).agent
}

function makeGraph(id: string, agentIds: string[]): Graph {
  return new Graph({
    id,
    nodes: agentIds.map((aid) => makeAgent(aid)),
    edges: agentIds.length > 1 ? [[agentIds[0]!, agentIds[1]!]] : [],
  })
}

function makeSwarm(id: string, agentIds: string[]): Swarm {
  return new Swarm({
    id,
    nodes: agentIds.map((aid) => makeAgent(aid)),
  })
}

function makeState(nodeIds: string[]): MultiAgentState {
  return new MultiAgentState({ nodeIds })
}

describe('multiagent snapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(MOCK_TIMESTAMP))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('takeSnapshot', () => {
    it('creates snapshot with orchestratorId, state, and node snapshots by default', () => {
      const graph = makeGraph('my-graph', ['a', 'b'])
      const state = makeState(['a', 'b'])

      const snapshot = takeSnapshot(graph, state)

      expect(snapshot.scope).toBe('multiAgent')
      expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION)
      expect(snapshot.createdAt).toBe(MOCK_TIMESTAMP)
      expect(snapshot.data.orchestratorId).toBe('my-graph')
      expect(snapshot.data.state).toBeDefined()
      expect(snapshot.data.nodes).toBeDefined()
      expect(snapshot.appData).toEqual({})
    })

    it('defaults to full preset', () => {
      const graph = makeGraph('g', ['a'])

      const snapshot = takeSnapshot(graph, makeState(['a']))

      const nodes = getNodeSnapshots(snapshot)
      expect(nodes).toBeDefined()
      expect(nodes['a']!.scope).toBe('agent')
    })

    it('session preset omits node snapshots', () => {
      const graph = makeGraph('g', ['a'])

      const snapshot = takeSnapshot(graph, makeState(['a']), { preset: 'session' })

      expect(snapshot.data.nodes).toBeUndefined()
    })

    it('includes appData when provided', () => {
      const graph = makeGraph('g', ['a'])

      const snapshot = takeSnapshot(graph, makeState(['a']), { appData: { userId: 'u-1' } })

      expect(snapshot.appData).toEqual({ userId: 'u-1' })
    })

    it('omits state when state parameter is undefined', () => {
      const graph = makeGraph('g', ['a'])

      const snapshot = takeSnapshot(graph, undefined)

      expect(snapshot.data.orchestratorId).toBe('g')
      expect(snapshot.data.state).toBeUndefined()
    })

    it('serializes MultiAgentState via stateToJSONSymbol', () => {
      const graph = makeGraph('g', ['a'])
      const state = makeState(['a'])
      state.steps = 3
      state.app.set('key', 'val')

      const snapshot = takeSnapshot(graph, state)
      const stateData = snapshot.data.state as Record<string, unknown>

      expect(stateData.steps).toBe(3)
      expect(stateData.app).toEqual({ key: 'val' })
    })

    describe('full preset', () => {
      it('includes per-node agent snapshots', () => {
        const graph = makeGraph('g', ['a', 'b'])

        const snapshot = takeSnapshot(graph, makeState(['a', 'b']), { preset: 'full' })

        const nodes = getNodeSnapshots(snapshot)
        expect(nodes).toBeDefined()
        expect(nodes['a']!.scope).toBe('agent')
        expect(nodes['b']!.scope).toBe('agent')
      })

      it('forwards agentSnapshotOptions to agent snapshots', () => {
        const graph = makeGraph('g', ['a'])

        const snapshot = takeSnapshot(graph, makeState(['a']), {
          preset: 'full',
          agentSnapshotOptions: { include: ['messages'] },
        })

        const nodes = getNodeSnapshots(snapshot)
        expect(nodes['a']!.data.messages).toBeDefined()
        expect(nodes['a']!.data.state).toBeUndefined()
        expect(nodes['a']!.data.systemPrompt).toBeUndefined()
      })

      it('defaults agentSnapshotOptions to session preset', () => {
        const graph = makeGraph('g', ['a'])

        const snapshot = takeSnapshot(graph, makeState(['a']), { preset: 'full' })

        const nodes = getNodeSnapshots(snapshot)
        expect(nodes['a']!.data.messages).toBeDefined()
        expect(nodes['a']!.data.state).toBeDefined()
      })

      it('recursively snapshots nested MultiAgentNode', () => {
        const inner = makeGraph('inner', ['x'])
        const outer = new Graph({
          id: 'outer',
          nodes: [makeAgent('a'), inner],
          edges: [['a', 'inner']],
        })

        const snapshot = takeSnapshot(outer, makeState(['a', 'inner']), { preset: 'full' })

        const nodes = getNodeSnapshots(snapshot)
        expect(nodes['a']!.scope).toBe('agent')
        expect(nodes['inner']!.scope).toBe('multiAgent')
        expect(nodes['inner']!.data.orchestratorId).toBe('inner')
        const innerNodes = getNodeSnapshots(nodes['inner']!)
        expect(innerNodes['x']!.scope).toBe('agent')
      })

      it('nested snapshots have empty appData', () => {
        const inner = makeGraph('inner', ['x'])
        const outer = new Graph({
          id: 'outer',
          nodes: [makeAgent('a'), inner],
          edges: [['a', 'inner']],
        })

        const snapshot = takeSnapshot(outer, makeState(['a', 'inner']), {
          preset: 'full',
          appData: { topLevel: true },
        })

        expect(snapshot.appData).toEqual({ topLevel: true })
        const nodes = getNodeSnapshots(snapshot)
        expect(nodes['inner']!.appData).toEqual({})
      })

      it('nested snapshots have no state (ephemeral)', () => {
        const inner = makeGraph('inner', ['x'])
        const outer = new Graph({
          id: 'outer',
          nodes: [makeAgent('a'), inner],
          edges: [['a', 'inner']],
        })

        const snapshot = takeSnapshot(outer, makeState(['a', 'inner']), { preset: 'full' })

        const nodes = getNodeSnapshots(snapshot)
        expect(nodes['inner']!.data.state).toBeUndefined()
      })
    })

    it('works with Swarm orchestrator', () => {
      const swarm = makeSwarm('my-swarm', ['a', 'b'])

      const snapshot = takeSnapshot(swarm, makeState(['a', 'b']))

      expect(snapshot.data.orchestratorId).toBe('my-swarm')
      expect(snapshot.data.state).toBeDefined()
    })

    it('full preset works with Swarm', () => {
      const swarm = makeSwarm('my-swarm', ['a', 'b'])

      const snapshot = takeSnapshot(swarm, makeState(['a', 'b']), { preset: 'full' })

      const nodes = getNodeSnapshots(snapshot)
      expect(nodes['a']!.scope).toBe('agent')
      expect(nodes['b']!.scope).toBe('agent')
    })
  })

  describe('loadSnapshot', () => {
    it('restores MultiAgentState from snapshot', () => {
      const graph = makeGraph('g', ['a', 'b'])
      const state = makeState(['a', 'b'])
      state.steps = 5
      state.results.push(
        new NodeResult({ nodeId: 'a', status: Status.COMPLETED, duration: 100, content: [new TextBlock('done')] })
      )

      const snapshot = takeSnapshot(graph, state)
      const restored = makeState([])
      loadSnapshot(graph, snapshot, restored)

      expect(restored.steps).toBe(5)
      expect(restored.results).toHaveLength(1)
      expect(restored.results[0]!.nodeId).toBe('a')
    })

    it('does not modify state when snapshot has no state data', () => {
      const graph = makeGraph('g', ['a'])

      const snapshot = takeSnapshot(graph, undefined)
      const state = makeState(['a'])
      state.steps = 99
      loadSnapshot(graph, snapshot, state)

      expect(state.steps).toBe(99)
    })

    it('does not modify state when no state parameter provided', () => {
      const graph = makeGraph('g', ['a'])
      const original = makeState(['a'])

      const snapshot = takeSnapshot(graph, original)
      loadSnapshot(graph, snapshot)
    })

    it('throws on wrong scope', () => {
      const graph = makeGraph('g', ['a'])
      const snapshot: Snapshot = {
        scope: 'agent',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        createdAt: MOCK_TIMESTAMP,
        data: { orchestratorId: 'g' },
        appData: {},
      }

      expect(() => loadSnapshot(graph, snapshot)).toThrow("Expected snapshot scope 'multiAgent', got 'agent'")
    })

    it('throws on unsupported schema version', () => {
      const graph = makeGraph('g', ['a'])
      const snapshot: Snapshot = {
        scope: 'multiAgent',
        schemaVersion: '99.0',
        createdAt: MOCK_TIMESTAMP,
        data: { orchestratorId: 'g' },
        appData: {},
      }

      expect(() => loadSnapshot(graph, snapshot)).toThrow('Unsupported snapshot schema version: 99.0')
    })

    it('throws on orchestratorId mismatch', () => {
      const graph = makeGraph('g', ['a'])
      const snapshot: Snapshot = {
        scope: 'multiAgent',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        createdAt: MOCK_TIMESTAMP,
        data: { orchestratorId: 'different-id' },
        appData: {},
      }

      expect(() => loadSnapshot(graph, snapshot)).toThrow(
        "Snapshot orchestrator ID mismatch: expected 'g', got 'different-id'"
      )
    })

    it('does not modify state when snapshot state is null', () => {
      const graph = makeGraph('g', ['a'])
      const snapshot: Snapshot = {
        scope: 'multiAgent',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        createdAt: MOCK_TIMESTAMP,
        data: { orchestratorId: 'g', state: null },
        appData: {},
      }

      const state = makeState(['a'])
      state.steps = 99
      loadSnapshot(graph, snapshot, state)

      expect(state.steps).toBe(99)
    })

    it('restores agent node snapshots (full preset)', () => {
      const graph = makeGraph('g', ['a'])
      const agent = getAgent(graph, 'a')
      agent.appState.set('agentKey', 'agentVal')

      const snapshot = takeSnapshot(graph, makeState(['a']), { preset: 'full' })

      agent.appState.clear()
      loadSnapshot(graph, snapshot)

      expect(agent.appState.get('agentKey')).toBe('agentVal')
    })

    it('restores agent messages (full preset)', () => {
      const graph = makeGraph('g', ['a'])
      const agent = getAgent(graph, 'a')
      agent.messages.push(new Message({ role: 'user', content: [new TextBlock('original')] }))

      const snapshot = takeSnapshot(graph, makeState(['a']), { preset: 'full' })

      agent.messages.length = 0
      loadSnapshot(graph, snapshot)

      expect(agent.messages).toHaveLength(1)
    })

    it('warns and skips unknown node IDs in snapshot', () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      const graph = makeGraph('g', ['a'])

      const snapshot: Snapshot = {
        scope: 'multiAgent',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        createdAt: MOCK_TIMESTAMP,
        data: {
          orchestratorId: 'g',
          nodes: {
            unknown_node: {
              scope: 'agent',
              schemaVersion: SNAPSHOT_SCHEMA_VERSION,
              createdAt: MOCK_TIMESTAMP,
              data: {},
              appData: {},
            },
          },
        },
        appData: {},
      }

      loadSnapshot(graph, snapshot)

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown_node'))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown node, skipping'))
      warnSpy.mockRestore()
    })

    it('recursively restores nested MultiAgentNode snapshots', () => {
      const inner = makeGraph('inner', ['x'])
      const outer = new Graph({
        id: 'outer',
        nodes: [makeAgent('a'), inner],
        edges: [['a', 'inner']],
      })

      const innerAgent = getAgent(inner, 'x')
      innerAgent.appState.set('innerKey', 'innerVal')

      const snapshot = takeSnapshot(outer, makeState(['a', 'inner']), { preset: 'full' })

      innerAgent.appState.clear()
      loadSnapshot(outer, snapshot)

      expect(innerAgent.appState.get('innerKey')).toBe('innerVal')
    })

    it('warns and skips nested orchestrator with mismatched ID', () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      const inner = makeGraph('inner', ['x'])
      const outer = new Graph({
        id: 'outer',
        nodes: [makeAgent('a'), inner],
        edges: [['a', 'inner']],
      })

      const snapshot: Snapshot = {
        scope: 'multiAgent',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        createdAt: MOCK_TIMESTAMP,
        data: {
          orchestratorId: 'outer',
          nodes: {
            inner: {
              scope: 'multiAgent',
              schemaVersion: SNAPSHOT_SCHEMA_VERSION,
              createdAt: MOCK_TIMESTAMP,
              data: { orchestratorId: 'wrong-inner-id' },
              appData: {},
            },
          },
        },
        appData: {},
      }

      loadSnapshot(outer, snapshot)

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nested orchestrator ID mismatch'))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('wrong-inner-id'))
      warnSpy.mockRestore()
    })

    it('works with Swarm orchestrator', () => {
      const swarm = makeSwarm('s', ['a', 'b'])
      const state = makeState(['a', 'b'])
      state.steps = 2

      const snapshot = takeSnapshot(swarm, state)
      const restored = makeState([])
      loadSnapshot(swarm, snapshot, restored)

      expect(restored.steps).toBe(2)
    })
  })

  describe('round-trip', () => {
    it('state survives takeSnapshot → loadSnapshot', () => {
      const graph = makeGraph('g', ['a', 'b'])
      const state = makeState(['a', 'b'])
      state.steps = 7
      state.app.set('counter', 42)
      state.results.push(
        new NodeResult({ nodeId: 'a', status: Status.COMPLETED, duration: 200, content: [new TextBlock('result')] })
      )

      const snapshot = takeSnapshot(graph, state)
      const restored = makeState([])
      loadSnapshot(graph, snapshot, restored)

      expect(restored.steps).toBe(7)
      expect(restored.app.get('counter')).toBe(42)
      expect(restored.results).toHaveLength(1)
      expect(restored.results[0]!.nodeId).toBe('a')
      expect((restored.results[0]!.content[0] as TextBlock).text).toBe('result')
    })

    it('snapshot survives JSON.stringify/JSON.parse round-trip', () => {
      const graph = makeGraph('g', ['a'])
      const state = makeState(['a'])
      state.steps = 3

      const snapshot = takeSnapshot(graph, state, { appData: { key: 'value' } })
      const parsed = JSON.parse(JSON.stringify(snapshot)) as Snapshot

      const restored = makeState([])
      loadSnapshot(graph, parsed, restored)

      expect(restored.steps).toBe(3)
    })

    it('full preset round-trip preserves agent state', () => {
      const graph = makeGraph('g', ['a'])
      const agent = getAgent(graph, 'a')
      agent.appState.set('agentKey', 'agentVal')

      const snapshot = takeSnapshot(graph, makeState(['a']), { preset: 'full' })

      agent.appState.clear()
      loadSnapshot(graph, snapshot)

      expect(agent.appState.get('agentKey')).toBe('agentVal')
    })

    it('full preset round-trip with nested graph preserves inner agent state', () => {
      const inner = makeGraph('inner', ['x'])
      const outer = new Graph({
        id: 'outer',
        nodes: [makeAgent('a'), inner],
        edges: [['a', 'inner']],
      })

      const innerAgent = getAgent(inner, 'x')
      innerAgent.appState.set('deep', 'value')

      const snapshot = takeSnapshot(outer, makeState(['a', 'inner']), {
        preset: 'full',
        appData: { session: 'abc' },
      })

      const json = JSON.parse(JSON.stringify(snapshot)) as Snapshot

      innerAgent.appState.clear()
      loadSnapshot(outer, json)

      expect(innerAgent.appState.get('deep')).toBe('value')
    })
  })
})
