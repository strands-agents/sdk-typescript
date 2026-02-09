/**
 * Integration tests for session management (FileSessionManager).
 *
 * Uses a mock model so tests run without provider credentials.
 * Verifies persist + restore flow across two agent instances sharing the same session.
 */

import { MockMessageModel } from '$/sdk/__fixtures__/mock-message-model.js'
import { Agent, FileSessionManager } from '@strands-agents/sdk-fork'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('Session management (FileSessionManager)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'strands-session-integ-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('persists and restores agent conversation across two agent instances', async () => {
    const sessionId = `session-${Date.now()}`
    const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello back!' })

    const sessionManager1 = new FileSessionManager({ sessionId, storageDir: tempDir })
    const agent1 = new Agent({
      model,
      printer: false,
      sessionManager: sessionManager1,
    })

    await agent1.invoke('Hello!')
    expect(agent1.messages).toHaveLength(2)

    const messageCount = await sessionManager1.listMessages(sessionId, agent1.agentId)
    expect(messageCount).toHaveLength(2)

    const sessionManager2 = new FileSessionManager({ sessionId, storageDir: tempDir })
    const model2 = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello again!' })
    const agent2 = new Agent({
      model: model2,
      printer: false,
      sessionManager: sessionManager2,
    })

    await agent2.invoke('Hello again!')
    expect(agent2.messages).toHaveLength(4)
    expect(agent2.messages[0]!.role).toBe('user')
    expect(agent2.messages[1]!.role).toBe('assistant')
    expect(agent2.messages[2]!.role).toBe('user')
    expect(agent2.messages[3]!.role).toBe('assistant')

    const messageCount2 = await sessionManager2.listMessages(sessionId, agent2.agentId)
    expect(messageCount2).toHaveLength(4)

    await sessionManager2.deleteSession(sessionId)
    const readAfterDelete = await sessionManager2.readSession(sessionId)
    expect(readAfterDelete).toBeNull()
  })

  it('restores agent state and conversation manager state from session', async () => {
    const sessionId = `session-state-${Date.now()}`
    const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'First reply' })

    const sessionManager1 = new FileSessionManager({ sessionId, storageDir: tempDir })
    const agent1 = new Agent({
      model,
      printer: false,
      sessionManager: sessionManager1,
    })
    agent1.state.set('customKey', 'customValue')
    await agent1.invoke('First message')

    const sessionManager2 = new FileSessionManager({ sessionId, storageDir: tempDir })
    const model2 = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Second reply' })
    const agent2 = new Agent({
      model: model2,
      printer: false,
      sessionManager: sessionManager2,
    })

    await agent2.invoke('Second message')
    expect(agent2.messages.length).toBeGreaterThanOrEqual(2)
    expect(agent2.state.get('customKey')).toBe('customValue')
  })
})
