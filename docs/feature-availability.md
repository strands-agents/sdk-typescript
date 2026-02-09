# TypeScript SDK — Python Parity Status

This document tracks the features implemented in the TypeScript SDK to close the gap with the Python SDK. Each section describes the feature, its implementation status, and usage.

## Status Overview

| Feature | Status | Notes |
|---------|--------|-------|
| Structured output | Implemented | Zod-based schema validation |
| Summarizing conversation manager | Implemented | LLM-based summarization on overflow |
| Multi-agent (Swarm) | Implemented | Autonomous agent coordination |
| Multi-agent (Graph) | Implemented | Deterministic graph orchestration |
| Agents as tools | Implemented | `AgentTool` adapter |
| Session management (File) | Implemented | Local filesystem persistence |
| Session management (S3) | Implemented | Amazon S3 persistence |
| Session management (Repository) | Implemented | Extensible repository pattern |
| OpenTelemetry integration | Implemented | Tracing and metrics |
| Interrupt system | Implemented | Human-in-the-loop pause/resume |
| Agent steering (experimental) | Implemented | Hook-based just-in-time guidance |
| Bidirectional streaming | Not planned | Blocked on JS Bedrock client support |
| Built-in tools | Not planned | Community effort; not a parity blocker |

---

## Structured Output

Uses [Zod](https://zod.dev/) schemas to constrain LLM responses to a validated structure. The agent injects a hidden tool derived from the schema; the model calls that tool with conforming JSON, and the SDK validates the result automatically.

### Usage

```typescript
import { Agent, BedrockModel } from '@strands-agents/sdk'
import { z } from 'zod'

const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
})

// Schema set at agent level (applies to every invocation)
const agent = new Agent({
  model: new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' }),
  structuredOutput: UserSchema,
})

const result = await agent.invoke('Extract user info from: Jane Doe, 28, jane@example.com')
console.log(result.structuredOutput)
// { name: "Jane Doe", age: 28, email: "jane@example.com" }

// Or override per invocation
const ProductSchema = z.object({ title: z.string(), price: z.number() })

const productResult = await agent.invoke('Extract product info from: Widget, $9.99', {
  structuredOutput: ProductSchema,
})
```

### Key exports

`StructuredOutputTool`, `StructuredOutputContext`, `DEFAULT_STRUCTURED_OUTPUT_PROMPT`, `StructuredOutputToolConfig`, `StructuredOutputStoreResult`

---

## Summarizing Conversation Manager

Replaces older messages with an LLM-generated summary when a `ContextWindowOverflowError` occurs, keeping the conversation within token limits while preserving key context.

### Usage

```typescript
import { Agent, BedrockModel, SummarizingConversationManager } from '@strands-agents/sdk'

const agent = new Agent({
  model: new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' }),
  conversationManager: new SummarizingConversationManager({
    summaryRatio: 0.2,              // target ratio of tokens after summarization
    preserveRecentMessages: 2,      // keep the N most recent message pairs
  }),
})

// Long-running conversation — summarization happens automatically on overflow
for (const question of longQuestionList) {
  await agent.invoke(question)
}
```

### Key exports

`ConversationManager`, `SummarizingConversationManager`, `SummarizingConversationManagerConfig`, `DEFAULT_SUMMARIZATION_PROMPT`

---

## Multi-Agent: Swarm

Autonomous coordination of specialized agents. Agents hand off to each other using an injected `handoff_to_agent` tool, sharing working memory through a `SharedContext`.

### Usage

```typescript
import { Agent, BedrockModel, Swarm } from '@strands-agents/sdk'

const model = new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' })

const researcher = new Agent({ model, name: 'researcher', systemPrompt: 'You research topics thoroughly.' })
const writer = new Agent({ model, name: 'writer', systemPrompt: 'You write polished articles.' })

const swarm = new Swarm({
  nodes: [researcher, writer],
  entryPoint: researcher,
  maxHandoffs: 20,
  executionTimeout: 900,
})

// Invoke
const result = await swarm.invoke('Write a blog post about TypeScript agents')

// Or stream events
for await (const event of swarm.stream('Write a blog post about TypeScript agents')) {
  if (event.type === 'multiAgentNodeStartEvent') {
    console.log(`Agent ${event.nodeId} started`)
  }
}
```

### Key exports

`Swarm`, `SwarmNode`, `SharedContext`, `SwarmState`, `SwarmResult`

---

## Multi-Agent: Graph

Deterministic directed-graph execution with a fluent builder API, conditional edges, cycle support, and parallel node execution.

### Usage

```typescript
import { Agent, BedrockModel, GraphBuilder, Status } from '@strands-agents/sdk'

const model = new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' })

const planner = new Agent({ model, name: 'planner', systemPrompt: 'You create plans.' })
const executor = new Agent({ model, name: 'executor', systemPrompt: 'You execute plans.' })
const reviewer = new Agent({ model, name: 'reviewer', systemPrompt: 'You review work.' })

const graph = new GraphBuilder()
  .addNode(planner, 'planner')
  .addNode(executor, 'executor')
  .addNode(reviewer, 'reviewer')
  .addEdge('planner', 'executor')
  .addEdge('executor', 'reviewer')
  .addEdge('reviewer', 'executor', (state) => {
    // Conditional edge: loop back only when review fails
    return state.results['reviewer']?.status === Status.FAILED
  })
  .setEntryPoint('planner')
  .setMaxNodeExecutions(10)
  .build()

const result = await graph.invoke('Plan, execute, and review the deployment')
```

### Key exports

`Graph`, `GraphBuilder`, `GraphNode`, `GraphEdge`, `GraphState`, `GraphResult`, `GraphExecutor`, `Status`, `NodeResult`, `MultiAgentResult`, `MultiAgentBase`

### Streaming events (shared by Swarm and Graph)

`MultiAgentNodeStartEvent`, `MultiAgentNodeStopEvent`, `MultiAgentNodeStreamEvent`, `MultiAgentHandoffEvent`, `MultiAgentNodeCancelEvent`, `MultiAgentNodeInterruptEvent`, `MultiAgentResultEvent`

### Hook events (shared by Swarm and Graph)

`MultiAgentInitializedEvent`, `BeforeMultiAgentInvocationEvent`, `AfterMultiAgentInvocationEvent`, `BeforeNodeCallEvent`, `AfterNodeCallEvent`

---

## Agents as Tools

Wraps an `Agent` as a `Tool` so that an orchestrator agent can invoke sub-agents during its tool-use loop.

### Usage

```typescript
import { Agent, AgentTool, BedrockModel } from '@strands-agents/sdk'

const model = new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' })

const mathAgent = new Agent({ model, systemPrompt: 'You solve math problems step by step.' })

const orchestrator = new Agent({
  model,
  tools: [
    new AgentTool({
      name: 'math_solver',
      description: 'Solves complex math problems',
      agent: mathAgent,
    }),
  ],
})

const result = await orchestrator.invoke('What is the integral of x^2 from 0 to 5?')
```

### Key exports

`AgentTool`, `AgentToolConfig`

---

## Session Management

Pluggable session persistence that automatically saves and restores agent state, conversation history, and multi-agent execution state through the hooks system.

### File-based (local development)

```typescript
import { Agent, BedrockModel, FileSessionManager } from '@strands-agents/sdk'

const agent = new Agent({
  model: new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' }),
  sessionManager: new FileSessionManager({
    sessionId: 'my-session',
    storageDir: './sessions',   // optional, defaults to system temp dir
  }),
})

// State persists automatically across invocations
await agent.invoke('Remember that my name is Alice')
// ... restart process ...
await agent.invoke('What is my name?')  // "Alice"
```

### S3-based (production)

```typescript
import { Agent, BedrockModel, S3SessionManager } from '@strands-agents/sdk'

const agent = new Agent({
  model: new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' }),
  sessionManager: new S3SessionManager({
    sessionId: 'prod-session',
    bucket: 'my-sessions-bucket',
    region: 'us-east-1',
    prefix: 'v1/sessions',  // optional S3 key prefix
  }),
})
```

### Custom storage backend

```typescript
import { RepositorySessionManager, SessionRepository } from '@strands-agents/sdk'

class PostgresSessionRepository implements SessionRepository {
  // implement createSession, readSession, createAgent, readAgent,
  // updateAgent, createMessage, readMessage, updateMessage, listMessages,
  // createMultiAgent, readMultiAgent, updateMultiAgent
}

const agent = new Agent({
  model,
  sessionManager: new RepositorySessionManager({
    sessionId: 'db-session',
    sessionRepository: new PostgresSessionRepository(),
  }),
})
```

### Key exports

`SessionManager`, `SessionRepository`, `RepositorySessionManager`, `FileSessionManager`, `S3SessionManager`, `FileSessionManagerConfig`, `S3SessionManagerConfig`, `RepositorySessionManagerConfig`, `SessionData`, `SessionAgentData`, `SessionMessageData`, `SessionException`

---

## OpenTelemetry Integration

Optional tracing and metrics via `@opentelemetry/api`. When the OpenTelemetry SDK is configured in the host application, the agent automatically emits spans for:

- Agent invocations
- Event loop cycles
- Model calls (with token usage)
- Tool executions
- Multi-agent orchestration

Metrics include event loop cycle counts, tool call counts, and latency histograms.

### Usage

```typescript
// 1. Configure OpenTelemetry in your application (standard OTel setup)
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const provider = new NodeTracerProvider()
provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter()))
provider.register()

// 2. Use the agent as normal — spans are emitted automatically
import { Agent, BedrockModel } from '@strands-agents/sdk'

const agent = new Agent({
  model: new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' }),
})

await agent.invoke('Hello')
// Traces appear in your configured OTel backend (Jaeger, X-Ray, etc.)
```

### Key exports

`MetricsClient`, `MetricsConstants`, `AttributeValue`

---

## Interrupt System

Enables human-in-the-loop workflows by pausing agent execution at specific points (typically before tool calls) and resuming with user-provided responses.

### Usage

```typescript
import {
  Agent,
  BedrockModel,
  BeforeToolCallEvent,
  Interrupt,
  isInterruptResponseArray,
} from '@strands-agents/sdk'

const agent = new Agent({
  model: new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' }),
  hooks: {
    registerCallbacks(registry) {
      registry.on(BeforeToolCallEvent, (event) => {
        if (event.toolName === 'delete_file') {
          // Pause and ask for confirmation
          event.interrupt({ reason: `About to delete: ${event.toolInput.path}` })
        }
      })
    },
  },
  tools: [deleteFileTool],
})

// First call raises an interrupt
const result = await agent.invoke('Delete temp.txt')
// result.interrupts contains the pending interrupt

// Resume with user confirmation
const resumed = await agent.invoke([
  { interruptResponse: { interruptId: result.interrupts[0].id, response: 'yes, proceed' } },
])
```

### Key exports

`Interrupt`, `InterruptException`, `InterruptState`, `InterruptStateData`, `InterruptResponse`, `InterruptResponseContent`, `isInterruptResponseArray`

---

## Agent Steering (Experimental)

A modular prompting system built on hooks that injects context-aware guidance to the agent just-in-time. Handlers intercept tool calls and model responses to proceed, guide (inject feedback), or interrupt execution.

### Usage

```typescript
import {
  Agent,
  BedrockModel,
  LLMSteeringHandler,
  LedgerProvider,
} from '@strands-agents/sdk'

const steeringModel = new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' })

const handler = new LLMSteeringHandler({
  systemPrompt: 'Ensure the agent stays on topic and does not make dangerous file system changes.',
  model: steeringModel,
  contextProviders: [new LedgerProvider()],
})

const agent = new Agent({
  model: new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' }),
  hooks: handler,
})

await agent.invoke('Organize my project files')
// The steering handler evaluates each tool call and can guide or interrupt
```

### Custom steering handler

```typescript
import { SteeringHandler, Proceed, Guide } from '@strands-agents/sdk'
import type { ToolSteeringAction } from '@strands-agents/sdk'

class MySteeringHandler extends SteeringHandler {
  protected async steerBeforeTool(params: {
    toolUse: SteeringToolUse
    systemPrompt: string
  }): Promise<ToolSteeringAction> {
    if (params.toolUse.name === 'dangerous_tool') {
      return new Guide({ reason: 'Use the safe alternative instead.' })
    }
    return new Proceed({ reason: 'Tool call looks fine.' })
  }
}
```

### Key exports

`SteeringHandler`, `LLMSteeringHandler`, `LLMSteeringHandlerConfig`, `Proceed`, `Guide`, `SteeringInterrupt`, `ToolSteeringAction`, `ModelSteeringAction`, `SteeringContext`, `SteeringContextCallback`, `SteeringContextProvider`, `SteeringToolUse`, `DefaultPromptMapper`, `LLMPromptMapper`, `LedgerProvider`, `LedgerBeforeToolCall`, `LedgerAfterToolCall`

---

## Features Not Implemented

### Bidirectional streaming

The Python SDK's `BidiAgent` relies on a Smithy-generated Python client (`aws_sdk_bedrock_runtime`) for bidirectional event streaming. An equivalent JS Bedrock client does not yet exist. This is blocked on AWS SDK support.

### Built-in tools

The Python ecosystem has the `strands-agents-tools` community package with 30+ tools. The TypeScript SDK ships a small set of vended tools (`notebook`, `file_editor`, `bash`). Expanding this is a coverage effort, not a technical gap.
