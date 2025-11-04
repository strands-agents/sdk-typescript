import { ToolContext, Agent } from '@strands-agents/sdk'
import { ToolStreamGenerator } from '../../../dist/tools/tool'
import { BedrockModel } from '../../../dist/models/bedrock'
import { McpClient } from '../../../dist/mcp-client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const exampleTool = {
  name: 'example-tool',
  description: 'An example tool',
  toolSpec: {
    name: 'example-tool',
    description: 'An example tool',
    inputSchema: {
      type: 'object' as const,
      properties: {
        exampleInput: { type: 'string' as const },
      },
      required: ['exampleInput'],
    },
  },
  stream: function (toolContext: ToolContext): ToolStreamGenerator {
    throw new Error('Function not implemented.')
  },
}

const exampleTool2 = exampleTool
exampleTool2.name = 'example-tool-2'

const agent = new Agent({
  model: new BedrockModel(),
  tools: [exampleTool],
  mcpClients: [],
}).invoke()

// Alternatively
var agent2 = new Agent({
  model: new BedrockModel(),
})

agent2.tools = [exampleTool]
agent2.mcpClients = []
agent2.invoke()

agent2.removeToolByName('example-tool')
const exampleToolIdent = agent2.addTool(exampleTool)
agent2.getTool(exampleToolIdent)
agent2.removeTool(exampleToolIdent)

// If you want to manage tools manually
const agent3 = new Agent({
  model: new BedrockModel(),
  tools: [],
  mcpClients: [],
})
const tool1 = agent3.addTool(exampleTool)
const gitClient = agent3.addMcpClient(
  new McpClient({
    name: 'git-client',
    transport: {
      type: 'streamableHttp',
      transport: new StreamableHTTPClientTransport(new URL('http://localhost:3000/')),
    },
  })
)
