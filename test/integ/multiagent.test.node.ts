/**
 * Integration tests for multi-agent orchestration (Swarm and Graph).
 *
 * Uses MockMessageModel so tests run without provider credentials.
 * Verifies stream execution, event shape, and result structure.
 */

import { MockMessageModel } from '$/sdk/__fixtures__/mock-message-model.js'
import { collectGenerator } from '$/sdk/__fixtures__/model-test-helpers.js'
import { Agent, GraphBuilder, Swarm, type GraphResult, type SwarmResult } from '@strands-agents/sdk-fork'
import { describe, expect, it } from 'vitest'

function createMockAgent(name: string, responseText: string): Agent {
  const model = new MockMessageModel().addTurn({ type: 'textBlock', text: responseText })
  return new Agent({
    model,
    name,
    printer: false,
  })
}

describe('Multi-agent integration', () => {
  describe('Swarm', () => {
    it('runs swarm stream and returns SwarmResult with node history', async () => {
      const agentA = createMockAgent('agentA', 'Done by A')
      const agentB = createMockAgent('agentB', 'Done by B')
      const swarm = new Swarm({
        nodes: [agentA, agentB],
        entryPoint: agentA,
      })

      const { items: events, result } = await collectGenerator<unknown, SwarmResult>(swarm.stream('Run the task'))

      expect(result).toBeDefined()
      expect(result.status).toBe('completed')
      expect(result.nodeHistory.length).toBeGreaterThanOrEqual(1)
      expect(events.some((e) => (e as { type?: string }).type === 'multiAgentNodeStartEvent')).toBe(true)
      expect(events.some((e) => (e as { type?: string }).type === 'multiAgentResultEvent')).toBe(true)
    })
  })

  describe('Graph', () => {
    it('runs graph stream and returns GraphResult', async () => {
      const agentA = createMockAgent('nodeA', 'Done by A')
      const agentB = createMockAgent('nodeB', 'Done by B')
      const builder = new GraphBuilder()
      builder.addNode(agentA, 'A')
      builder.addNode(agentB, 'B')
      builder.addEdge('A', 'B')
      builder.setEntryPoint('A')
      builder.setMaxNodeExecutions(4)
      const graph = builder.build()

      const { items: events, result } = await collectGenerator<unknown, GraphResult>(graph.stream('Run the task'))

      expect(result).toBeDefined()
      expect(result.status).toBe('completed')
      expect(events.some((e) => (e as { type?: string }).type === 'multiAgentNodeStartEvent')).toBe(true)
      expect(events.some((e) => (e as { type?: string }).type === 'multiAgentResultEvent')).toBe(true)
    })
  })
})
