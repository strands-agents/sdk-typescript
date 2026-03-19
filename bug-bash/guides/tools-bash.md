# Tools - Bash

A vended tool for executing shell commands. Runs in a persistent session so environment variables and working directory carry across commands. Node.js only. Import from `@strands-agents/sdk/vended-tools/bash`.

Templates: [tools-bash.ts](../templates/tools-bash.ts)

---

## Session and execution

- Execute shell commands through the agent
- `BashSession` lifecycle: start, run commands, stop
- Session persistence: set an env var in one command, read it in the next

Watch for: Does the session actually persist state between commands?

## Timeouts and errors

- Configurable timeout: set a short timeout, run a long command, verify `BashTimeoutError`
- Verify it fails gracefully in browser (if applicable)

Watch for: Is the timeout enforced accurately? Are error messages from failed commands informative?
