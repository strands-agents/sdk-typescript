import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Agent } from '@strands-agents/sdk'
import type { Task } from '@a2a-js/sdk'
import { ClientFactory } from '@a2a-js/sdk/client'
import { A2AServer, A2AAgent } from '$/sdk/a2a/index.js'
import { encodeBase64 } from '$/sdk/types/media.js'
import { collectGenerator } from '$/sdk/__fixtures__/model-test-helpers.js'
import { bedrock } from '../__fixtures__/model-providers.js'

describe.skipIf(bedrock.skip)('A2A', () => {
  let a2aAgent: A2AAgent
  let a2aServer: A2AServer
  let abortController: AbortController

  beforeAll(async () => {
    const agent = new Agent({
      model: bedrock.createModel(),
      printer: false,
      systemPrompt: 'You are a helpful assistant. Always respond in a single short sentence.',
    })

    a2aServer = new A2AServer({
      agent,
      name: 'Test A2A Agent',
      description: 'Integration test agent',
      port: 0,
    })

    abortController = new AbortController()
    await a2aServer.serve({ signal: abortController.signal })

    a2aAgent = new A2AAgent({ url: `http://127.0.0.1:${a2aServer.port}` })
  })

  afterAll(async () => {
    abortController?.abort()
  })

  describe('invoke', () => {
    it('receives a text response', async () => {
      const result = await a2aAgent.invoke('What is 2+2? Reply with just the number.')

      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')
      expect(result.lastMessage.content.length).toBeGreaterThan(0)
      expect(result.toString()).toMatch(/4/)
    })

    it('processes an image sent as a file part', async () => {
      const imagePath = join(process.cwd(), 'test/integ/__resources__/yellow.png')
      const imageBytes = new Uint8Array(await readFile(imagePath))

      const factory = new ClientFactory()
      const rawClient = await factory.createFromUrl(`http://127.0.0.1:${a2aServer.port}`)

      const result = (await rawClient.sendMessage({
        message: {
          kind: 'message',
          messageId: globalThis.crypto.randomUUID(),
          role: 'user',
          parts: [
            {
              kind: 'file',
              file: { bytes: encodeBase64(imageBytes), mimeType: 'image/png' },
            },
            { kind: 'text', text: 'What color is this image? Reply with just the color name.' },
          ],
        },
      })) as Task

      expect(result.kind).toBe('task')
      expect(result.status.state).toBe('completed')

      // Extract text from the response artifacts
      const texts = result
        .artifacts!.flatMap((a) => a.parts)
        .filter((p) => p.kind === 'text')
        .map((p) => (p as { kind: 'text'; text: string }).text)
        .join('')

      expect(texts.toLowerCase()).toContain('yellow')
    })
  })

  describe('stream', () => {
    it('yields events and returns final result', async () => {
      const { items, result } = await collectGenerator(a2aAgent.stream('Say the word test'))

      expect(items.length).toBeGreaterThan(0)
      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.content[0]!.type).toBe('textBlock')
    })
  })
})
