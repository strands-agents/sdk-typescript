import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { takeResult } from '@modelcontextprotocol/sdk/shared/responseMessage.js'
import type { JSONSchema, JSONValue } from './types/json.js'
import { McpTool } from './tools/mcp-tool.js'

/** Temporary placeholder for RuntimeConfig */
export interface RuntimeConfig {
  applicationName?: string
  applicationVersion?: string
}

/**
 * Configuration for MCP task-augmented tool execution.
 *
 * WARNING: MCP Tasks is an experimental feature in both the MCP specification and this SDK.
 * The API may change without notice in future versions.
 *
 * When provided to McpClient, enables task-based tool invocation which supports
 * long-running tools with progress tracking. Without this config, tools are
 * called directly without task management.
 */
export interface TasksConfig {
  /**
   * Time-to-live in milliseconds for task polling.
   * Defaults to 60000 (60 seconds).
   */
  ttl?: number

  /**
   * Maximum time in milliseconds to wait for task completion during polling.
   * Defaults to 300000 (5 minutes).
   */
  pollTimeout?: number
}

/** Arguments for configuring an MCP Client. */
export type McpClientConfig = RuntimeConfig & {
  transport: Transport
  /**
   * Configuration for task-augmented tool execution (experimental).
   * When provided (even as empty object), enables MCP task-based tool invocation.
   * When undefined, tools are called directly without task management.
   */
  tasksConfig?: TasksConfig
}

/** MCP Client for interacting with Model Context Protocol servers. */
export class McpClient {
  /** Default TTL for task polling in milliseconds (60 seconds). */
  public static readonly DEFAULT_TTL = 60000

  /** Default poll timeout for task completion in milliseconds (5 minutes). */
  public static readonly DEFAULT_POLL_TIMEOUT = 300000

  private _clientName: string
  private _clientVersion: string
  private _transport: Transport
  private _connected: boolean
  private _client: Client
  private _tasksConfig: TasksConfig | undefined

  constructor(args: McpClientConfig) {
    this._clientName = args.applicationName || 'strands-agents-ts-sdk'
    this._clientVersion = args.applicationVersion || '0.0.1'
    this._transport = args.transport
    this._connected = false
    this._tasksConfig = args.tasksConfig
    this._client = new Client({
      name: this._clientName,
      version: this._clientVersion,
    })
  }

  get client(): Client {
    return this._client
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
      await this._client.close()
      this._connected = false
    }

    await this._client.connect(this._transport)

    this._connected = true
  }

  /**
   * Disconnects the MCP client from the server and cleans up resources.
   *
   * @returns A promise that resolves when the disconnection is complete.
   */
  public async disconnect(): Promise<void> {
    // Must be done sequentially
    await this._client.close()
    await this._transport.close()
    this._connected = false
  }

  /**
   * Lists the tools available on the server and returns them as executable McpTool instances.
   *
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
   *
   * When `tasksConfig` was provided to the client constructor, uses experimental
   * task-based invocation which supports long-running tools with progress tracking.
   * Otherwise, calls tools directly without task management.
   *
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

    const toolArgs = args as Record<string, unknown>

    // When tasksConfig is undefined, call tools directly without task management
    if (this._tasksConfig === undefined) {
      return (await this._client.callTool({ name: tool.name, arguments: toolArgs })) as JSONValue
    }

    // When tasksConfig is defined (even as empty object), use task-based invocation
    // which supports long-running tools with progress tracking
    const stream = this._client.experimental.tasks.callToolStream(
      { name: tool.name, arguments: toolArgs },
      undefined, // resultSchema - use default CallToolResultSchema
      {
        timeout: this._tasksConfig.ttl ?? McpClient.DEFAULT_TTL,
        maxTotalTimeout: this._tasksConfig.pollTimeout ?? McpClient.DEFAULT_POLL_TIMEOUT,
        resetTimeoutOnProgress: true,
      }
    )

    const result = await takeResult(stream)
    return result as JSONValue
  }
}
