/**
 * MCP Integration Tests
 *
 * Tests Agent integration with MCP servers using all transport types.
 * Verifies that agents can successfully use MCP tools via the Bedrock model.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { McpClient, Agent } from '@strands-agents/sdk'
import { BedrockModel } from '@strands-agents/sdk/bedrock'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { resolve } from 'node:path'
import { URL } from 'node:url'
import type { HttpServerInfo } from './__fixtures__/test-mcp-server.js'

type TransportConfig = {
  name: string
  createClient: () => McpClient | Promise<McpClient>
  cleanup?: () => Promise<void>
}

describe('MCP Integration Tests', () => {
  const serverPath = resolve(process.cwd(), 'tests_integ/__fixtures__/test-mcp-server.ts')
  let sseServerInfo: HttpServerInfo | undefined
  let httpServerInfo: HttpServerInfo | undefined

  beforeAll(async () => {
    // Start HTTP-based servers
    const { startSSEServer, startHTTPServer } = await import('./__fixtures__/test-mcp-server.js')
    sseServerInfo = await startSSEServer()
    httpServerInfo = await startHTTPServer()
  }, 30000)

  afterAll(async () => {
    if (sseServerInfo) {
      await sseServerInfo.close()
    }
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
      name: 'SSE',
      createClient: () => {
        if (!sseServerInfo) throw new Error('SSE server not started')
        return new McpClient({
          applicationName: 'test-mcp-sse',
          transport: new SSEClientTransport(new URL(sseServerInfo.url)),
        })
      },
    },
    {
      name: 'Streamable HTTP',
      createClient: () => {
        if (!httpServerInfo) throw new Error('HTTP server not started')
        return new McpClient({
          applicationName: 'test-mcp-http',
          transport: new StreamableHTTPClientTransport(new URL(httpServerInfo.url)),
        })
      },
    },
  ]

  describe.each(transports)('$name transport', ({ createClient }) => {
    it('agent can use MCP echo tool with Bedrock', async () => {
      const client = await createClient()
      try {
        const model = new BedrockModel({ maxTokens: 200 })

        const agent = new Agent({
          systemPrompt: 'You are a helpful assistant. Use the echo tool to repeat messages back to the user.',
          tools: [client],
          model,
        })

        const result = await agent.invoke('Use the echo tool to say "Integration test success"')

        expect(result).toBeDefined()
        expect(result.stopReason).toBeDefined()

        // Verify that the echo tool was used
        const hasToolUse = agent.messages.some((msg) =>
          msg.content.some((block) => block.type === 'toolUseBlock' && block.name === 'echo')
        )
        expect(hasToolUse).toBe(true)
      } finally {
        client[Symbol.dispose]()
      }
    }, 30000)

    it('agent can use MCP calculator tool with Bedrock', async () => {
      const client = await createClient()
      try {
        const model = new BedrockModel({ maxTokens: 200 })

        const agent = new Agent({
          systemPrompt:
            'You are a helpful assistant. Use the calculator tool to perform arithmetic operations. When asked to calculate something, use the calculator tool.',
          tools: [client],
          model,
        })

        const result = await agent.invoke('What is 25 plus 17? Use the calculator tool.')

        expect(result).toBeDefined()
        expect(result.stopReason).toBeDefined()

        // Verify that the calculator tool was used
        const hasCalculatorUse = agent.messages.some((msg) =>
          msg.content.some((block) => block.type === 'toolUseBlock' && block.name === 'calculator')
        )
        expect(hasCalculatorUse).toBe(true)
      } finally {
        client[Symbol.dispose]()
      }
    }, 30000)

    it('agent handles MCP tool errors gracefully', async () => {
      const client = await createClient()
      try {
        const model = new BedrockModel({ maxTokens: 200 })

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
      } finally {
        client[Symbol.dispose]()
      }
    }, 30000)
  })
})
