# Tools - MCP

Connect to external tool servers using the Model Context Protocol. The `McpClient` handles discovery, lazy connection, and cleanup.

Docs:
- [MCP Tools](https://strandsagents.com/docs/user-guide/concepts/tools/mcp-tools/)

Templates: [tools-mcp.ts](../templates/tools-mcp.ts), [mcp-server.ts](../templates/mcp-server.ts)

Prerequisites: The template includes a local MCP server (`mcp-server.ts`) so you can test without extra setup. Copy both files into your project. If you want to test with a remote server instead, install `uvx` ([installation guide](https://docs.astral.sh/uv/getting-started/installation/)) and uncomment the alternative transport in the template.

---

## Connection and discovery

- `McpClient` with stdio transport using the local `mcp-server.ts`
- `McpClient` with stdio transport using `uvx` (remote server)
- `McpClient` with HTTP transport (if you have an HTTP MCP server available)
- `listTools()` to discover available tools
- Lazy connection: create the client, don't call anything, then invoke the agent, confirm it connects on first use

Watch for: Does lazy connection work reliably (no premature connection attempts)?

## Agent integration

- Pass `McpClient` directly in the agent `tools` array
- Multiple MCP clients in the same agent

Watch for: Are discovered tools properly registered and callable by the model? Do multiple MCP clients coexist without conflicts?

## Cleanup and edge cases

- `disconnect()` and verify cleanup
- Task-augmented execution (experimental): if the server supports tasks, try `call_tool_as_task`
- OpenTelemetry trace context injection (if you have tracing configured)

Watch for: Does `disconnect()` clean up without errors or hanging processes? What happens if the MCP server process crashes mid-call?
