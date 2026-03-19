# Models - Google

Integration with Google's Gemini models using the `@google/genai` client. Supports image, video, and document inputs, reasoning blocks, and error classification.

Docs:
- [Model Providers Overview](https://strandsagents.com/docs/user-guide/concepts/model-providers/)
- [Gemini](https://strandsagents.com/docs/user-guide/concepts/model-providers/gemini/)

Templates: [models-google.ts](../templates/models-google.ts)

---

## Configuration

- API key via constructor vs `GEMINI_API_KEY` env var
- Inference parameters: temperature, maxTokens, topP
- `updateConfig()` / `getConfig()` at runtime
- System prompt as string and as array of content blocks

## Streaming and tool use

- Streaming and aggregated streaming modes
- Tool use and tool choice (auto, any, specific tool)
- Usage metadata: token counts and latency

Watch for: Does streaming work correctly (events arrive incrementally)? Are usage metadata present and reasonable?

## Built-in tools

Gemini supports built-in tools via the `geminiTools` config option. These are Google-hosted capabilities that run server-side without needing a local tool definition.

```typescript
const model = new GeminiModel({
  geminiTools: [{ googleSearch: {} }],
})
```

Other built-in tools include `{ codeExecution: {} }` and `{ urlContext: {} }`.

Watch for: Does the agent correctly invoke and return results from built-in tools? Do they compose with regular function tools?

## Media and content

- Image, video, and document block adapters
- Reasoning block support

Watch for: Are media blocks (image, video, document) correctly adapted to Gemini's format? Are reasoning blocks surfaced in the response?

## Error handling

- Trigger context window overflow and throttling, verify correct error types

Watch for: Does error classification produce the right error types (not generic errors)?
