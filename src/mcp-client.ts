import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONValue } from './types/json'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { type CallToolResult, type ListToolsResult, type Tool } from '@modelcontextprotocol/sdk/types.js'

export { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export type StdioTransportArgs = StdioServerParameters & {
  type: 'stdio'
}

export type StreamableHttpTransportArgs = {
  type: 'streamableHttp'
  transport: StreamableHTTPClientTransport
}

export type WebSocketTransportArgs = WebSocketClientTransport & {
  type: 'webSocket'
  url: string
}

export type McpClientTransportArgs = StdioTransportArgs | StreamableHttpTransportArgs | WebSocketTransportArgs

/**
 * Arguments for configuring an MCP Client.
 */
export type McpClientConfig = {
  name: string
  transport: McpClientTransportArgs
  /**
   * Optional filter function for selecting tools
   *
   * If provided, only tools for which this function returns true will be available to an agent.
   */
  toolFilter?: (tool: Tool) => boolean
}

/**
 * MCP Client for interacting with Model Context Protocol servers.
 */
export class McpClient {
  private config: McpClientConfig
  private transport: Transport
  private client: Client

  constructor(config: McpClientConfig) {
    this.config = config

    const transport = config.transport
    switch (transport.type) {
      case 'stdio':
        this.transport = new StdioClientTransport(transport)
        break
      case 'streamableHttp':
        this.transport = transport.transport as Transport
        break
      case 'webSocket':
        this.transport = new WebSocketClientTransport(new URL(transport.url))
        break
    }

    this.client = new Client({
      name: config.name,
      version: '', // TODO(chay)
    })

    this.client.connect(this.transport)
  }

  [Symbol.dispose](): void {
    this.client.close()
    this.transport.close()
  }

  get name(): string {
    return this.config.name
  }

  /**
   * List the tools associated with this McpClient session.
   */
  public async listTools(): Promise<Tool[]> {
    const result = (await this.client.listTools()) as ListToolsResult

    var tools = []
    for (const tool of result.tools || []) {
      if (this.config.toolFilter && !this.config.toolFilter(tool)) {
        continue
      }

      tools.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })
    }

    return tools
  }

  /**
   * Invoke a tool on the connected MCP server.
   * @param name - The name of the tool to invoke.
   * @param args - The arguments to pass to the tool.
   * @returns A promise that resolves with the result of the tool invocation.
   */
  public async callTool(tool: Tool, args?: Record<string, unknown>): Promise<JSONValue | null> {
    if (this.config.toolFilter && !this.config.toolFilter(tool)) {
      return null
    }

    const result = (await this.client.callTool({
      name: tool.name,
      arguments: args,
    })) as CallToolResult

    // Rich, JSON-compatible output.
    if (result.structuredContent !== undefined) {
      return result.structuredContent as JSONValue
    }

    // Fall back to text-based tool outputs.
    if (result.content !== undefined) {
      // Protocol asserts that content must be an array.
      return Array.isArray(result.content) ? (result.content as JSONValue[]) : [result.content as JSONValue]
    }

    // No discernible output.
    return null
  }
}
