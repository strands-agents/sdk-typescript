import { Agent, McpClient } from '@strands-agents/sdk'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// Option 1: Local MCP server (included in templates)
const mcpClient = new McpClient({
  transport: new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'mcp-server.ts'],
  }),
})

// Option 2: Remote MCP server via uvx (requires uvx: https://docs.astral.sh/uv/getting-started/installation/)
// const mcpClient = new McpClient({
//   transport: new StdioClientTransport({
//     command: 'uvx',
//     args: ['awslabs.aws-documentation-mcp-server@latest'],
//   }),
// })

// Discover tools
const tools = await mcpClient.listTools()
console.log('Tools discovered:', tools.map(t => t.name))

// Use with an agent
const agent = new Agent({
  tools: [mcpClient],
  systemPrompt: 'You are a helpful assistant. Use your tools to answer questions.',
})

const result = await agent.invoke('What is 12 * 7? Use the calculator tool.')
console.log('Stop reason:', result.stopReason)
console.log('Response:', result.toString())

await mcpClient.disconnect()
