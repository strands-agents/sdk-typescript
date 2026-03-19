# Session Management

Persist and restore agent conversations across process restarts. Supports file and S3 storage backends, configurable save strategies, immutable snapshots, and app state persistence.

Docs:
- [Session Management](https://strandsagents.com/docs/user-guide/concepts/agents/session-management/)

Templates: [sessions.ts](../templates/sessions.ts)

---

## Storage backends

- `SessionManager` with `FileStorage`: save and restore a conversation
- `SessionManager` with `S3Storage`: save and restore (requires AWS credentials)
- Custom `SnapshotStorage` implementation

## Save strategies

- `'message'`: snapshot saved after every message
- `'invocation'`: snapshot saved after each invoke completes
- `'trigger'`: snapshot saved only when `snapshotTrigger` callback returns true

Watch for: Is `snapshotTrigger` called at the right time with the right context?

## Restore and delete

- Restore on init: create an agent with a session ID that already has saved data, verify messages are restored
- `deleteSession()`: delete a session, verify it's gone

Watch for: Does restore actually bring back the full conversation (not just the last message)? Does `deleteSession()` clean up all artifacts (latest + immutable snapshots)?

## Snapshots

- Immutable snapshots: verify each save creates a new snapshot (UUID v7), previous snapshots are not overwritten
- `snapshot_latest`: verify it's mutable and always points to the most recent state
- `takeSnapshot` / `loadSnapshot` with configurable field selection (messages, state, systemPrompt)
- Presets (e.g., `session` preset)
- Include/exclude field overrides
- `appData` for application-owned data passthrough

Watch for: Are immutable snapshots truly immutable (old ones unchanged after new saves)?

## App state persistence

- `agent.appState` persistence: set state, save session, restore in a new agent, verify state is restored
- Guardrail redaction persistence: if guardrails redact content, verify the redacted version is saved

Watch for: Is `agent.appState` persisted and restored correctly across sessions? Does `FileStorage` handle concurrent writes safely?
