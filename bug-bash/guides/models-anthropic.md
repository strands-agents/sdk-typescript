# Models - Anthropic

Direct integration with the Anthropic API using the `@anthropic-ai/sdk` client. Supports prompt caching, reasoning blocks, images, PDFs, and client configuration passthrough.

Docs:
- [Model Providers Overview](https://strandsagents.com/docs/user-guide/concepts/model-providers/)
- [Anthropic](https://strandsagents.com/docs/user-guide/concepts/model-providers/anthropic/)

Templates: [models-anthropic.ts](../templates/models-anthropic.ts)

---

## Configuration

- API key via constructor vs `ANTHROPIC_API_KEY` env var
- Pre-configured Anthropic client injection
- `clientConfig` passthrough (custom headers, base URL)
- Inference parameters: temperature, maxTokens, topP
- `updateConfig()` / `getConfig()` at runtime
- System prompt as string and as array of content blocks

Watch for: Is the `clientConfig` passthrough respected (e.g., custom base URL)?

## Streaming and tool use

- Streaming and aggregated streaming modes
- Tool use and tool choice (auto, any, specific tool)
- Usage metadata: token counts and latency

Watch for: Does streaming work correctly (events arrive incrementally)? Are usage metadata present and reasonable?

## Media and content

- Image support (pass image bytes)
- PDF document support
- Prompt caching (`cache_control` with ephemeral type), verify reduced token usage on repeated calls
- Reasoning blocks: thinking, redacted thinking, signatures

Watch for: Does prompt caching actually reduce token usage on repeated calls? Are reasoning blocks properly surfaced in the response?
