import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONValue } from './types/json'

// Temporary placeholder for RuntimeConfig
export interface RuntimeConfig {
  applicationName: string
  applicationVersion: string
}

/**
 * Local MCP client that spawns a local MCP server process.
 */
export interface LocalMcpClientArgs extends StdioServerParameters {
  type: 'local'
}

/**
 * Remote MCP client that connects to an MCP server over WebSocket.
 */
export interface RemoteMcpClientArgs {
  type: 'remote'
  url: string
}

/**
 * Arguments for configuring an MCP Client.
 */
export type McpClientArgs = RuntimeConfig & (LocalMcpClientArgs | RemoteMcpClientArgs)

/**
 * MCP Client for interacting with Model Context Protocol servers.
 */
export class McpClient {
  private args: McpClientArgs
  private transport: Transport
  private client: Client

  constructor(args: McpClientArgs) {
    this.args = args

    switch (args.type) {
      case 'local':
        this.transport = new StdioClientTransport(args)
        break
      case 'remote':
        this.transport = new WebSocketClientTransport(new URL(args.url))
        break
    }

    this.client = new Client({
      name: args.applicationName,
      version: args.applicationVersion,
    })

    this.client.connect(this.transport)
  }

  [Symbol.dispose](): void {
    this.client.close()
    this.transport.close()
  }

  public async listTools(): Promise<string[]> {
    const tools = await this.client.listTools()
    return tools.map((tool) => tool.name)
  }

  /**
   * Invoke a tool on the connected MCP server.
   * @param name - The name of the tool to invoke.
   * @param args - The arguments to pass to the tool.
   * @returns A promise that resolves with the result of the tool invocation.
   */
  public async callTool(name: string, args: JSONValue): Promise<JSONValue> {
    // The SDK's client instance handles the tool invocation.
    const result = await this.client.callTool({
      name,
      arguments: args,
    })

    return result
  }
}
