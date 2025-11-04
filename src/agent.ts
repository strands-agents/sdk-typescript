import type { Tool } from '.'
import type { McpClient } from './mcp-client'
import type { BaseModelConfig, Model } from './models/model'
import { McpClientRegistry } from './registry/mcp-client-registry'
import { ToolRegistry } from './registry/tool-registry'

/**
 * Configuration object for creating a new Agent.
 */
export type AgentConfig = {
  /**
   * The model instance that the agent will use to make decisions.
   */
  model: Model<BaseModelConfig>
  /**
   * An initial set of tools to register with the agent.
   */
  tools?: Tool[]
  /**
   * An initial set of MCP clients to register with the agent.
   */
  mcpClients?: McpClient[]
}

/**
 * A unique, structured identifier for an McpClient instance.
 */
export type McpClientIdentifier = {
  readonly type: 'mcpClientIdentifier'
  readonly id: string
}

/**
 * A unique, structured identifier for a Tool instance.
 */
export type ToolIdentifier = {
  readonly type: 'toolIdentifier'
  readonly id: string
}

/**
 * Orchestrates the interaction between a model, a set of tools, and MCP clients.
 * The Agent is responsible for managing the lifecycle of tools and clients
 * and invoking the core decision-making loop.
 */
export class Agent {
  private _model: Model<BaseModelConfig>
  private _tools: ToolRegistry
  private _mcpClients: McpClientRegistry

  /**
   * Creates an instance of the Agent.
   * @param config - The configuration for the agent.
   */
  constructor(config: AgentConfig) {
    this._model = config.model
    this._tools = new ToolRegistry()
    this._mcpClients = new McpClientRegistry()
  }

  /**
   * The tools this agent can use.
   */
  get tools(): Tool[] {
    return this._tools.values()
  }

  set tools(tools: Tool[]) {
    this._tools.clear()
    this._tools.registerAll(tools)
  }

  /**
   * The MCP clients this agent has access to.
   */
  get mcpClients(): McpClient[] {
    return this._mcpClients.values()
  }

  set mcpClients(clients: McpClient[]) {
    this._mcpClients.clear()
    this._mcpClients.registerAll(clients)
  }

  /**
   * Retrieves a tool by its unique identifier.
   * @param id - The identifier of the tool to retrieve.
   * @returns The tool if found, otherwise undefined.
   */
  public getTool(id: ToolIdentifier): Tool | undefined {
    return this._tools.get(id)
  }

  /**
   * Retrieves the first tool that matches the given name.
   * @param name - The name of the tool to retrieve.
   * @returns The tool if found, otherwise undefined.
   */
  public getToolByName(name: string): Tool | undefined {
    return this._tools.find((tool) => tool.name === name)
  }

  /**
   * Adds a new tool to the agent's registry.
   * @param tool - The tool instance to add.
   * @returns The unique identifier assigned to the newly added tool.
   * @throws ValidationError If the tool is invalid (e.g., duplicate name).
   */
  public addTool(tool: Tool): ToolIdentifier {
    return this._tools.register(tool)
  }

  /**
   * Removes a tool from the agent's registry using its unique identifier.
   * @param id - The identifier of the tool to remove.
   * @throws ItemNotFoundError If no tool with the given ID is found.
   */
  public removeTool(id: ToolIdentifier): void {
    this._tools.deregister(id)
  }

  /**
   * Finds and removes the first tool that matches the given name.
   * If multiple tools have the same name, only the first one found is removed.
   * @param name - The name of the tool to remove.
   */
  public removeToolByName(name: string): void {
    this._tools.findDeregister((tool) => tool.name === name)
  }

  /**
   * Retrieves an MCP client by its unique identifier.
   * @param id - The identifier of the client to retrieve.
   * @returns The client if found, otherwise undefined.
   */
  public getMcpClient(id: McpClientIdentifier): McpClient | undefined {
    return this._mcpClients.get(id)
  }

  /**
   * Retrieves the first MCP client that matches the given name.
   * @param name - The name of the client to retrieve.
   * @returns The client if found, otherwise undefined.
   */
  public getMcpClientByName(name: string): McpClient | undefined {
    return this._mcpClients.find((client) => client.name === name)
  }

  /**
   * Adds a new MCP client to the agent's registry.
   * @param client - The client instance to add.
   * @returns The unique identifier assigned to the newly added client.
   */
  public addMcpClient(client: McpClient): McpClientIdentifier {
    return this._mcpClients.register(client)
  }

  /**
   * Removes an MCP client from the agent's registry using its unique identifier.
   * @param id - The identifier of the client to remove.
   * @throws ItemNotFoundError If no client with the given ID is found.
   */
  public removeMcpClient(id: McpClientIdentifier): void {
    this._mcpClients.deregister(id)
  }

  /**
   * Finds and removes the first MCP client that matches the given name.
   * @param name - The name of the client to remove.
   */
  public removeMcpClientByName(name: string): void {
    this._mcpClients.findDeregister((client) => client.name === name)
  }

  /**
   * Invokes the agent's main decision-making loop.
   * This method will orchestrate the model, tools, and clients to perform a task.
   * @returns A promise that resolves when the invocation is complete.
   */
  invoke(): Promise<void> {
    // Implementation goes here
    return Promise.resolve()
  }
}
