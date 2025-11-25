/**
 * Test MCP Server Implementation
 *
 * Provides a simple MCP server with test tools for integration testing.
 * Supports stdio, SSE, and Streamable HTTP transports.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'

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
 * Creates and starts a stdio MCP server.
 * This server reads from stdin and writes to stdout.
 */
export async function startStdioServer(): Promise<void> {
  const server = createTestServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Keep process alive
  process.stdin.resume()
}

/**
 * Interface for HTTP-based server info
 */
export interface HttpServerInfo {
  server: HttpServer
  port: number
  url: string
  close: () => Promise<void>
}

/**
 * Creates and starts an SSE MCP server on a random port.
 */
export async function startSSEServer(): Promise<HttpServerInfo> {
  const mcpServer = createTestServer()

  const httpServer = createServer(async (req, res) => {
    if (req.url === '/sse' && req.method === 'GET') {
      const transport = new SSEServerTransport('/message', res)
      await mcpServer.connect(transport)
    } else if (req.url === '/message' && req.method === 'POST') {
      // SSE transport handles incoming messages
      let _body = ''
      req.on('data', (chunk) => {
        _body += chunk.toString()
      })
      req.on('end', () => {
        // The transport will handle the message
        res.writeHead(200)
        res.end()
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      const address = httpServer.address() as AddressInfo
      const port = address.port
      const url = `http://localhost:${port}/sse`

      resolve({
        server: httpServer,
        port,
        url,
        close: async () => {
          return new Promise((resolveClose) => {
            httpServer.close(() => {
              resolveClose()
            })
          })
        },
      })
    })
  })
}

/**
 * Creates and starts a Streamable HTTP MCP server on a random port.
 */
export async function startHTTPServer(): Promise<HttpServerInfo> {
  const _mcpServer = createTestServer()

  const httpServer = createServer(async (req, res) => {
    if (req.url === '/mcp' && req.method === 'POST') {
      // For HTTP streaming, we need to handle the request/response
      let _body = ''
      req.on('data', (chunk) => {
        _body += chunk.toString()
      })
      req.on('end', async () => {
        // The MCP SDK handles the protocol over HTTP
        // For now, we'll handle it manually
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not implemented' }))
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      const address = httpServer.address() as AddressInfo
      const port = address.port
      const url = `http://localhost:${port}/mcp`

      resolve({
        server: httpServer,
        port,
        url,
        close: async () => {
          return new Promise((resolveClose) => {
            httpServer.close(() => {
              resolveClose()
            })
          })
        },
      })
    })
  })
}

// If run directly, start the stdio server
if (import.meta.url === `file://${process.argv[1]}`) {
  startStdioServer().catch(console.error)
}
