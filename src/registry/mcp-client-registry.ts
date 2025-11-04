import { v4 as uuidv4 } from 'uuid'
import { Registry } from './registry'
import type { McpClient } from '../mcp-client'
import type { McpClientIdentifier } from '../agent'

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
    return { type: 'mcpClientIdentifier', id: uuidv4() }
  }

  protected validate(_client: McpClient): void {}
}
