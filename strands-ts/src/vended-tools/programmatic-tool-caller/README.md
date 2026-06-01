# Programmatic Tool Caller

Execute JavaScript code that calls the agent's other tools as async functions — a
TypeScript port of Python's [`programmatic_tool_caller`][py-pr] from `strands-agents/tools`.

[py-pr]: https://github.com/strands-agents/tools/pull/387

## ⚠️ Security warning

**This tool executes arbitrary JavaScript without a sandbox.**

- Only use with trusted agents/inputs.
- Code runs with the full permissions of the host JS runtime — under Node.js that means full filesystem, network, and child-process access. The `extraModules` allow-list **only controls which Node built-ins are pre-bound as namespace identifiers**; it does _not_ prevent user code from calling `await import('child_process')` or accessing globals like `process` and `globalThis`.
- For untrusted callers, deploy behind a sandbox (container, VM, separate process with seccomp), and/or gate execution with an intervention handler (see [Human-in-the-loop](#human-in-the-loop--consent)).

## Why

LLM-driven tool orchestration adds an LLM round-trip per tool call. For loops,
parallel fan-outs, and "call N tools then aggregate" patterns this is wasteful.
This tool lets the model write a single block of JavaScript that calls the
other tools directly, with `await`, `Promise.all`, and ordinary control flow —
similar to Anthropic's Programmatic Tool Calling feature.

## Installation

```typescript
import {
  programmaticToolCaller,
  createProgrammaticToolCaller,
} from '@strands-agents/sdk/vended-tools/programmatic-tool-caller'
```

## Usage

Drop the default instance straight into an agent:

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
the tool result text. The capture is achieved by binding a shadow `console`
into the user-function scope; calls to `console.log(...)` from user code go to
the buffer, **not** to real stdout/stderr.

> **Note (best-effort capture):** the capture only intercepts the `console`
> binding inside the user function. User code can still bypass it deliberately
> via `globalThis.console.log(...)`, `process.stdout.write(...)`, or by using
> any module exposed through `extraModules` that writes directly to a stream.
> Likewise, async work that resolves _after_ the tool returns (e.g. an
> unawaited `setTimeout`) will write to the buffer after it has already been
> read — those writes are silently dropped. Treat capture as test-isolation
> and log-tidiness, not a security boundary.

## Configuration

Configuration is provided **in code** via `createProgrammaticToolCaller(config)`.
This is the recommended pattern: it is explicit, type-checked, and works in any
runtime (including the browser). For convenience, the default `programmaticToolCaller`
instance also reads two environment variables as a **Node-only fallback**.

```typescript
import { createProgrammaticToolCaller } from '@strands-agents/sdk/vended-tools/programmatic-tool-caller'

const ptc = createProgrammaticToolCaller({
  // Only these tools are callable from the generated code. Omit to expose all.
  allowedTools: ['calculator', 'search'],
  // Node built-ins to expose (drawn from the allow-list below).
  extraModules: ['path', 'crypto'],
})

const agent = new Agent({ model, tools: [ptc, calculator, search] })
```

| Option / env var                                          | Purpose                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowedTools` / `PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS` | Allow-list of tool names the code may call. Default: every registered tool except `programmatic_tool_caller`.                                                                                                                                                                         |
| `extraModules` / `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES` | Node built-ins to expose. Allow-list: `fs`, `fs/promises`, `path`, `crypto`, `url`, `util`, `querystring`, `os`, `buffer`, `stream`, `events`. Names with non-identifier chars are normalized (`fs/promises` → `fs_promises`). Anything outside the allow-list is logged and skipped. |

**Precedence:** config object **>** environment variable **>** default. The env
vars are comma-separated and are only consulted under Node.js — in the browser
(where `process` is undefined) they are ignored entirely, so always pass a config
object for browser targets.

### Why config-over-env, and what about the browser?

Reading `process.env` directly is **not browser-safe** — a bare
`process.env.X` reference throws `ReferenceError: process is not defined` in a
browser bundle. This tool therefore:

1. Treats the **config object as the source of truth** (works everywhere), and
2. Guards every env read behind a `typeof process !== 'undefined'` check, so the
   env fallback simply no-ops outside Node instead of crashing.

The other vended tools (`bash`, `http-request`, …) take their parameters as tool
input or constructor config rather than env vars; `createProgrammaticToolCaller`
follows that same convention while keeping the env fallback for parity with the
Python tool and for zero-config Node usage.

## Human-in-the-loop / consent

This tool has **no internal confirmation prompt** and **no `BYPASS_TOOL_CONSENT`
switch**. In the TS SDK, gating tool execution is the job of an
**intervention handler**, not each individual tool. To require approval before
`programmatic_tool_caller` runs (it executes arbitrary code, so this is a good
idea for interactive deployments), register an `InterventionHandler` that
overrides `beforeToolCall`:

```typescript
import { InterventionHandler, InterventionActions } from '@strands-agents/sdk'

class ConfirmProgrammaticCalls extends InterventionHandler {
  readonly name = 'confirm-ptc'

  override beforeToolCall(event) {
    if (event.toolUse.name === 'programmatic_tool_caller') {
      return InterventionActions.confirm({
        message: `Run this code?\n${event.toolUse.input.code}`,
      })
    }
    return InterventionActions.proceed()
  }
}

const agent = new Agent({ model, tools: [programmaticToolCaller], interventions: [new ConfirmProgrammaticCalls()] })
```

This keeps consent policy composable and in one place, rather than baked into
the tool.

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

### MCP tools

MCP server tools work transparently. `McpTool` extends the same `Tool` base
class and is registered like any local tool, so the model can call an MCP tool
(`await some_mcp_tool({ ... })`) exactly like a local one — the direct-tool-call
path drives `McpTool.stream` → `McpClient.callTool` underneath. MCP errors
(`isError: true`) surface as thrown errors inside the user code, and non-text
MCP content (images, embedded resources) is returned as the raw content-block
array. This is covered by committed tests.

## Tool name compatibility

`new AsyncFunction(...names, body)` rejects parameter names that are not valid
JavaScript identifiers, and the function is implicitly _strict mode_ (so
reserved words like `return`, contextual keywords like `await`, and
`arguments` are also illegal). The tool registry, however, accepts any name
matching `^[a-zA-Z0-9_-]+$`, which is broader.

To avoid one badly-named tool poisoning every execution, tools whose
underscore-normalized name is not a valid identifier (or is a reserved word)
are **skipped** with a `logger.warn` instead of injected. The rest of the
namespace builds normally. Rename such tools at registration time to expose
them via `programmatic_tool_caller`.

## Reserved namespace

The following identifiers cannot be shadowed by tools:

- `console` — always reserved (capture buffer).
- Any module name actually injected via `extraModules` / `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES`.

If a tool's name (or its underscore-normalized form) clashes, the tool returns
`status: 'error'` with a clear message naming the offending tools and the full
reserved set. Rename or filter via the `allowedTools` config.

## Parity with the Python tool

| Concern                | Python                                             | TypeScript                                                                    |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Tool name              | `programmatic_tool_caller`                         | `programmatic_tool_caller`                                                    |
| Single input           | `code: str`                                        | `code: string`                                                                |
| Async wrapper          | `asyncio.run(__user_code__)`                       | `new AsyncFunction(...)`                                                      |
| Always-injected module | `asyncio`                                          | `console` (capture)                                                           |
| Tool name → identifier | identity (Python tool names are valid identifiers) | hyphen → underscore (always); original name kept too if a valid JS identifier |
| Tool unwrapping        | `_execute_tool`                                    | `unwrapToolResult` (same rules)                                               |
| Allow-list config      | `PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS`           | `allowedTools` config (env fallback identical)                                |
| Extra modules config   | `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES`           | `extraModules` config (env fallback identical, Node-builtins allow-list)      |
| Reserved names         | `asyncio`, `__name__`, plus extras                 | `console`, plus extras                                                        |
| Confirmation prompt    | `get_user_input` / `BYPASS_TOOL_CONSENT`           | intervention handler (`beforeToolCall` → `confirm`); no in-tool prompt        |
| Output capture         | `StringIO` redirect of `sys.stdout`/`stderr`       | overridden `console` shadow                                                   |
| Empty output           | `(no output)`                                      | `(no output)`                                                                 |
| Inner call recording   | `record_direct_tool_call=False`                    | `recordDirectToolCall: false`                                                 |

## Limitations

- **No human-in-the-loop _inside_ the code**: tools that interrupt for human
  input cannot be paused mid-script — direct/programmatic tool calls cannot be
  suspended. An interrupt surfaces as a thrown error inside the user code.
  (Gating the _whole_ `programmatic_tool_caller` call via an intervention
  handler is supported — see above.)
- **No sandboxing**: see security warning.
- **Node.js only at runtime**: relies on `util.inspect` and dynamic `import()`
  of Node built-ins. The tool is browser-safe to _construct_ and configure, but
  the `extraModules` Node built-ins and `util.inspect`-based formatting assume a
  Node runtime.
