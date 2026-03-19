# Agent - A2A

The Agent-to-Agent protocol for exposing agents as services and calling them remotely. This covers the server (Express-based), the client (`A2AAgent`), and the type adapters that convert between Strands and A2A formats. You'll need two terminal windows.

Docs:
- [Agent-to-Agent](https://strandsagents.com/docs/user-guide/concepts/multi-agent/agent-to-agent/)

Templates: [agent-a2a.ts](../templates/agent-a2a.ts)

---

## Server

- `A2AExpressServer` standalone mode: `serve()` with host/port, verify it starts and responds
- `A2AExpressServer` middleware mode: `createMiddleware()`, mount in an existing Express app
- Agent card endpoint: `GET /.well-known/agent-card.json`, verify it returns valid JSON
- JSON-RPC endpoint: `POST /`, send a valid request, verify response
- `A2AExecutor`:
  - Text responses streamed as incremental artifact updates
  - Non-text content blocks (images, documents) published as separate artifacts
  - Task status lifecycle: working -> completed
  - Error handling: make the agent throw, verify structured error response
  - Task cancellation: attempt to cancel, verify it throws (not supported)
- Optional `UserBuilder` for authentication

Watch for: Does the agent card endpoint return a well-formed card? Are streaming artifacts delivered incrementally (not all at once)? Are error responses structured and informative?

## Client

- `A2AAgent` with `invoke()` and `stream()` against a running A2A server
- Lazy client initialization from agent card URL
- Text extraction from various `InvokeArgs` formats (string, ContentBlock[], Message[])
- Streaming events: `A2AStreamUpdateEvent`, `A2AResultEvent`
- Result building from task/message/status/artifact events

Watch for: Does the client handle server disconnection gracefully? Are streaming events emitted in a logical order?

## Adapters

- `partsToContentBlocks()`: text parts, file parts (bytes, URI), structured data
- `contentBlocksToParts()`: text blocks, image blocks, video blocks, document blocks
- Media round-tripping: send an image through A2A, verify it arrives intact
- MIME type resolution and base64 encoding/decoding

Watch for: Does media survive the round-trip (encode -> send -> decode -> compare)? Are MIME types correctly resolved?
