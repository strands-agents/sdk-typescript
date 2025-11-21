import { createErrorResult, Tool, type ToolContext, type ToolStreamGenerator } from './tool.js'
import type { ToolSpec } from './types.js'
import type { JSONSchema, JSONValue } from '../types/json.js'
import { JsonBlock, TextBlock, ToolResultBlock } from '../types/messages.js'
import type { McpClient } from '../mcp.js'

export interface McpToolConfig {
  name: string
  description: string
  inputSchema: JSONSchema
  client: McpClient
}

/**
 * A Tool implementation that proxies calls to a remote MCP server.
 *
 * Unlike FunctionTool, which wraps local logic, McpTool delegates execution
 * to the connected McpClient and translates the SDK's response format
 * directly into ToolResultBlocks.
 */
export class McpTool extends Tool {
  readonly name: string
  readonly description: string
  readonly toolSpec: ToolSpec
  private readonly mcpClient: McpClient

  constructor(config: McpToolConfig) {
    super()
    this.name = config.name
    this.description = config.description
    this.toolSpec = {
      name: config.name,
      description: config.description,
      inputSchema: config.inputSchema,
    }
    this.mcpClient = config.client
  }

  // eslint-disable-next-line require-yield
  async *stream(toolContext: ToolContext): ToolStreamGenerator {
    const { toolUseId, input } = toolContext.toolUse

    try {
      // Input is validated by MCP Client before invocation
      const rawResult: unknown = await this.mcpClient.callTool(this, input as JSONValue)

      if (!this._isMcpToolResult(rawResult)) {
        throw new Error('Invalid tool result from MCP Client: missing content array')
      }

      const content = rawResult.content.map((item: unknown) => {
        if (this._isMcpTextContent(item)) {
          return new TextBlock(item.text)
        }

        return new JsonBlock({ json: item as JSONValue })
      })

      if (content.length === 0) {
        content.push(new TextBlock('Tool execution completed successfully with no output.'))
      }

      return new ToolResultBlock({
        toolUseId,
        status: rawResult.isError ? 'error' : 'success',
        content,
      })
    } catch (error) {
      return createErrorResult(error, toolUseId)
    }
  }

  /**
   * Type Guard: Checks if value matches the expected MCP SDK result shape.
   * \{ content: unknown[]; isError?: boolean \}
   */
  private _isMcpToolResult(value: unknown): value is { content: unknown[]; isError?: boolean } {
    if (typeof value !== 'object' || value === null) {
      return false
    }

    // Safe cast to generic record to check properties
    const record = value as Record<string, unknown>

    return Array.isArray(record.content)
  }

  /**
   * Type Guard: Checks if an item is a Text content block.
   * \{ type: 'text'; text: string \}
   */
  private _isMcpTextContent(value: unknown): value is { type: 'text'; text: string } {
    if (typeof value !== 'object' || value === null) {
      return false
    }

    const record = value as Record<string, unknown>

    return record.type === 'text' && typeof record.text === 'string'
  }
}
