# Plugins

The extensibility layer for agents. Hooks let you tap into lifecycle events (before/after model calls, tool calls, etc.). Plugins bundle hooks into reusable packages. Agent app state provides a key-value store accessible from tools and hooks.

Docs:
- [Hooks](https://strandsagents.com/docs/user-guide/concepts/agents/hooks/)
- [Retry Strategies](https://strandsagents.com/docs/user-guide/concepts/agents/retry-strategies/)
- [Plugins](https://strandsagents.com/docs/user-guide/concepts/plugins/)
- [State](https://strandsagents.com/docs/user-guide/concepts/agents/state/)

Templates: [plugins.ts](../templates/plugins.ts)

---

## Hooks

- `addHook()` for each lifecycle event and verify it fires:
  - `InitializedEvent`
  - `BeforeInvocationEvent` / `AfterInvocationEvent`
  - `MessageAddedEvent`
  - `BeforeModelCallEvent` / `AfterModelCallEvent`
  - `BeforeToolCallEvent` / `AfterToolCallEvent`
  - `BeforeToolsEvent` / `AfterToolsEvent`
  - `ModelStreamUpdateEvent` / `ToolStreamUpdateEvent`
  - `ContentBlockEvent` / `ModelMessageEvent`
  - `ToolResultEvent` / `AgentResultEvent`
- Cleanup: `addHook()` returns a cleanup function, call it, confirm the hook no longer fires
- Multiple hooks on the same event
- Hook that throws an error

Watch for: Do all lifecycle events fire in the expected order? Does cleanup actually unregister the hook? What happens when a hook throws?

## Retry

- Set `event.retry = true` on `AfterModelCallEvent`, verify the model call is retried
- Set `event.retry = true` on `AfterToolCallEvent`, verify the tool call is retried

Watch for: Does retry work correctly (the call is actually retried, not just ignored)?

## Plugins

- Create a custom `Plugin` with `name` and `initAgent()` method
- Register hooks inside `initAgent()`, verify they fire during agent execution
- Pass multiple plugins to an agent, verify all are initialized
- Verify built-in plugins (ConversationManager, SessionManager) are initialized automatically

Watch for: Is `initAgent()` called exactly once, on first invoke? What happens if a plugin's `initAgent()` throws?

## Agent app state

- `agent.appState.set(key, value)` and `agent.appState.get(key)` for various types (string, number, object, array)
- Deep copy: get a value, mutate it, get again, verify the stored value is unchanged
- Access state from inside a tool via `context.agent.appState`
- State persistence across multiple invocations on the same agent
- State isolation: two agents should not share state
- Set state before first invoke, verify it's available inside tools
- `get()` a key that was never set

Watch for: Is deep copy actually enforced (mutations don't leak)? Does state survive across many invocations without corruption? What does `get()` return for an unset key?
