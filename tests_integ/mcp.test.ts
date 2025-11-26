/**
 * MCP Integration Tests
 *
 * Tests Agent integration with MCP servers using stdio transport.
 * Verifies that agents can successfully use MCP tools via the Bedrock model.
 */

import { describe, it, expect } from 'vitest'
import { McpClient, Agent } from '@strands-agents/sdk'
import { BedrockModel } from '@strands-agents/sdk/bedrock'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolve } from 'node:path'

describe('MCP Integration Tests', () => {
  const serverPath = resolve(process.cwd(), 'tests_integ/__fixtures__/test-mcp-server.ts')

  function createStdioClient(appName: string = 'test-mcp-client'): McpClient {
    return new McpClient({
      applicationName: appName,
      transport: new StdioClientTransport({
        command: 'npx',
        args: ['tsx', serverPath],
      }),
    })
  }

  describe('Agent Integration', () => {
    it('agent can use MCP echo tool with Bedrock', async () => {
      const client = createStdioClient()
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
      const client = createStdioClient()
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
      const client = createStdioClient()
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
