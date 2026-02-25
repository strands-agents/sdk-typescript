/**
 * MCP instrumentation for distributed tracing.
 *
 * This module patches MCP client calls to inject OpenTelemetry context,
 * enabling distributed tracing across agent and MCP server boundaries.
 */

import { context, propagation, trace } from '@opentelemetry/api'
import { logger } from '../logging/index.js'
import type { McpClient } from '../mcp.js'
import type { McpTool } from './mcp-tool.js'
import type { JSONValue } from '../types/json.js'

/**
 * WeakSet to track instrumented clients without polluting the object.
 */
const _instrumentedClients = new WeakSet<McpClient>()

/**
 * Carrier object for OpenTelemetry context propagation.
 */
interface ContextCarrier {
  [key: string]: string | string[] | undefined
}

/**
 * Patches an MCP client to inject OpenTelemetry context into tool calls.
 * This enables distributed tracing by propagating trace context to MCP servers.
 *
 * @param mcpClient - The MCP client to instrument
 */
export function instrumentMcpClient(mcpClient: McpClient): void {
  if (_instrumentedClients.has(mcpClient)) {
    return
  }
  _instrumentedClients.add(mcpClient)

  // Store original callTool method
  const originalCallTool = mcpClient.callTool.bind(mcpClient)

  // Patch callTool to inject tracing context
  mcpClient.callTool = async function (tool: McpTool, args: JSONValue): Promise<JSONValue> {
    try {
      const currentContext = context.active()
      const currentSpan = trace.getSpan(currentContext)

      // Only inject context if we have a span with a valid trace ID
      if (currentSpan && currentSpan.spanContext().traceId) {
        // Create carrier for context propagation
        const carrier: ContextCarrier = {}

        // Inject current context into carrier (includes W3C traceparent header)
        propagation.inject(currentContext, carrier)

        // Add trace context to _meta field.
        // This follows the convention for propagating trace context
        // to MCP servers. Servers that support distributed tracing can extract
        // the context from _meta; others will ignore it.
        let enhancedArgs = args

        if (args === null || args === undefined) {
          enhancedArgs = { _meta: carrier as unknown as JSONValue }
        } else if (typeof args === 'object') {
          enhancedArgs = {
            ...args,
            _meta: carrier as unknown as JSONValue,
          }
        }

        return await originalCallTool(tool, enhancedArgs)
      }

      // No active span, call without context injection
      return await originalCallTool(tool, args)
    } catch (error) {
      logger.warn(`error=<${error}> | failed to inject context into mcp tool call`)
      // Fall back to original call on error
      return await originalCallTool(tool, args)
    }
  }
}
