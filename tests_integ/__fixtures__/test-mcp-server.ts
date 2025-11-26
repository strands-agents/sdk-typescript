/**
 * Test MCP Server Implementation
 *
 * Provides a simple MCP server with test tools for integration testing via stdio transport.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

/**
 * Creates a test MCP server with echo, calculator, and error_tool tools.
 */
function createTestServer(): Server {
  const server = new Server(
    {
      name: 'test-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  // Register ListTools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'echo',
          description: 'Echoes back the input message',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
        },
        {
          name: 'calculator',
          description: 'Performs basic arithmetic operations',
          inputSchema: {
            type: 'object',
            properties: {
              operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
              a: { type: 'number' },
              b: { type: 'number' },
            },
            required: ['operation', 'a', 'b'],
          },
        },
        {
          name: 'error_tool',
          description: 'Intentionally throws an error for testing error handling',
          inputSchema: {
            type: 'object',
            properties: {
              error_message: { type: 'string' },
            },
          },
        },
      ],
    }
  })

  // Register CallTool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    switch (name) {
      case 'echo': {
        const message = (args as { message?: string }).message || ''
        return {
          content: [
            {
              type: 'text',
              text: message,
            },
          ],
        }
      }

      case 'calculator': {
        const { operation, a, b } = args as { operation: string; a: number; b: number }
        let result: number

        switch (operation) {
          case 'add':
            result = a + b
            break
          case 'subtract':
            result = a - b
            break
          case 'multiply':
            result = a * b
            break
          case 'divide':
            if (b === 0) {
              return {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: 'Division by zero',
                  },
                ],
              }
            }
            result = a / b
            break
          default:
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `Unknown operation: ${operation}`,
                },
              ],
            }
        }

        return {
          content: [
            {
              type: 'text',
              text: `Result: ${result}`,
            },
          ],
        }
      }

      case 'error_tool': {
        const errorMessage = (args as { error_message?: string }).error_message || 'Intentional error'
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: errorMessage,
            },
          ],
        }
      }

      default:
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
        }
    }
  })

  return server
}

/**
 * Starts a stdio MCP server.
 * The server reads from stdin and writes to stdout.
 * Process cleanup is handled automatically when the parent process closes the transport.
 */
async function startStdioServer(): Promise<void> {
  const server = createTestServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Keep process alive - process will be killed when transport is closed by client
  process.stdin.resume()
}

// Start the stdio server when this file is run directly
startStdioServer().catch(console.error)
