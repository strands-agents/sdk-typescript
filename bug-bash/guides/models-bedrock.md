# Models - Bedrock

The default model provider, backed by Amazon Bedrock's Converse API. Supports streaming, tool use, guardrails, prompt caching, reasoning, citations, and media inputs.

Docs:
- [Model Providers Overview](https://strandsagents.com/docs/user-guide/concepts/model-providers/)
- [Amazon Bedrock](https://strandsagents.com/docs/user-guide/concepts/model-providers/amazon-bedrock/)
- [Guardrails](https://strandsagents.com/docs/user-guide/safety-security/guardrails/)

Templates: [models-bedrock.ts](../templates/models-bedrock.ts)

---

## Configuration

- Default model ID vs explicit model ID
- Region and credentials configuration (profile, env vars)
- `updateConfig()` / `getConfig()` at runtime
- Inference parameters: temperature, maxTokens, topP, stopSequences
- System prompt as string and as array of content blocks

## Streaming and tool use

- Streaming and aggregated streaming modes
- Tool use: register tools, confirm the model calls them and processes results
- Tool choice: `auto`, `any`, specific tool name

Watch for: Are streaming events well-formed (no missing fields, no unexpected nulls)?

## Media and content

- Media: pass images (bytes, S3 URI, URL), documents (PDF bytes), video
- Prompt caching with `CachePointBlock` in system prompt
- Reasoning blocks (extended thinking): enable and verify thinking content appears
- Citations: send a request that produces citations, inspect `CitationsBlock` and locations
- Usage metadata: verify token counts and latency are present

Watch for: Are media blocks round-tripped correctly? Do citations reference the correct source locations?

## Guardrails

- Configure a guardrail ID, send content that should be filtered, verify redaction

Watch for: Does guardrail redaction actually remove sensitive content?

## Error handling

- Invalid model ID, expired credentials

Watch for: Are error messages clear when things go wrong?
