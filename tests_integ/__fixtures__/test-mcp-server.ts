/**
 * Test MCP Server Implementation
 *
 * Provides a simple MCP server with test tools for integration testing.
 * Supports stdio, SSE, and Streamable HTTP transports.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'

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
  const transports = new Map<string, SSEServerTransport>()

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/sse' && req.method === 'GET') {
      const transport = new SSEServerTransport('/messages', res)
      transports.set(transport.sessionId, transport)

      res.on('close', () => {
        transports.delete(transport.sessionId)
      })

      await mcpServer.connect(transport)
    } else if (req.url?.startsWith('/messages') && req.method === 'POST') {
      // Extract sessionId from query string
      const url = new URL(req.url, `http://${req.headers.host}`)
      const sessionId = url.searchParams.get('sessionId')

      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400)
        res.end('Invalid sessionId')
        return
      }

      // Read request body
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', async () => {
        const transport = transports.get(sessionId)!
        const parsedBody = JSON.parse(body)
        await transport.handlePostMessage(req, res, parsedBody)
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
  const mcpServer = createTestServer()
  const transports = new Map<string, StreamableHTTPServerTransport>()

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/mcp' && (req.method === 'GET' || req.method === 'POST' || req.method === 'DELETE')) {
      // Read request body for POST requests
      let body = ''
      if (req.method === 'POST') {
        await new Promise<void>((resolve) => {
          req.on('data', (chunk) => {
            body += chunk.toString()
          })
          req.on('end', () => {
            resolve()
          })
        })
      }

      const parsedBody = body ? JSON.parse(body) : undefined
      const sessionId = req.headers['mcp-session-id'] as string | undefined

      let transport: StreamableHTTPServerTransport

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!
      } else if (!sessionId && req.method === 'POST') {
        // New session
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => `test-session-${Date.now()}`,
          onsessioninitialized: (sid) => {
            transports.set(sid, transport)
          },
        })
        transport.onclose = () => {
          const sid = transport.sessionId
          if (sid) {
            transports.delete(sid)
          }
        }
        await mcpServer.connect(transport)
      } else {
        res.writeHead(400)
        res.end('Invalid request')
        return
      }

      await transport.handleRequest(req, res, parsedBody)
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

// Start the stdio server when this file is run directly
startStdioServer().catch(console.error)
