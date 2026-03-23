# SDK TypeScript Bug Bash

## How It Works

Each feature area has its own guide with what to test, what to look for, starter templates, and links to the docs. Guides and templates are on the `bug-bash` branch of `strands-agents/sdk-typescript` under `bug-bash/guides/` and `bug-bash/templates/`.

Your goal: follow the docs, run the templates, poke at edge cases, and log anything that feels off.

## Get the Guides

```bash
git clone https://github.com/strands-agents/sdk-typescript.git
cd sdk-typescript
git checkout bug-bash
```

Guides are in `bug-bash/guides/`, templates in `bug-bash/templates/`.

## Sign Up

Claim a feature area by putting your name in the Assignee column. If you finish early, grab an unclaimed one or go deeper on your own.

| Feature Area | Guide | Assignee |
|---|---|---|
| Agent - Loop | agent-loop.md | |
| Agent - Structured Output | agent-structured-output.md | @afarn |
| Models - Bedrock | models-bedrock.md | |
| Models - Anthropic | models-anthropic.md | |
| Models - OpenAI | models-openai.md | @jackypc |
| Models - Google | models-google.md | |
| Tools | tools.md | @maczas |
| Tools - MCP | tools-mcp.md | @jackypc |
| Plugins | plugins.md | |
| Conversation Management | conversation-management.md | |
| Agent - A2A | agent-a2a.md | @pgrayy |
| Tools - Notebook | tools-notebook.md | @mehtarac |
| Tools - Bash | tools-bash.md | @okapl |
| Tools - File Editor | tools-file-editor.md | |
| Tools - HTTP Request | tools-http-request.md | @jackypc |
| Multi-Agents - Graph | multi-agents-graph.md | @jackypc |
| Multi-Agents - Swarm | multi-agents-swarm.md | @jackypc |
| Session Management | sessions.md | @maczas |
| Telemetry | telemetry.md | @lizrad |

## Setup

Create a project:

```bash
mkdir strands-bug-bash && cd strands-bug-bash
npm init -y
```

Add `"type": "module"` to your `package.json` (required for top-level await).

Install dependencies:

```bash
npm install \
  @strands-agents/sdk \
  openai \
  @anthropic-ai/sdk \
  @google/genai \
  @modelcontextprotocol/sdk \
  @a2a-js/sdk \
  express \
  @opentelemetry/api \
  @opentelemetry/sdk-trace-node \
  @opentelemetry/sdk-trace-base \
  tsx
```

Configure credentials:
API keys for third-party providers: https://mboat.dev-tools.aws.dev/#/team-secrets/Provider+API+Keys

- Bedrock: AWS credentials (via AWS CLI profile, env vars, or IAM role)
- OpenAI: `OPENAI_API_KEY`
- Anthropic: `ANTHROPIC_API_KEY`
- Google: `GEMINI_API_KEY`

Run a template:
Copy a template from the repo into your project and run it:

```bash
cp <path-to-sdk-typescript>/bug-bash/templates/agent-loop.ts my-test.ts
npx tsx my-test.ts
```

Browser testing:
The SDK targets both Node.js and browser. Copy the `bug-bash/templates/browser-test/` directory into your project, then:

```bash
npm install vite --save-dev
npx vite browser-test
```

Open http://localhost:5173. Create a `browser-test/.env` file for credentials (Vite loads `.env` from its root directory):

```
VITE_AWS_ACCESS_KEY_ID=your-key
VITE_AWS_SECRET_ACCESS_KEY=your-secret
VITE_AWS_SESSION_TOKEN=your-token
VITE_AWS_REGION=us-east-1
VITE_OPENAI_API_KEY=your-key
VITE_ANTHROPIC_API_KEY=your-key
VITE_GOOGLE_API_KEY=your-key
```

Access them in code via `import.meta.env.VITE_*`. Restart Vite after changing `.env` files.

## Findings Log

Log bugs, issues, and observations here. Add rows as you go.

Severity:
- P0: Crash, data loss, or security issue
- P1: Feature broken, no workaround
- P2: Feature broken, workaround exists
- P3: Minor issue, cosmetic, or improvement suggestion

| Feature Area | Summary | Severity | Found By | Notes | Assignee |
|---|---|---|---|---|---|
| Tool | Cannot stringify streamed events | P1 | @maczas | Unless you're special casing every streaming event | |
| Tool | If a tool doesn't return a value, it is still considered "successful" | P3 | @maczas | Undefined isn't technically valid json. This shows up as a text content block like `text: '<undefined>'` | |
| Agent - A2A | Empty text part in artifacts after streaming completes | P3 | @pgrayy | `A2AExecutor.execute()` publishes a final `{kind:'text', text:''}` part with `lastChunk:true` to close the text artifact. This empty part appears in the response alongside real content. Could be filtered from the serialized response or sent without a parts array. | |
| General | Node 18 fails | P0 | @okapl | `if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");` | |
| Tools - Notebook | The model calls write with only newStr, gets a validation error, then retries with insertLine added | P3 | @mehtarac | https://paste.amazon.com/show/mehtarac/1773942056 - I think we need to either update the tool description/spec or add an append write mode | |
| Graph | Inconsistent print formatting | P3 | @okapl | See details below | |
| Sliding Window Conversation Manager | `windowSize: 0` becomes no-op | P3 | @murmeral | See bug 1 in https://github.com/agent-of-mkmeral/strands-coder/issues/28#issuecomment-4092041642 - the expectation here i have as a user is having empty history all the time, sort of amnesia | |
| Model Provider | Gemini connection interruption causes agent to break | P0? (need to validate manually, agent finding) | @murmeral | See finding 1 in https://github.com/agent-of-mkmeral/strands-coder/issues/28#issuecomment-4092065454 | |
| Swarm+OpenAI | Swarm runs into infinite loop in gpt-4o | P0 | @jackypc | https://github.com/JackYPCOnline/sdk-typescript/issues/16 Double checked the script with main branch, it happens sometimes? failed 1 out of 2, took 150 seconds to return result. | @pgrayy |
| Swarm | Structured output tool errors swarm ~20% of the time | P1 | @okapl | See details below | @pgrayy |
| Structured Output | OpenAI `StructuredOutputException: The model failed to invoke the structured output tool even after it was forced.` (per-invocation schema override) | P1 | @afarn | See details below | @pgrayy |
| Structured Output | OpenAI `StructuredOutputException: The model failed to invoke the structured output tool even after it was forced.` (streaming events) | P1 | @afarn | See details below | @pgrayy |
| Agent - A2A | A2AAgent client strips non-text content blocks and logs misleading message | P2 | @pgrayy | `A2AAgent._extractTextFromArgs()` drops all non-text content (images, documents) and logs "a2a only supports text", which is incorrect since the A2A protocol supports file parts and the server-side adapters handle them. The client should either forward non-text content as A2A file parts, or the log message should clarify this is a client limitation, not an A2A protocol limitation. | |
| Agent - A2A | A2AAgent lazy init skips empty string description from agent card | P3 | @pgrayy | `_getClient()` checks `this._agentCard?.description` which is falsy for empty strings. When the server returns `description: ""`, the client's description stays undefined instead of being set to `""`. The condition should use `!== undefined` instead of truthiness. Same issue could affect name if the server returned an empty name. | |
| Agent - Loop | `invokeModel` used recursive `return yield* this.invokeModel(forcedToolChoice)` when `AfterModelCallEvent.retry` was set to true by a hook. No retry counter or depth limit, so a hook that always sets retry = true would cause infinite recursion and a stack overflow. | P1 | @jackypc | https://github.com/strands-agents/sdk-typescript/pull/701 | |
| Agent - A2A | `@strands-agents/sdk/a2a` barrel export is not browser-compatible | P2 | @pgrayy | The `./a2a` entry point re-exports `A2AExpressServer` and `A2AServer` which import Express and `@a2a-js/sdk/server`, pulling in Node.js builtins (`node:events`, `node:http`, `node:path`, `fs`, `url`). Additionally, `@a2a-js/sdk` uses `globalThis.Buffer` for base64 which doesn't exist in browsers. Deep imports are blocked by the exports field. Browser consumers who only need `A2AAgent` cannot use the SDK without the server code crashing at import time. Fix: split into `./a2a/client` and `./a2a/server` entry points, or use conditional browser exports. | |
| Model Provider | Not sticking to log format | P3 | @arron | https://github.com/strands-agents/sdk-typescript/blob/4fad779c2a4e7396a948f82d8691331fdce13411/src/models/anthropic.ts#L404 | |
| Model Provider | OpenAI using old models like o1-mini and gpt-4o which were released in 2024. Both default OpenAIModel ID and in integ tests | P0 | @arron | | |
| HttpClient | Response body fetched but still throws if not `response.ok` | P3 | @jackypc | Line 81, we actually don't need throw right? model will decide what to do, then throw the error in catch. | |
| Bash Tool | `pwd` is not persisted between calls | P3 | @okapl | See details below | |
| Bash Tool | Env vars are only persisted if set and consumed in the same command with `&&` or `;` | P1 | @okapl | See details below | |
| Telemetry | Agent output does not print properly by default | | @ncclegg | Running a basic agent with `agent.invoke("Hello!")` shows no output, it gets overwritten by the next line | |
| SessionManager DevX | Let me list snapshots for a given agent | P3 | @maczas | Given an already existing agent, I'll want to list the snapshot ids for it without having to rebuild the location | |
| SessionManager DevX | Let me decide what snapshot options are used for creating snapshots | P3 | @maczas | There's no way not to preserve the system prompt | |
| SessionManager DevX | `saveLatestOn: 'trigger'` with no `snapshotTrigger` should throw | P2/P3 | @maczas | `const session = makeSession(sessionId, { saveLatestOn: 'trigger', })` with no snapshotTrigger | |
| SessionManager DevX | `saveLatestOn: 'trigger'` - let me trigger on any event | P2 | @maczas | Let me trigger on any event (like MessageAdded) or BeforeModel invocation so that even mid-turn I can restore later on. | |
| SessionManager | `Agent.messages` are overwritten without warning | P2 | @maczas | This is by design but if an agent already has messages and in agentInit we're overwriting those, we should emit a warning just so that people are aware | |
| SessionManager | Multiple agents with the same id (or default id) silently overwrite data | P2 | @maczas | This is a footgun; Python actually protects against this: https://github.com/strands-agents/sdk-python/blob/main/src/strands/session/repository_session_manager.py#L172-L173 | |
| Graph + Swarm | MultiAgentNode: inner orchestrator failure status silently swallowed | P1 | @jackypc | See details below | @pgrayy |
| Telemetry | If system prompt is empty string, the span sends system prompt as undefined rather than empty string `""` | P3 | @lizrad | Can change system prompt check to explicit undefined check rather than truthy check: `if (this.systemPrompt !== undefined) agentSpanOptions.systemPrompt = this.systemPrompt` | @lizrad |
| Graph | Graph `_resolveSources` treats self-loop nodes as non-sources | P1 | @jackypc | See details below | |
| Docs | TS quickstart missing details about MCP server that Python quickstart has | | @arron | https://strandsagents.com/docs/user-guide/quickstart/typescript vs https://strandsagents.com/docs/user-guide/quickstart/python/#strands-mcp-server-optional | |

---

## Detailed Findings

### Graph: Inconsistent print formatting

```
🔧 Tool #1: calculator
✓ Tool completed

🔧 Tool #2: calculator
✓ Tool completed
814

Here's the breakdown:
1. First, multiply 42 × 17 = 714
2. Then, add 100 to that result: 714 + 100 = 814The final answer is 814.So here's what happened...
```

Output from `MultiAgentResult` is concatenated without proper spacing/newlines.

### Swarm: Structured output tool errors swarm ~20% of the time

```
🔧 Tool #3: strands_structured_output
✓ Tool completed
node_id=<math>, error=<Stream ended without completing a message> | node execution failed
MultiAgentResult {
  type: 'multiAgentResult',
  status: 'FAILED',
  results: [
    NodeResult {
      type: 'nodeResult',
      nodeId: 'math',
      status: 'FAILED',
      duration: 9085,
      content: [],
      error: ModelError: Stream ended without completing a message
          at BedrockModel.streamAggregated (...)
    }
  ]
}
```

### Structured Output: OpenAI per-invocation schema override

```typescript
/**
 * 07 — Per-invocation schema override.
 * Tests that structuredOutputSchema can be provided at constructor AND overridden per invoke().
 */
import { Agent } from '../index.js'
import { z } from 'zod'
import { printResult } from './helpers.js'
import { getModelFromArgs } from './models.js'

const defaultSchema = z.object({
  name: z.string(),
  type: z.string(),
})

const overrideSchema = z.object({
  name: z.string(),
  population: z.number(),
  continent: z.string(),
  languages: z.array(z.string()),
})

const agent = new Agent({
  model: getModelFromArgs(),
  structuredOutputSchema: defaultSchema,
})

// First call uses the default schema
console.log('--- Call 1: Using default schema ---')
const result1 = await agent.invoke('Tell me about a golden retriever.')
printResult('07a — Default Schema (animal)', result1, defaultSchema)

// Second call overrides with a different schema
console.log('\n--- Call 2: Using override schema ---')
const result2 = await agent.invoke('Tell me about Brazil.', {
  structuredOutputSchema: overrideSchema,
})
printResult('07b — Override Schema (country)', result2, overrideSchema)

// Third call goes back to the default schema
console.log('\n--- Call 3: Back to default schema ---')
const result3 = await agent.invoke('Tell me about a blue whale.')
printResult('07c — Default Schema again (animal)', result3, defaultSchema)
```

### Structured Output: OpenAI streaming events

```typescript
/**
 * 10 — Streaming events with structured output.
 * Tests that stream() yields events AND returns structured output in the final result.
 */
import { Agent } from '../index.js'
import { z } from 'zod'
import { printResult } from './helpers.js'
import { getModelFromArgs } from './models.js'

const schema = z.object({
  planet: z.string(),
  distanceFromSunKm: z.number(),
  numberOfMoons: z.number(),
  hasRings: z.boolean(),
  funFact: z.string(),
})

const agent = new Agent({
  model: getModelFromArgs(),
  structuredOutputSchema: schema,
  printer: false,
})

console.log('Streaming events:')
const eventCounts: Record<string, number> = {}

for await (const event of agent.stream('Tell me about Saturn.')) {
  const type = event.type
  eventCounts[type] = (eventCounts[type] ?? 0) + 1
}

console.log('\nEvent counts from stream():', eventCounts)

console.log('\nNow using invoke() to verify structured output:')
const result = await agent.invoke('Tell me about Saturn.')
printResult('10 — Streaming + Structured Output', result, schema)
```

### Graph + Swarm: MultiAgentNode inner orchestrator failure status silently swallowed

**File**: `src/multiagent/nodes.ts`, `MultiAgentNode.handle()` method

When a nested Graph or Swarm is used as a node in an outer Graph, `MultiAgentNode.handle()` only extracts `content` from the inner orchestrator's result:

```typescript
return { content: next.value.content }
```

It discards `status` and `error`. The parent `Node.stream()` then defaults to `status: Status.COMPLETED`:

```typescript
result = new NodeResult({
  nodeId: this.id,
  status: Status.COMPLETED,  // hardcoded default
  ...,
  ...update,  // update only has { content }, no status
})
```

If the inner orchestrator returned `FAILED`, the outer graph sees the node as `COMPLETED` with empty content. The failure is completely invisible.

**Fix**: Propagate the inner result's status in `MultiAgentNode.handle()`:

```typescript
const innerResult = next.value
return {
  content: innerResult.content,
  ...(innerResult.status !== 'COMPLETED' && { status: innerResult.status }),
  ...(innerResult.error && { error: innerResult.error }),
}
```

### Graph: `_resolveSources` treats self-loop nodes as non-sources

**File**: `src/multiagent/graph.ts`, `_resolveSources()` method

The auto-detection of source nodes (entry points) excludes any node that appears as a target in any edge, including self-loop edges. A node with a self-loop edge (`A -> A`) is incorrectly classified as a non-source, even if it has no other incoming edges.

```typescript
private _resolveSources(sourceIds?: string[]): Node[] {
  // ...
  const targetIds = new Set(this.edges.map((e) => e.target.id))  // includes self-loop targets
  return [...this.nodes.values()].filter((node) => !targetIds.has(node.id))
}
```

**Fix**: Exclude self-loop edges when computing the target set:

```typescript
const targetIds = new Set(
  this.edges.filter((e) => e.source.id !== e.target.id).map((e) => e.target.id)
)
```

### Bash Tool: `pwd` is not persisted between calls

```typescript
const result = await agent.invoke("cd into node_modules.");
const result2 = await agent.invoke("ls your pwd")
```

The directory changed back to the parent directory between invocations.

### Bash Tool: Env vars are only persisted if set and consumed in the same command

```typescript
const result = await agent.invoke("set an env var with bash tool export TEST_VAR='This is a test value'");
const result2 = await agent.invoke("read the env var you set TEST_VAR")
```

Environment variables set with `export` do not persist between separate command executions. They only work when set and used in the same command (connected with `&&` or `;`).
