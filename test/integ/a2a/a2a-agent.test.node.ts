import { describe, expect, it, afterEach } from 'vitest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { Agent } from '@strands-agents/sdk'
import { A2AServer, A2AAgent, A2AStreamUpdateEvent } from '$/sdk/a2a/index.js'
import { AgentResultEvent } from '$/sdk/hooks/events.js'
import { TextBlock } from '$/sdk/types/messages.js'
import { collectGenerator } from '$/sdk/__fixtures__/model-test-helpers.js'
import { bedrock } from '../__fixtures__/model-providers.js'

describe.skipIf(bedrock.skip)('A2AAgent integration', () => {
  const servers: Server[] = []

  afterEach(() => {
    for (const server of servers) {
      server.close()
    }
    servers.length = 0
  })

  /**
   * Starts an A2A server on an OS-assigned port and returns the URL.
   * We bind express first to discover the port, then create the A2AServer
   * with the correct httpUrl so the agent card advertises the right address.
   */
  async function startServer(agent: Agent): Promise<{ url: string }> {
    return new Promise((resolve, reject) => {
      // Bind express first to discover the OS-assigned port
      const app = express()
      const server = app.listen(0, 'localhost', () => {
        const { port } = server.address() as AddressInfo
        servers.push(server)

        const url = `http://localhost:${port}`
        const a2aServer = new A2AServer({
          agent,
          name: 'Test Agent',
          description: 'Agent for A2A integration tests',
          httpUrl: url,
        })
        app.use(a2aServer.createMiddleware())

        resolve({ url })
      })
      server.on('error', reject)
    })
  }

  it('invoke returns AgentResult with response text', async () => {
    const agent = new Agent({
      model: bedrock.createModel({ maxTokens: 256 }),
      printer: false,
      systemPrompt: 'Respond with exactly one word: "pong".',
    })

    const { url } = await startServer(agent)
    const remoteAgent = new A2AAgent({ url })

    const result = await remoteAgent.invoke('ping')

    expect(result.stopReason).toBe('endTurn')
    expect(result.lastMessage.role).toBe('assistant')
    expect(result.lastMessage.content).toHaveLength(1)
    expect(result.lastMessage.content[0]).toBeInstanceOf(TextBlock)
    expect((result.lastMessage.content[0] as TextBlock).text.toLowerCase()).toContain('pong')
  })

  it('stream yields A2AStreamUpdateEvents and AgentResultEvent', async () => {
    const agent = new Agent({
      model: bedrock.createModel({ maxTokens: 256 }),
      printer: false,
      systemPrompt: 'Respond with exactly one word: "pong".',
    })

    const { url } = await startServer(agent)
    const remoteAgent = new A2AAgent({ url })

    const { items, result } = await collectGenerator(remoteAgent.stream('ping'))

    // Should have at least one A2AStreamUpdateEvent and one AgentResultEvent
    const streamUpdates = items.filter((e) => e instanceof A2AStreamUpdateEvent)
    const resultEvents = items.filter((e) => e instanceof AgentResultEvent)

    expect(streamUpdates.length).toBeGreaterThan(0)
    expect(resultEvents).toHaveLength(1)

    // Each stream update should have a valid A2A event kind
    for (const update of streamUpdates) {
      expect(['message', 'task', 'status-update', 'artifact-update']).toContain(
        (update as A2AStreamUpdateEvent).event.kind
      )
    }

    // Final result should contain the response
    expect(result.stopReason).toBe('endTurn')
    expect(result.lastMessage.role).toBe('assistant')
    expect((result.lastMessage.content[0] as TextBlock).text.toLowerCase()).toContain('pong')
  })
})
