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
import { Swarm, Status } from '$/sdk/multiagent/index.js'
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

  it('resumes from the pending handoff target after maxSteps stops the swarm', async () => {
    const sessionId = uuidv7()
    const swarmId = 'resume-swarm'

    // First invocation: researcher hands off to writer, but maxSteps=1 stops before writer runs
    const swarm1 = new Swarm({
      id: swarmId,
      nodes: createResearcherWriterNodes(createModel),
      start: 'researcher',
      maxSteps: 1,
      plugins: [makeSessionManager(sessionId, tempDir)],
    })

    await expect(swarm1.invoke('What is the tallest mountain?')).rejects.toThrow('swarm reached step limit')

    // Second invocation: new Swarm + SessionManager simulates process restart
    const swarm2 = new Swarm({
      id: swarmId,
      nodes: createResearcherWriterNodes(createModel),
      start: 'researcher',
      plugins: [makeSessionManager(sessionId, tempDir)],
    })

    const result = await swarm2.invoke('What is the tallest mountain?')

    expect(result.status).toBe(Status.COMPLETED)
    expect(result.results.map((r) => r.nodeId)).toStrictEqual(['researcher', 'writer'])

    const text = result.content.find((b) => b.type === 'textBlock')
    expect(text?.text).toMatch(/Everest/i)
  })
})
