/**
 * Integration tests for multi-agent session management (Swarm resume).
 * Node-only: uses FileStorage which requires fs.
 *
 * TODO: Add Graph resume tests once Graph resume is implemented.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { v7 as uuidv7 } from 'uuid'
import { Agent } from '$/sdk/agent/agent.js'
import { Swarm, Status, BeforeNodeCallEvent } from '$/sdk/multiagent/index.js'
import { SessionManager } from '$/sdk/session/session-manager.js'
import { FileStorage } from '$/sdk/session/file-storage.js'
import { bedrock } from '../__fixtures__/model-providers.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSessionManager(sessionId: string, storageDir: string): SessionManager {
  return new SessionManager({ sessionId, storage: { snapshot: new FileStorage(storageDir) } })
}

function createResearcherWriterNodes(createModel: () => ReturnType<typeof bedrock.createModel>) {
  return [
    new Agent({
      model: createModel(),
      printer: false,
      id: 'researcher',
      description: 'Researches a topic then hands off to the writer.',
      systemPrompt:
        'You are a researcher. Research the answer, then always hand off to the writer. Never produce a final response yourself.',
    }),
    new Agent({
      model: createModel(),
      printer: false,
      id: 'writer',
      description: 'Writes a polished final answer in one sentence.',
      systemPrompt: 'Write the final answer in one sentence. Do not hand off.',
    }),
  ]
}

// ─── Swarm Resume ────────────────────────────────────────────────────────────

describe.skipIf(bedrock.skip)('Multi-Agent Session Management - Swarm', () => {
  const createModel = (maxTokens = 1024) => bedrock.createModel({ maxTokens })
  let tempDir: string

  beforeAll(async () => {
    tempDir = join(tmpdir(), `strands-multiagent-session-integ-${Date.now()}`)
    await fs.mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('resumes from writer after researcher completes and writer is cancelled', async () => {
    const sessionId = uuidv7()
    const swarmId = 'resume-swarm'

    // First invocation: researcher completes (per-node save fires),
    // then writer is cancelled via hook — simulating a stop after one node
    const swarm1 = new Swarm({
      id: swarmId,
      nodes: createResearcherWriterNodes(createModel),
      start: 'researcher',
      plugins: [makeSessionManager(sessionId, tempDir)],
    })

    swarm1.addHook(BeforeNodeCallEvent, (event) => {
      if (event.nodeId === 'writer') {
        event.cancel = 'simulated stop'
      }
    })

    const result1 = await swarm1.invoke('What is the tallest mountain?')

    // Researcher completed, writer was cancelled
    expect(result1.status).toBe(Status.CANCELLED)
    expect(result1.results.map((r) => r.nodeId)).toContain('researcher')

    // Second invocation: new Swarm + SessionManager simulates process restart.
    // The per-node snapshot saved after researcher should allow resume at writer.
    const swarm2 = new Swarm({
      id: swarmId,
      nodes: createResearcherWriterNodes(createModel),
      start: 'researcher',
      plugins: [makeSessionManager(sessionId, tempDir)],
    })

    const result2 = await swarm2.invoke('What is the tallest mountain?')

    expect(result2.status).toBe(Status.COMPLETED)

    // Writer should have executed (the resume target), researcher should not re-execute
    const nodeIds = result2.results.map((r) => r.nodeId)
    expect(nodeIds.filter((id) => id === 'researcher')).toHaveLength(1)
    expect(nodeIds[nodeIds.length - 1]).toBe('writer')

    const text = result2.content.find((b) => b.type === 'textBlock')
    expect(text?.text).toMatch(/Everest/i)
  })
})
