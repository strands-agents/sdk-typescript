/**
 * MCP Integration Tests
 *
 * Tests the MCP client integration with real MCP servers using all three transport types:
 * - stdio transport
 * - SSE transport
 * - Streamable HTTP transport
 */

import { describe, it, expect } from 'vitest'
import { McpClient, Agent, TextBlock, ToolResultBlock } from '@strands-agents/sdk'
import { BedrockModel } from '@strands-agents/sdk/bedrock'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolve } from 'node:path'

/**
 * Executes a tool stream to completion and returns the final result.
 */
async function runTool<T>(gen: AsyncGenerator<unknown, T, unknown>): Promise<T> {
  let result = await gen.next()
  while (!result.done) {
    result = await gen.next()
  }
  return result.value as T
}

describe('MCP Integration Tests', () => {
  describe('stdio transport', () => {
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

    describe('Connection', () => {
      it('connects to MCP server via stdio', async () => {
        const client = createStdioClient()
        try {
          await client.connect()
          expect(client).toBeDefined()

          // Verify we can list tools after connecting
          const tools = await client.listTools()
          expect(tools.length).toBeGreaterThan(0)
        } finally {
          client[Symbol.dispose]()
        }
      })
    })

    describe('Tool Discovery', () => {
      it('lists tools from MCP server', async () => {
        const client = createStdioClient()
        try {
          const tools = await client.listTools()

          expect(tools).toHaveLength(3)
          expect(tools.map((t) => t.name)).toContain('echo')
          expect(tools.map((t) => t.name)).toContain('calculator')
          expect(tools.map((t) => t.name)).toContain('error_tool')
        } finally {
          client[Symbol.dispose]()
        }
      })

      it('converts tool specs to McpTool instances', async () => {
        const client = createStdioClient()
        try {
          const tools = await client.listTools()
          const echoTool = tools.find((t) => t.name === 'echo')

          expect(echoTool).toBeDefined()
          expect(echoTool!.name).toBe('echo')
          expect(echoTool!.description).toBe('Echoes back the input message')
          expect(echoTool!.toolSpec.inputSchema).toEqual({
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          })
        } finally {
          client[Symbol.dispose]()
        }
      })

      it('verifies calculator tool metadata', async () => {
        const client = createStdioClient()
        try {
          const tools = await client.listTools()
          const calcTool = tools.find((t) => t.name === 'calculator')

          expect(calcTool).toBeDefined()
          expect(calcTool!.name).toBe('calculator')
          expect(calcTool!.description).toBe('Performs basic arithmetic operations')
          expect(calcTool!.toolSpec.inputSchema).toEqual({
            type: 'object',
            properties: {
              operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
              a: { type: 'number' },
              b: { type: 'number' },
            },
            required: ['operation', 'a', 'b'],
          })
        } finally {
          client[Symbol.dispose]()
        }
      })
    })

    describe('Tool Execution', () => {
      it('executes echo tool and receives text response', async () => {
        const client = createStdioClient()
        try {
          const tools = await client.listTools()
          const echoTool = tools.find((t) => t.name === 'echo')!

          const context = {
            toolUse: {
              toolUseId: 'test-1',
              name: 'echo',
              input: { message: 'Hello, World!' },
            },
            agent: {} as any,
          }

          const result = await runTool<ToolResultBlock>(echoTool.stream(context))

          expect(result).toBeDefined()
          expect(result.status).toBe('success')
          expect(result.toolUseId).toBe('test-1')
          expect(result.content).toHaveLength(1)

          const textContent = result.content[0] as TextBlock
          expect(textContent.type).toBe('textBlock')
          expect(textContent.text).toBe('Hello, World!')
        } finally {
          client[Symbol.dispose]()
        }
      })

      it('executes calculator tool with all operations', async () => {
        const client = createStdioClient()
        try {
          const tools = await client.listTools()
          const calcTool = tools.find((t) => t.name === 'calculator')!

          // Test add
          let result = await runTool<ToolResultBlock>(
            calcTool.stream({
              toolUse: {
                toolUseId: 'test-add',
                name: 'calculator',
                input: { operation: 'add', a: 5, b: 3 },
              },
              agent: {} as any,
            })
          )

          expect(result.status).toBe('success')
          expect((result.content[0] as TextBlock).text).toBe('Result: 8')

          // Test subtract
          result = await runTool<ToolResultBlock>(
            calcTool.stream({
              toolUse: {
                toolUseId: 'test-sub',
                name: 'calculator',
                input: { operation: 'subtract', a: 10, b: 4 },
              },
              agent: {} as any,
            })
          )

          expect(result.status).toBe('success')
          expect((result.content[0] as TextBlock).text).toBe('Result: 6')

          // Test multiply
          result = await runTool<ToolResultBlock>(
            calcTool.stream({
              toolUse: {
                toolUseId: 'test-mul',
                name: 'calculator',
                input: { operation: 'multiply', a: 7, b: 6 },
              },
              agent: {} as any,
            })
          )

          expect(result.status).toBe('success')
          expect((result.content[0] as TextBlock).text).toBe('Result: 42')

          // Test divide
          result = await runTool<ToolResultBlock>(
            calcTool.stream({
              toolUse: {
                toolUseId: 'test-div',
                name: 'calculator',
                input: { operation: 'divide', a: 20, b: 4 },
              },
              agent: {} as any,
            })
          )

          expect(result.status).toBe('success')
          expect((result.content[0] as TextBlock).text).toBe('Result: 5')
        } finally {
          client[Symbol.dispose]()
        }
      })

      it('handles errors from error_tool', async () => {
        const client = createStdioClient()
        try {
          const tools = await client.listTools()
          const errorTool = tools.find((t) => t.name === 'error_tool')!

          const result = await runTool<ToolResultBlock>(
            errorTool.stream({
              toolUse: {
                toolUseId: 'test-error',
                name: 'error_tool',
                input: { error_message: 'Test error message' },
              },
              agent: {} as any,
            })
          )

          expect(result).toBeDefined()
          expect(result.status).toBe('error')
          expect(result.toolUseId).toBe('test-error')

          const textContent = result.content[0] as TextBlock
          expect(textContent.text).toBe('Test error message')
        } finally {
          client[Symbol.dispose]()
        }
      })

      it('handles division by zero error', async () => {
        const client = createStdioClient()
        try {
          const tools = await client.listTools()
          const calcTool = tools.find((t) => t.name === 'calculator')!

          const result = await runTool<ToolResultBlock>(
            calcTool.stream({
              toolUse: {
                toolUseId: 'test-div-zero',
                name: 'calculator',
                input: { operation: 'divide', a: 10, b: 0 },
              },
              agent: {} as any,
            })
          )

          expect(result).toBeDefined()
          expect(result.status).toBe('error')
          const textContent = result.content[0] as TextBlock
          expect(textContent.text).toBe('Division by zero')
        } finally {
          client[Symbol.dispose]()
        }
      })
    })

    describe('Agent Integration', () => {
      it('agent can use MCP tools with Bedrock', async () => {
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

          // Check that a tool was used
          const hasToolUse = agent.messages.some((msg) =>
            msg.content.some((block) => block.type === 'toolUseBlock' && block.name === 'echo')
          )
          expect(hasToolUse).toBe(true)
        } finally {
          client[Symbol.dispose]()
        }
      }, 30000)

      it('agent can use calculator tool with Bedrock', async () => {
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

          // Check that the calculator tool was used
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

    describe('Lifecycle', () => {
      it('connection persists across multiple invocations', async () => {
        const client = createStdioClient()
        try {
          const tools1 = await client.listTools()
          expect(tools1).toHaveLength(3)

          const tools2 = await client.listTools()
          expect(tools2).toHaveLength(3)

          expect(tools1[0]!.name).toBe(tools2[0]!.name)
        } finally {
          client[Symbol.dispose]()
        }
      })

      it('proper cleanup when client is disposed', () => {
        const testClient = createStdioClient('cleanup-test')

        expect(() => {
          testClient[Symbol.dispose]()
        }).not.toThrow()
      })
    })
  })

  describe('SSE transport', () => {
    it.skip('SSE transport tests will be added in follow-up', () => {
      // SSE transport requires more complex server setup
      // Will be implemented after stdio transport is stable
    })
  })

  describe('Streamable HTTP transport', () => {
    it.skip('HTTP transport tests will be added in follow-up', () => {
      // HTTP transport is the most complex and will be implemented
      // after stdio and SSE transports are stable
    })
  })

  describe('Multiple MCP Clients', () => {
    it.skip('multiple clients test will be added in follow-up', () => {
      // Requires handling tool name collisions
      // Will be implemented after basic transport tests are stable
    })
  })
})
