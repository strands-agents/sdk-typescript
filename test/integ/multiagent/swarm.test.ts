import { describe, expect, it } from 'vitest'
import { Agent } from '@strands-agents/sdk'
import { Swarm, Status } from '$/sdk/multiagent/index.js'
import { collectGenerator } from '$/sdk/__fixtures__/model-test-helpers.js'
import { bedrock } from '../__fixtures__/model-providers.js'

describe.skipIf(bedrock.skip)('Swarm', () => {
  const createModel = () => bedrock.createModel({ maxTokens: 200 })

  it('completes single-agent execution with lifecycle events', async () => {
    const agent = new Agent({
      model: createModel(),
      printer: false,
      agentId: 'assistant',
      description: 'Answers questions in one word.',
      systemPrompt: 'Answer in one word only.',
    })

    const swarm = new Swarm({
      nodes: [{ agent }],
      start: 'assistant',
    })

    const { items, result } = await collectGenerator(swarm.stream('What is the capital of France?'))

    expect(result.status).toBe(Status.COMPLETED)
    expect(result.results).toHaveLength(1)
    expect(result.results[0]!.nodeId).toBe('assistant')
    expect(result.duration).toBeGreaterThan(0)

    const text = result.content.find((b) => b.type === 'textBlock')
    expect(text?.text).toMatch(/Paris/i)

    // Verify lifecycle events
    const eventTypes = items.map((e) => e.type)
    expect(eventTypes[0]).toBe('beforeMultiAgentInvocationEvent')
    expect(eventTypes).toContain('beforeNodeCallEvent')
    expect(eventTypes).toContain('nodeStreamUpdateEvent')
    expect(eventTypes).toContain('nodeResultEvent')
    expect(eventTypes).toContain('afterNodeCallEvent')
    expect(eventTypes).toContain('afterMultiAgentInvocationEvent')
    expect(eventTypes).toContain('multiAgentResultEvent')
  })

  it('hands off between agents with handoff event', async () => {
    const researcher = new Agent({
      model: bedrock.createModel({ maxTokens: 512 }),
      printer: false,
      agentId: 'researcher',
      description: 'Gathers a fact then hands off to the writer.',
      systemPrompt: 'You are a researcher. Always hand off to the writer after stating one fact. Be brief.',
    })

    const writer = new Agent({
      model: createModel(),
      printer: false,
      agentId: 'writer',
      description: 'Presents the answer in one sentence.',
      systemPrompt: 'Present the answer in one sentence.',
    })

    const swarm = new Swarm({
      nodes: [{ agent: researcher }, { agent: writer }],
      start: 'researcher',
    })

    const { items, result } = await collectGenerator(swarm.stream('What is the largest ocean? Have the writer answer.'))

    expect(result.status).toBe(Status.COMPLETED)
    expect(result.results.length).toBeGreaterThanOrEqual(2)
    expect(result.results[0]!.nodeId).toBe('researcher')
    expect(result.duration).toBeGreaterThan(0)

    const text = result.content.find((b) => b.type === 'textBlock')
    expect(text?.text).toMatch(/Pacific/i)

    // Verify handoff event
    const handoff = items.find((e) => e.type === 'multiAgentHandoffEvent')
    expect(handoff).toEqual(
      expect.objectContaining({
        source: 'researcher',
        targets: ['writer'],
      })
    )
  })
})
