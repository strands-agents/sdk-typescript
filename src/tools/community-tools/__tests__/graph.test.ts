import { Agent } from '../../../agent/agent.js'
import { GraphBuilder } from '../../../multiagent/graph.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { graph, resetGraphManagerForTests } from '../graph.js'
import { collectToolStream, createMockToolContext, getToolResultText, runToolStream } from './test-helpers.js'

const TOPOLOGY = {
  nodes: [
    { id: 'researcher', role: 'researcher', system_prompt: 'You research.' },
    { id: 'analyst', role: 'analyst', system_prompt: 'You analyze.' },
  ],
  edges: [{ from: 'researcher', to: 'analyst' }],
  entry_points: ['researcher'],
}

function createParentAgent(): Agent {
  return new Agent()
}

describe('graph tool', () => {
  beforeEach(() => {
    resetGraphManagerForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetGraphManagerForTests()
  })

  it('has expected metadata', () => {
    expect(graph.name).toBe('graph')
    expect(graph.description).toContain('multi-agent graphs')
  })

  it('returns validation errors for missing required parameters', async () => {
    const agent = createParentAgent()

    const createCtx = createMockToolContext('graph', { action: 'create', graph_id: 'x' }, agent)
    const executeCtx = createMockToolContext('graph', { action: 'execute', graph_id: 'x' }, agent)
    const statusCtx = createMockToolContext('graph', { action: 'status' }, agent)
    const deleteCtx = createMockToolContext('graph', { action: 'delete' }, agent)

    expect(getToolResultText(await runToolStream(graph, createCtx))).toContain('graph_id and topology are required')
    expect(getToolResultText(await runToolStream(graph, executeCtx))).toContain('graph_id and task are required')
    expect(getToolResultText(await runToolStream(graph, statusCtx))).toContain('graph_id is required for status action')
    expect(getToolResultText(await runToolStream(graph, deleteCtx))).toContain('graph_id is required for delete action')
  })

  it('creates, lists, checks status, and deletes graph successfully', async () => {
    const agent = createParentAgent()
    const fakeStream = vi.fn().mockImplementation(async function* (): AsyncGenerator<unknown, unknown> {
      yield { type: 'multiAgentNodeStartEvent', nodeId: 'researcher' }
      yield { type: 'multiAgentNodeStopEvent', nodeId: 'researcher' }
      return {
        status: 'completed',
        completedNodes: 2,
        failedNodes: 0,
        executionTime: 12,
        results: {
          researcher: {
            getAgentResults: () => [{ toString: () => 'Research complete' }],
          },
        },
      }
    })
    vi.spyOn(GraphBuilder.prototype, 'build').mockReturnValue({ invoke: vi.fn(), stream: fakeStream } as never)

    const createCtx = createMockToolContext(
      'graph',
      { action: 'create', graph_id: 'pipeline', topology: TOPOLOGY },
      agent
    )
    const createBlock = await runToolStream(graph, createCtx)
    expect(getToolResultText(createBlock)).toContain('Graph pipeline created successfully with 2 nodes')

    const listCtx = createMockToolContext('graph', { action: 'list' }, agent)
    const listBlock = await runToolStream(graph, listCtx)
    expect(getToolResultText(listBlock)).toContain('Listed 1 graphs')

    const statusCtx = createMockToolContext('graph', { action: 'status', graph_id: 'pipeline' }, agent)
    const statusBlock = await runToolStream(graph, statusCtx)
    expect(getToolResultText(statusBlock)).toContain('Graph pipeline status retrieved')

    const executeCtx = createMockToolContext(
      'graph',
      { action: 'execute', graph_id: 'pipeline', task: 'Analyze current market dynamics' },
      agent
    )
    const executeRun = await collectToolStream(graph, executeCtx)
    expect(getToolResultText(executeRun.result)).toContain('Graph pipeline executed successfully')
    expect(executeRun.events.length).toBeGreaterThan(0)
    expect(fakeStream).toHaveBeenCalledTimes(1)

    const deleteCtx = createMockToolContext('graph', { action: 'delete', graph_id: 'pipeline' }, agent)
    const deleteBlock = await runToolStream(graph, deleteCtx)
    expect(getToolResultText(deleteBlock)).toContain('Graph pipeline deleted successfully')
  })

  it('returns errors for duplicate graph creation and unknown graph operations', async () => {
    const agent = createParentAgent()
    vi.spyOn(GraphBuilder.prototype, 'build').mockReturnValue({
      invoke: vi.fn().mockResolvedValue({
        status: 'completed',
        completedNodes: 1,
        failedNodes: 0,
        executionTime: 1,
        results: {},
      }),
      stream: vi.fn().mockImplementation(async function* (): AsyncGenerator<unknown, unknown> {
        yield undefined
        return {
          status: 'completed',
          completedNodes: 1,
          failedNodes: 0,
          executionTime: 1,
          results: {},
        }
      }),
    } as never)

    const createCtx = createMockToolContext('graph', { action: 'create', graph_id: 'dupe', topology: TOPOLOGY }, agent)
    await runToolStream(graph, createCtx)

    const duplicateCtx = createMockToolContext(
      'graph',
      { action: 'create', graph_id: 'dupe', topology: TOPOLOGY },
      agent
    )
    const duplicateBlock = await runToolStream(graph, duplicateCtx)
    expect(getToolResultText(duplicateBlock)).toContain('already exists')

    const missingCtx = createMockToolContext('graph', { action: 'execute', graph_id: 'missing', task: 'task' }, agent)
    const missingBlock = await runToolStream(graph, missingCtx)
    expect(getToolResultText(missingBlock)).toContain('not found')
  })

  it('returns an error for unknown action', async () => {
    const agent = createParentAgent()
    const ctx = createMockToolContext('graph', { action: 'invalid_action' }, agent)
    const block = await runToolStream(graph, ctx)
    expect(getToolResultText(block)).toContain('Unknown action')
  })
})
