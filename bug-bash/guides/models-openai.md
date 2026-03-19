# Models - OpenAI

Direct integration with the OpenAI API using the `openai` client. Supports async API key resolution, image and document inputs, tool result media splitting, and forward-compatible parameter passthrough.

Docs:
- [Model Providers Overview](https://strandsagents.com/docs/user-guide/concepts/model-providers/)
- [OpenAI](https://strandsagents.com/docs/user-guide/concepts/model-providers/openai/)

Templates: [models-openai.ts](../templates/models-openai.ts)

---

## Configuration

- API key via constructor, `OPENAI_API_KEY` env var, and async key function
- Pre-configured OpenAI client injection
- `frequencyPenalty` / `presencePenalty` parameters
- `params` passthrough for forward compatibility
- Inference parameters: temperature, maxTokens, topP
- `updateConfig()` / `getConfig()` at runtime
- System prompt as string and as array of content blocks

Watch for: Does the async key function get called and work correctly? Are unknown `params` passed through without error?

## Streaming and tool use

- Streaming and aggregated streaming modes
- Tool use and tool choice (auto, any, specific tool)
- Usage metadata: token counts and latency

Watch for: Does streaming work correctly (events arrive incrementally)? Are usage metadata present and reasonable?

## Media and content

- Image support: bytes source and URL source
- Document support: bytes, text, and content block sources
- Tool result media splitting (images in tool results moved to user messages)

Watch for: Are images in tool results properly split into separate user messages? Does document support work across all source types?
