import { Agent } from '../../../agent/agent.js'
import { Swarm } from '../../../multiagent/swarm.js'
import type { MultiAgentInput, MultiAgentInvokeOptions } from '../../../multiagent/types.js'
import { FunctionTool } from '../../function-tool.js'
import type { JSONValue } from '../../../types/json.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { swarm } from '../swarm.js'
import { collectToolStream, createMockToolContext, getToolResultText, runToolStream } from './test-helpers.js'

function makeTool(name: string): FunctionTool {
  return new FunctionTool({
    name,
    description: `${name} test tool`,
    inputSchema: { type: 'object', properties: {} },
    callback: (): JSONValue => ({ status: 'success', content: [{ text: `${name} ok` }] }),
  })
}

function createParentAgent(): Agent {
  return new Agent({
    tools: [makeTool('calculator'), makeTool('file_read'), makeTool('file_write')],
    systemPrompt: 'You are a helpful assistant.',
  })
}

describe('swarm tool', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('has expected metadata', () => {
    expect(swarm.name).toBe('swarm')
    expect(swarm.description).toContain('custom team')
  })

  it('validates required task and agents', async () => {
    const parent = createParentAgent()

    const noTaskCtx = createMockToolContext('swarm', { agents: [{ system_prompt: 'Test' }] }, parent)
    const noAgentsCtx = createMockToolContext('swarm', { task: 'hello', agents: [] }, parent)

    expect(getToolResultText(await runToolStream(swarm, noTaskCtx))).toContain('task is required')
    expect(getToolResultText(await runToolStream(swarm, noAgentsCtx))).toContain(
      'At least one agent specification is required'
    )
  })

  it('rejects oversized dynamic teams', async () => {
    const parent = createParentAgent()
    const agents = Array.from({ length: 7 }, (_, i) => ({
      name: `agent_${i + 1}`,
      system_prompt: `Role ${i + 1}`,
    }))
    const ctx = createMockToolContext('swarm', { task: 'large team', agents }, parent)
    const text = getToolResultText(await runToolStream(swarm, ctx))
    expect(text).toContain('At most 6 dynamic swarm agents are allowed')
  })

  it('normalizes duplicate names and filters blocked/missing tools', async () => {
    const parent = createParentAgent()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const streamSpy = vi.spyOn(Swarm.prototype, 'stream').mockImplementation(async function* (this: Swarm) {
      yield undefined
      const nodeIds = Object.keys(this.nodes)
      expect(nodeIds).toEqual(['duplicate', 'duplicate_1'])
      expect(this.nodes.duplicate?.executor.tools.map((tool: { name: string }) => tool.name)).toEqual(['calculator'])
      expect(this.nodes.duplicate_1?.executor.tools.map((tool: { name: string }) => tool.name)).toEqual([
        'calculator',
        'file_read',
      ])
      return {
        status: 'completed',
        executionTime: 1,
        executionCount: 1,
        nodeHistory: [],
        results: {},
        accumulatedUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }
    } as unknown as (task: MultiAgentInput, options?: MultiAgentInvokeOptions) => ReturnType<Swarm['stream']>)

    const ctx = createMockToolContext(
      'swarm',
      {
        task: 'Validate setup',
        agents: [
          { name: 'duplicate', system_prompt: 'First', tools: ['calculator', 'missing_tool', 'file_write'] },
          { name: 'duplicate', system_prompt: 'Second' },
        ],
      },
      parent
    )

    await runToolStream(swarm, ctx)
    expect(streamSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Tool 'missing_tool' not found"))
  })

  it('executes swarm and returns formatted response', async () => {
    const parent = createParentAgent()
    vi.spyOn(Swarm.prototype, 'stream').mockImplementation(async function* () {
      yield { type: 'multiAgentNodeStartEvent', nodeId: 'researcher' }
      yield { type: 'multiAgentNodeStopEvent', nodeId: 'researcher' }
      return {
        status: 'completed',
        executionTime: 2500,
        executionCount: 3,
        nodeHistory: [{ nodeId: 'researcher' }, { nodeId: 'analyst' }, { nodeId: 'writer' }],
        results: {
          researcher: { getAgentResults: () => [{ toString: () => 'Research findings ready.' }] },
          analyst: { getAgentResults: () => [{ toString: () => 'Analysis complete.' }] },
          writer: { getAgentResults: () => [{ toString: () => 'Final report delivered.' }] },
        },
        accumulatedUsage: { inputTokens: 150, outputTokens: 300, totalTokens: 450 },
      }
    } as unknown as (task: MultiAgentInput, options?: MultiAgentInvokeOptions) => ReturnType<Swarm['stream']>)

    const ctx = createMockToolContext(
      'swarm',
      {
        task: 'Develop launch strategy',
        agents: [
          { name: 'researcher', system_prompt: 'You research.' },
          { name: 'analyst', system_prompt: 'You analyze.' },
          { name: 'writer', system_prompt: 'You write.' },
        ],
      },
      parent
    )

    const { events, result } = await collectToolStream(swarm, ctx)
    const text = getToolResultText(result)
    expect(events.length).toBeGreaterThan(0)
    expect(text).toContain('Custom Agent Team Execution Complete')
    expect(text).toContain('Status: completed')
    expect(text).toContain('Execution Time: 2500ms')
    expect(text).toContain('researcher -> analyst -> writer')
    expect(text).toContain('Final report delivered.')
  })

  it('returns error when swarm execution fails', async () => {
    const parent = createParentAgent()
    vi.spyOn(Swarm.prototype, 'stream').mockImplementation(async function* () {
      yield undefined
      throw new Error('Swarm execution failed')
    } as unknown as (task: MultiAgentInput, options?: MultiAgentInvokeOptions) => ReturnType<Swarm['stream']>)

    const ctx = createMockToolContext(
      'swarm',
      {
        task: 'Failing task',
        agents: [{ name: 'researcher', system_prompt: 'You research.' }],
      },
      parent
    )

    const block = await runToolStream(swarm, ctx)
    const text = getToolResultText(block)
    expect(block.status).toBe('error')
    expect(text).toContain('Swarm execution failed')
  })
})
