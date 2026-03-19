# Agent - Loop

The core agent class that orchestrates the model-tool loop. This covers creating agents, invoking them with different input formats, streaming responses, and managing conversation history.

Docs:
- [Quickstart](https://strandsagents.com/docs/user-guide/quickstart/typescript/)
- [Agent Loop](https://strandsagents.com/docs/user-guide/concepts/agents/agent-loop/)
- [Prompts](https://strandsagents.com/docs/user-guide/concepts/agents/prompts/)
- [Streaming](https://strandsagents.com/docs/user-guide/concepts/streaming/async-iterators/)

Templates: [agent-loop.ts](../templates/agent-loop.ts)

---

## Creation and configuration

- Create an agent with various config combinations (model, tools, system prompt, name, id, description)
- Agent with no tools, no system prompt (minimal config)
- System prompt as a string vs an array of content blocks
- Agent printer: enable/disable, verify console output toggles

## Invocation

- `invoke()` with different input types: plain string, ContentBlock[], Message[], MessageData[]
- Call `invoke()` twice concurrently on the same agent, confirm `ConcurrentInvocationError`
- Lazy initialization: pass MCP clients and plugins, confirm they only connect/init on first invoke

Watch for: Does input normalization handle all formats without error? Does the concurrent invocation guard actually prevent parallel calls?

## Streaming

- `stream()` and iterate over events, verify event types make sense

Watch for: Are streaming events emitted in a logical order?

## Conversation history

- Inspect `agent.messages` after multiple invocations, verify history accumulates correctly
- Mutate the messages array directly, invoke again, see what happens

Watch for: Is conversation history well-formed after many turns (proper user/assistant pairing)? Does the printer output look reasonable?
