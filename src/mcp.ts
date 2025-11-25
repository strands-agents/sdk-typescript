import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONSchema, JSONValue } from './types/json.js'
import { McpTool } from './tools/mcp-tool.js'

/** Temporary placeholder for RuntimeConfig */
export interface RuntimeConfig {
  applicationName?: string
  applicationVersion?: string
}

/** Arguments for configuring an MCP Client. */
export type McpClientConfig = RuntimeConfig & { transport: Transport }

/** MCP Client for interacting with Model Context Protocol servers. */
export class McpClient {
  private _clientName: string
  private _clientVersion: string
  private _transport: Transport
  private _connected: boolean
  private _client: Client

  constructor(args: McpClientConfig) {
    this._clientName = args.applicationName || 'strands-agents-ts-sdk'
    this._clientVersion = args.applicationVersion || '0.0.1'
    this._transport = args.transport
    this._connected = false
    this._client = new Client({
      name: this._clientName,
      version: this._clientVersion,
    })
  }

  [Symbol.dispose](): void {
    this._client.close()
    this._transport.close()
  }

  get client(): Client {
    return this.client
  }

  /**
   * Connects the MCP client to the server.
   *
   * This function is exposed to allow consumers to connect manually, but will be called lazily before any operations that require a connection.
   *
   * @returns A promise that resolves when the connection is established.
   */
  public async connect(reconnect: boolean = false): Promise<void> {
    if (this._connected && !reconnect) {
      return
    }

    if (this._connected && reconnect) {
      this._client.close()
      this._connected = false
    }

    await this._client.connect(this._transport)

    this._connected = true
  }

  /**
   * Lists the tools available on the server and returns them as executable McpTool instances.
   * @returns A promise that resolves with an array of McpTool instances.
   */
  public async listTools(): Promise<McpTool[]> {
    await this.connect()

    const result = await this._client.listTools()

    // Map the tool specifications to fully functional McpTool instances
    return result.tools.map((toolSpec) => {
      return new McpTool({
        name: toolSpec.name,
        description: toolSpec.description ?? '',
        inputSchema: toolSpec.inputSchema as JSONSchema,
        client: this,
      })
    })
  }

  /**
   * Invoke a tool on the connected MCP server using an McpTool instance.
   * @param tool - The McpTool instance to invoke.
   * @param args - The arguments to pass to the tool.
   * @returns A promise that resolves with the result of the tool invocation.
   */
  public async callTool(tool: McpTool, args: JSONValue): Promise<JSONValue> {
    await this.connect()

    if (args === null || args === undefined) {
      return await this.callTool(tool, {})
    }

    if (typeof args !== 'object' || Array.isArray(args)) {
      throw new Error(
        `MCP Protocol Error: Tool arguments must be a JSON Object (named parameters). Received: ${Array.isArray(args) ? 'Array' : typeof args}`
      )
    }

    const result = await this._client.callTool({
      name: tool.name,
      arguments: args as Record<string, unknown>,
    })

    return result as JSONValue
  }
}
