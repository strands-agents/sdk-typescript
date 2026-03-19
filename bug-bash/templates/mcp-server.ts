/**
 * Simple local MCP server for bug bash testing.
 * Run with: npx tsx mcp-server.ts
 *
 * Provides two tools:
 * - echo: echoes back a message
 * - calculator: basic arithmetic (add, subtract, multiply, divide)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({ name: 'bug-bash-mcp-server', version: '1.0.0' })

server.tool('echo', 'Echoes back the input message', { message: { type: 'string' } }, async ({ message }) => ({
  content: [{ type: 'text', text: String(message) }],
}))

server.tool(
  'calculator',
  'Performs basic arithmetic',
  {
    operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
    a: { type: 'number' },
    b: { type: 'number' },
  },
  async ({ operation, a, b }) => {
    const ops: Record<string, (a: number, b: number) => number> = {
      add: (a, b) => a + b,
      subtract: (a, b) => a - b,
      multiply: (a, b) => a * b,
      divide: (a, b) => a / b,
    }
    const result = ops[String(operation)]?.(Number(a), Number(b))
    return { content: [{ type: 'text', text: `Result: ${result}` }] }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
