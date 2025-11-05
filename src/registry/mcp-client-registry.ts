import { Registry } from './registry'
import type { McpClient } from '../mcp-client'
import { randomUUID } from 'crypto'

/**
 * A unique, structured identifier for an McpClient instance.
 */
export type McpClientIdentifier = {
  readonly type: 'mcpClientIdentifier'
  readonly id: string
}

/**
 * A concrete implementation of the Registry for managing McpClient instances.
 */
export class McpClientRegistry extends Registry<McpClient, McpClientIdentifier> {
  /**
   * Generates a unique identifier for an McpClient.
   * @override
   * @returns A new McpClientIdentifier object with a UUID.
   */
  protected generateId(): McpClientIdentifier {
    return { type: 'mcpClientIdentifier', id: randomUUID() }
  }

  protected validate(_client: McpClient): void {}

  /**
   * Retrieves the first MCP client that matches the given name.
   * @param name - The name of the client to retrieve.
   * @returns The client if found, otherwise undefined.
   */
  public getByName(name: string): McpClient | undefined {
    return this.find((client) => client.name === name)
  }

  /**
   * Finds and removes the first MCP client that matches the given name.
   * @param name - The name of the client to remove.
   */
  public removeByName(name: string): void {
    this.findRemove((client) => client.name === name)
  }
}
