/**
 * MCP Integration Tests
 *
 * Tests Agent integration with MCP servers using all supported transport types.
 * Verifies that agents can successfully use MCP tools via the Bedrock model.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { McpClient, Agent } from '@strands-agents/sdk'
import { BedrockModel } from '@strands-agents/sdk/bedrock'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { resolve } from 'node:path'
import { URL } from 'node:url'
import { startHTTPServer, type HttpServerInfo } from './__fixtures__/test-mcp-server.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

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
      const model = new BedrockModel({ maxTokens: 300 })

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
    }, 30000)
  })

  describe('elicitation callback', () => {
    it('handles elicitation requests with accept action', async () => {
      let elicitationCalled = false
      let elicitationMessage = ''

      const client = new McpClient({
        applicationName: 'test-mcp-elicitation',
        transport: new StdioClientTransport({
          command: 'npx',
          args: ['tsx', serverPath],
        }),
        elicitationCallback: async (_context, params) => {
          elicitationCalled = true
          elicitationMessage = params.message
          return {
            action: 'accept',
            content: { confirmed: true },
          }
        },
      })

      const model = new BedrockModel({ maxTokens: 200 })

      const agent = new Agent({
        systemPrompt: 'You are a helpful assistant. Use the confirm_action tool when asked.',
        tools: [client],
        model,
      })

      const result = await agent.invoke('Use the confirm_action tool to delete a file.')

      expect(result).toBeDefined()
      expect(elicitationCalled).toBe(true)
      expect(elicitationMessage).toContain('delete a file')

      // Verify the tool was used and completed
      const hasConfirmUse = agent.messages.some((msg) =>
        msg.content.some((block) => block.type === 'toolUseBlock' && block.name === 'confirm_action')
      )
      expect(hasConfirmUse).toBe(true)

      await client.disconnect()
    }, 30000)

    it('handles elicitation requests with decline action', async () => {
      let elicitationCalled = false

      const client = new McpClient({
        applicationName: 'test-mcp-elicitation-decline',
        transport: new StdioClientTransport({
          command: 'npx',
          args: ['tsx', serverPath],
        }),
        elicitationCallback: async (_context, _params) => {
          elicitationCalled = true
          return {
            action: 'decline',
          }
        },
      })

      const model = new BedrockModel({ maxTokens: 200 })

      const agent = new Agent({
        systemPrompt: 'You are a helpful assistant. Use the confirm_action tool when asked.',
        tools: [client],
        model,
      })

      const result = await agent.invoke('Use the confirm_action tool to update settings.')

      expect(result).toBeDefined()
      expect(elicitationCalled).toBe(true)

      // Verify the tool was used
      const hasConfirmUse = agent.messages.some((msg) =>
        msg.content.some((block) => block.type === 'toolUseBlock' && block.name === 'confirm_action')
      )
      expect(hasConfirmUse).toBe(true)

      await client.disconnect()
    }, 30000)

    it('handles elicitation with requested schema', async () => {
      let receivedSchema: unknown

      const client = new McpClient({
        applicationName: 'test-mcp-elicitation-schema',
        transport: new StdioClientTransport({
          command: 'npx',
          args: ['tsx', serverPath],
        }),
        elicitationCallback: async (_context, params) => {
          receivedSchema = params.requestedSchema
          return {
            action: 'accept',
            content: { confirmed: true },
          }
        },
      })

      const model = new BedrockModel({ maxTokens: 200 })

      const agent = new Agent({
        systemPrompt: 'You are a helpful assistant. Use the confirm_action tool when asked.',
        tools: [client],
        model,
      })

      await agent.invoke('Use the confirm_action tool to restart the system.')

      expect(receivedSchema).toBeDefined()
      expect(receivedSchema).toHaveProperty('type', 'object')
      expect(receivedSchema).toHaveProperty('properties')

      await client.disconnect()
    }, 30000)
  })
})
