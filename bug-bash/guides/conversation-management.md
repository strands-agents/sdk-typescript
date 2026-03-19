# Conversation Management

Controls how message history is managed as conversations grow. The sliding window strategy trims older messages to stay within context limits, while the null strategy lets messages accumulate freely.

Docs:
- [Conversation Management](https://strandsagents.com/docs/user-guide/concepts/agents/conversation-management/)

Templates: [conversation-management.ts](../templates/conversation-management.ts)

---

## Sliding window

- `SlidingWindowConversationManager` with default window size (40 messages)
- `SlidingWindowConversationManager` with a small window (e.g., 4 messages), verify older messages are dropped

Watch for: Does the sliding window correctly drop the oldest messages while preserving the most recent?

## Null manager

- `NullConversationManager`: messages accumulate without any management

## Overflow recovery

- Trigger a `ContextWindowOverflowError` (send a very long conversation), verify the manager reduces messages and retries
- After reduction, verify user/assistant messages are still properly paired
- Switch conversation managers between invocations

Watch for: After overflow recovery, is the conversation still coherent (no broken pairs)? Are tool use / tool result message pairs kept together during reduction?
