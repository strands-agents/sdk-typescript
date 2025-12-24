/**
 * MCP Integration Tests
 *
 * Tests Agent integration with MCP servers using all supported transport types.
 * Verifies that agents can successfully use MCP tools via the Bedrock model.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { McpClient, Agent } from '@strands-agents/sdk'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { resolve } from 'node:path'
import { URL } from 'node:url'
import { startHTTPServer, type HttpServerInfo } from './__fixtures__/test-mcp-server.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { bedrock } from './__fixtures__/model-providers.js'

type TransportConfig = {
  name: string
  createClient: () => McpClient | Promise<McpClient>
  cleanup?: () => Promise<void>
}

describe('MCP Integration Tests', () => {
  const serverPath = resolve(process.cwd(), 'test/integ/__fixtures__/test-mcp-server.ts')
  let httpServerInfo: HttpServerInfo | undefined

  beforeAll(async () => {
    // Start HTTP server
    httpServerInfo = await startHTTPServer()
  }, 30000)

  afterAll(async () => {
    if (httpServerInfo) {
      await httpServerInfo.close()
    }
  }, 30000)

  const transports: TransportConfig[] = [
    {
      name: 'stdio',
      createClient: () => {
        return new McpClient({
          applicationName: 'test-mcp-stdio',
          transport: new StdioClientTransport({
            command: 'npx',
            args: ['tsx', serverPath],
          }),
        })
      },
    },
    {
      name: 'Streamable HTTP',
      createClient: () => {
        if (!httpServerInfo) throw new Error('HTTP server not started')
        return new McpClient({
          applicationName: 'test-mcp-http',
          transport: new StreamableHTTPClientTransport(new URL(httpServerInfo.url)) as Transport,
        })
      },
    },
  ]

  describe.each(transports)('$name transport', ({ createClient }) => {
    it('agent can use multiple MCP tools in a conversation', async () => {
      const client = await createClient()
      const model = bedrock.createModel({ maxTokens: 300 })

      const agent = new Agent({
        systemPrompt:
          'You are a helpful assistant. Use the echo tool to repeat messages and the calculator tool for arithmetic.',
        tools: [client],
        model,
      })

      // First turn: Use echo tool
      await agent.invoke('Use the echo tool to say "Multi-turn test"')

      // Verify echo tool was used
      const hasEchoUse = agent.messages.some((msg) =>
        msg.content.some((block) => block.type === 'toolUseBlock' && block.name === 'echo')
      )
      expect(hasEchoUse).toBe(true)

      // Second turn: Use calculator tool in same conversation
      const result = await agent.invoke('Now use the calculator tool to add 15 and 27')

      expect(result).toBeDefined()
      expect(result.stopReason).toBeDefined()

      // Verify calculator tool was used
      const hasCalculatorUse = agent.messages.some((msg) =>
        msg.content.some((block) => block.type === 'toolUseBlock' && block.name === 'calculator')
      )
      expect(hasCalculatorUse).toBe(true)
    }, 60000)

    it('agent handles MCP tool errors gracefully', async () => {
      const client = await createClient()
      const model = bedrock.createModel({ maxTokens: 200 })

      const agent = new Agent({
        systemPrompt: 'You are a helpful assistant. If asked to test errors, use the error_tool.',
        tools: [client],
        model,
      })

      const result = await agent.invoke('Use the error_tool to test error handling.')

      expect(result).toBeDefined()

      // Verify the error was encountered
      const hasErrorResult = agent.messages.some((msg) =>
        msg.content.some((block) => block.type === 'toolResultBlock' && block.status === 'error')
      )
      expect(hasErrorResult).toBe(true)
    }, 30000)
  })
})
