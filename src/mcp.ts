import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONSchema, JSONValue } from './types/json.js'
import { McpTool } from './tools/mcp-tool.js'
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/** Temporary placeholder for RuntimeConfig */
export interface RuntimeConfig {
  applicationName: string
  applicationVersion: string
}

/** Local MCP client that spawns a local MCP server process. */
export interface StdioMcpClientConfig extends StdioServerParameters {
  type: 'stdio'
}

/** Streamable HTTP client that connects to an MCP server over HTTP. */
export interface HttpMcpClientConfig extends StreamableHTTPClientTransportOptions {
  type: 'http'
  url: string
}

/** Remote MCP client that connects to an MCP server over WebSocket. */
export interface WebsocketMcpClientConfig {
  type: 'websocket'
  url: string
}

/** Arguments for configuring an MCP Client. */
export type McpClientConfig = RuntimeConfig & (StdioMcpClientConfig | HttpMcpClientConfig | WebsocketMcpClientConfig)

/** MCP Client for interacting with Model Context Protocol servers. */
export class McpClient {
  private args: McpClientConfig
  private transport: Transport
  private client: Client
  private connectionPromise: Promise<void>

  constructor(args: McpClientConfig) {
    this.args = args

    switch (args.type) {
      case 'stdio':
        this.transport = new StdioClientTransport(args)
        break
      case 'http':
        this.transport = new StreamableHTTPClientTransport(new URL(args.url), args) as Transport
        break
      case 'websocket':
        this.transport = new WebSocketClientTransport(new URL(args.url))
        break
    }

    this.client = new Client({
      name: args.applicationName,
      version: args.applicationVersion,
    })

    // Store the connection promise to await it in methods
    this.connectionPromise = this.client.connect(this.transport)
  }

  [Symbol.dispose](): void {
    this.client.close()
    this.transport.close()
  }

  /**
   * Lists the tools available on the server and returns them as executable McpTool instances.
   * @returns A promise that resolves with an array of McpTool instances.
   */
  public async listTools(): Promise<McpTool[]> {
    // Ensure client is connected before listing
    await this.connectionPromise

    const result = await this.client.listTools()

    // Map the tool specifications to fully functional McpTool instances
    return result.tools
      .map((toolSpec) => {
        return new McpTool({
          name: toolSpec.name,
          description: toolSpec.description ?? '',
          inputSchema: toolSpec.inputSchema as JSONSchema,
          client: this,
        })
      })
      .filter((tool): tool is McpTool => tool !== null)
  }

  /**
   * Invoke a tool on the connected MCP server using an McpTool instance.
   * @param tool - The McpTool instance to invoke.
   * @param args - The arguments to pass to the tool.
   * @returns A promise that resolves with the result of the tool invocation.
   */
  public async callTool(tool: McpTool, args: JSONValue): Promise<JSONValue> {
    // Ensure client is connected before calling
    await this.connectionPromise

    // The SDK's client instance handles the tool invocation.
    const result = await this.client.callTool({
      name: tool.name,
      arguments:
        typeof args === 'object' && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {},
    })

    return result as JSONValue
  }
}
