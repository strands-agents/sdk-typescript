# Programmatic Tool Caller

Execute JavaScript code that calls the agent's other tools as async functions — a
TypeScript port of Python's [`programmatic_tool_caller`][py-pr] from `strands-agents/tools`.

[py-pr]: https://github.com/strands-agents/tools/pull/387

## ⚠️ Security warning

**This tool executes arbitrary JavaScript without a sandbox.**

- Only use with trusted agents/inputs.
- Code runs with the full permissions of the Node.js process (full filesystem and network access if not explicitly restricted via `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES`).
- For untrusted callers, deploy behind a sandbox (container, VM, separate process with seccomp).

By default the tool **does not prompt** for confirmation — there is no
vended-tool-level interactive prompt helper in the SDK (`bash` follows the same
permissive pattern). When `BYPASS_TOOL_CONSENT` is unset, a single `logger.warn`
line previewing the code is emitted before execution; treat your logs as the
audit trail.

## Why

LLM-driven tool orchestration adds an LLM round-trip per tool call. For loops,
parallel fan-outs, and "call N tools then aggregate" patterns this is wasteful.
This tool lets the model write a single block of JavaScript that calls the
other tools directly, with `await`, `Promise.all`, and ordinary control flow —
similar to Anthropic's Programmatic Tool Calling feature.

## Installation

```typescript
import { programmaticToolCaller } from '@strands-agents/sdk/vended-tools/programmatic-tool-caller'
```

## Usage

```typescript
import { Agent } from '@strands-agents/sdk'
import { programmaticToolCaller } from '@strands-agents/sdk/vended-tools/programmatic-tool-caller'

const agent = new Agent({
  model,
  tools: [programmaticToolCaller, calculator, search],
})

await agent.invoke(`Use the programmatic_tool_caller to compute the sum of search results.`)
```

When the model invokes the tool it supplies a single string parameter `code`:

```javascript
// Sequential
const a = await calculator({ expression: '1 + 1' })
const b = await calculator({ expression: '2 + 2' })
console.log('a:', a, 'b:', b)

// Parallel
const [r1, r2, r3] = await Promise.all([search({ query: 'foo' }), search({ query: 'bar' }), search({ query: 'baz' })])
console.log(r1, r2, r3)

// Loops
for (let i = 0; i < 5; i++) {
  console.log(await calculator({ expression: `${i} * 2` }))
}
```

The captured `console.log/info/warn/error/debug/trace` output is returned as
the tool result text. **Real `process.stdout` / `process.stderr` are never
written to** — output is buffered for test isolation and to keep noise out of
agent logs.

## Tool exposure rules

For each tool registered on the agent (except `programmatic_tool_caller`
itself), the tool is exposed under its **underscore-normalized name**:
`my-tool` → `my_tool`. When the original name is also a valid JavaScript
identifier the original binding is added too, so both `my_tool({...})` and
`some_camelCase_tool({...})` work.

Tool calls inside the user code:

1. Resolve the name through `agent.toolRegistry.resolve(...)` (so the same
   `_`↔`-` and case-insensitive normalization the rest of the SDK uses applies
   here as well).
2. Invoke via `agent.tool[name].invoke(input, { recordDirectToolCall: false })`
   so the inner calls **do not** mutate `agent.messages`. Only the outer
   `programmatic_tool_caller` call is recorded.
3. Auto-unwrap the resulting `ToolResultBlock`:
   - `status === 'error'` → throws `Error(text)` (your `try/catch` works).
   - All-text content → returns `text` joined by `\n`.
   - Mixed/non-text content → returns the raw `content` array.
   - Empty content → returns `''`.

## Environment variables

| Variable                                 | Purpose                                                                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS` | Comma-separated allow-list of tool names the user code may call. Default: every registered tool except `programmatic_tool_caller`.                                                                                                         |
| `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES` | Comma-separated allow-listed Node built-ins to expose under their original name. Allow-list: `fs`, `fs/promises`, `path`, `crypto`, `url`, `util`, `querystring`, `os`, `buffer`, `stream`, `events`. Anything else is logged and skipped. |
| `BYPASS_TOOL_CONSENT`                    | If unset, a `logger.warn` previews the code before execution. (Set to `"true"` to suppress the warning.)                                                                                                                                   |

## Reserved namespace

The following identifiers cannot be shadowed by tools:

- `console` — always reserved (capture buffer).
- Any module name actually injected via `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES`.

If a tool's name (or its underscore-normalized form) clashes, the tool returns
`status: 'error'` with a clear message naming the offending tools and the full
reserved set. Rename or filter via `PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS`.

## Parity with the Python tool

| Concern                | Python                                             | TypeScript                                                                    |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Tool name              | `programmatic_tool_caller`                         | `programmatic_tool_caller`                                                    |
| Single input           | `code: str`                                        | `code: string`                                                                |
| Async wrapper          | `asyncio.run(__user_code__)`                       | `new AsyncFunction(...)`                                                      |
| Always-injected module | `asyncio`                                          | `console` (capture)                                                           |
| Tool name → identifier | identity (Python tool names are valid identifiers) | hyphen → underscore (always); original name kept too if a valid JS identifier |
| Tool unwrapping        | `_execute_tool`                                    | `unwrapToolResult` (same rules)                                               |
| Allow-list env var     | `PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS`           | identical                                                                     |
| Extra modules env var  | `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES`           | identical (Node-builtins allow-list)                                          |
| Reserved names         | `asyncio`, `__name__`, plus extras                 | `console`, plus extras                                                        |
| Confirmation prompt    | `get_user_input`                                   | `logger.warn` (no vended-tool prompt helper in TS SDK)                        |
| Output capture         | `StringIO` redirect of `sys.stdout`/`stderr`       | overridden `console` shadow                                                   |
| Empty output           | `(no output)`                                      | `(no output)`                                                                 |
| Inner call recording   | `record_direct_tool_call=False`                    | `recordDirectToolCall: false`                                                 |

## Limitations

- **No human-in-the-loop**: tools that interrupt for human input are not
  supported — direct/programmatic tool calls cannot be paused. An interrupt
  surfaces as a thrown error inside the user code.
- **No sandboxing**: see security warning.
- **Node.js only**: relies on `util.inspect` and dynamic `import()` of Node
  built-ins.
