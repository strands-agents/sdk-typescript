# Agent Development Guide - Strands TypeScript SDK

This document provides guidance specifically for AI agents working on the Strands TypeScript SDK codebase. For human contributor guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Purpose and Scope

**AGENTS.md** contains agent-specific repository information including:

- Directory structure with summaries of what is included in each directory
- Development workflow instructions for agents to follow when developing features
- Coding patterns and testing patterns to follow when writing code
- Style guidelines, organizational patterns, and best practices

**For human contributors**: See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, and contribution guidelines.

## Directory Structure

The repo is an npm workspace monorepo. The root `package.json` delegates all build/test/lint commands to the `strands-ts` workspace package.

```
sdk-typescript/
├── strands-ts/                   # SDK workspace package
│   ├── src/                      # All production code
│   │   ├── __fixtures__/         # Shared test fixtures (mocks, helpers)
│   │   ├── __tests__/            # Unit tests for root-level source files
│   │   │
│   │   ├── a2a/                  # Agent-to-agent protocol
│   │   │   ├── __tests__/
│   │   │   ├── a2a-agent.ts      # A2A agent client
│   │   │   ├── adapters.ts       # Strands/A2A type converters
│   │   │   ├── events.ts         # A2A streaming events
│   │   │   ├── executor.ts       # A2A executor
│   │   │   ├── express-server.ts # Express-based A2A server
│   │   │   ├── logging.ts        # A2A-specific logging
│   │   │   ├── server.ts         # A2A server base
│   │   │   └── index.ts
│   │   │
│   │   ├── agent/                # Agent loop and streaming
│   │   │   ├── __tests__/
│   │   │   ├── agent.ts          # Core agent implementation
│   │   │   ├── agent-as-tool.ts  # Wrap agent as a tool
│   │   │   ├── printer.ts        # Agent output printing
│   │   │   ├── snapshot.ts       # Agent state snapshots
│   │   │   └── tool-caller.ts     # Direct tool calling via agent.tool accessor
│   │   │
│   │   ├── conversation-manager/ # Conversation history strategies
│   │   │   ├── __tests__/
│   │   │   ├── conversation-manager.ts
│   │   │   ├── null-conversation-manager.ts
│   │   │   ├── sliding-window-conversation-manager.ts
│   │   │   ├── summarizing-conversation-manager.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── hooks/                # Hooks system for extensibility
│   │   │   ├── __tests__/
│   │   │   ├── events.ts
│   │   │   ├── registry.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── logging/              # Structured logging
│   │   │   ├── __tests__/
│   │   │   ├── logger.ts
│   │   │   ├── warn-once.ts      # Dedupe warnings by message content
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── models/               # Model provider implementations
│   │   │   ├── __tests__/
│   │   │   ├── google/           # Google Gemini provider
│   │   │   │   ├── adapters.ts
│   │   │   │   ├── errors.ts
│   │   │   │   ├── model.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── index.ts
│   │   │   ├── openai/           # OpenAI provider (Chat Completions + Responses API)
│   │   │   │   ├── __tests__/    # Unit tests (chat.test.ts, responses.test.ts)
│   │   │   │   ├── chat-adapter.ts
│   │   │   │   ├── responses-adapter.ts
│   │   │   │   ├── formatting.ts
│   │   │   │   ├── errors.ts
│   │   │   │   ├── model.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── index.ts
│   │   │   ├── anthropic.ts      # Anthropic Claude
│   │   │   ├── bedrock.ts        # AWS Bedrock
│   │   │   ├── vercel.ts         # Vercel AI SDK
│   │   │   ├── defaults.ts       # Centralized model defaults + warning messages
│   │   │   ├── model.ts          # Base model interface
│   │   │   └── streaming.ts      # Streaming event types
│   │   │
│   │   ├── multiagent/           # Multi-agent orchestration
│   │   │   ├── __tests__/
│   │   │   ├── graph.ts          # Graph orchestrator (DAG)
│   │   │   ├── swarm.ts          # Swarm orchestrator (handoff)
│   │   │   ├── multiagent.ts     # Base multi-agent class
│   │   │   ├── nodes.ts          # Node types
│   │   │   ├── state.ts          # State management
│   │   │   ├── events.ts         # Streaming events
│   │   │   ├── edge.ts           # Edge definitions
│   │   │   ├── queue.ts          # Execution queue
│   │   │   ├── snapshot.ts       # Multi-agent snapshots
│   │   │   ├── plugins.ts        # Multi-agent plugins
│   │   │   └── index.ts
│   │   │
│   │   ├── interventions/         # Intervention system for authorization, guardrails, steering
│   │   │   ├── __tests__/
│   │   │   ├── actions.ts
│   │   │   ├── handler.ts
│   │   │   ├── registry.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── plugins/              # Plugin system
│   │   │   ├── __tests__/
│   │   │   ├── plugin.ts
│   │   │   ├── registry.ts
│   │   │   ├── model-plugin.ts   # Clears agent messages after invocation when model is stateful
│   │   │   └── index.ts
│   │   │
│   │   ├── registry/             # Tool registry
│   │   │   ├── __tests__/
│   │   │   └── tool-registry.ts
│   │   │
│   │   ├── retry/                # Retry strategies for model calls
│   │   │   ├── __tests__/
│   │   │   ├── backoff-strategy.ts
│   │   │   ├── model-retry-strategy.ts         # Abstract ModelRetryStrategy base class
│   │   │   ├── default-model-retry-strategy.ts
│   │   │   ├── retry-strategy.ts               # RetryStrategy union type + dedup helper
│   │   │   └── index.ts
│   │   │
│   │   ├── sandbox/              # Sandbox abstraction for agent code execution
│   │   │   ├── __tests__/
│   │   │   ├── base.ts           # Abstract Sandbox class
│   │   │   ├── posix-shell.ts    # PosixShellSandbox with shell-based defaults
│   │   │   ├── stream-process.ts # ChildProcess-to-AsyncGenerator bridge
│   │   │   ├── constants.ts      # Language validation pattern
│   │   │   └── types.ts          # ExecutionResult, StreamChunk, FileInfo, OutputFile
│   │   │
│   │   ├── session/              # Session management
│   │   │   ├── __tests__/
│   │   │   ├── session-manager.ts
│   │   │   ├── storage.ts        # Storage interface
│   │   │   ├── file-storage.ts   # File-based storage
│   │   │   ├── s3-storage.ts     # S3 storage
│   │   │   ├── types.ts
│   │   │   ├── validation.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── telemetry/            # OpenTelemetry tracing and metrics
│   │   │   ├── __tests__/
│   │   │   ├── tracer.ts
│   │   │   ├── meter.ts
│   │   │   ├── config.ts
│   │   │   ├── json.ts
│   │   │   ├── types.ts
│   │   │   ├── utils.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── tools/                # Tool definitions and types
│   │   │   ├── __tests__/
│   │   │   ├── function-tool.ts
│   │   │   ├── mcp-tool.ts
│   │   │   ├── noop-tool.ts
│   │   │   ├── structured-output-tool.ts
│   │   │   ├── tool-factory.ts
│   │   │   ├── tool.ts
│   │   │   ├── zod-tool.ts
│   │   │   ├── zod-utils.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── types/                # Core type definitions
│   │   │   ├── __tests__/
│   │   │   ├── agent.ts
│   │   │   ├── citations.ts
│   │   │   ├── elicitation.ts
│   │   │   ├── interrupt.ts
│   │   │   ├── json.ts
│   │   │   ├── lifecycle-observer.ts
│   │   │   ├── media.ts
│   │   │   ├── messages.ts
│   │   │   ├── serializable.ts
│   │   │   ├── snapshot.ts
│   │   │   └── validation.ts
│   │   │
│   │   ├── utils/                # Shared utility functions
│   │   │   └── shell-quote.ts    # Shell-safe string escaping
│   │   │
│   │   ├── vended-interventions/ # Optional vended intervention handlers
│   │   │   ├── hitl/             # Human-in-the-loop approval handler
│   │   │   │   ├── __tests__/
│   │   │   │   ├── hitl.ts
│   │   │   │   └── index.ts
│   │   │   └── steering/         # Steering handler base + LLM-driven steering
│   │   │       ├── __tests__/
│   │   │       ├── handlers/
│   │   │       │   ├── handler.ts
│   │   │       │   └── llm.ts
│   │   │       ├── providers/
│   │   │       │   ├── context-provider.ts
│   │   │       │   └── tool-ledger.ts
│   │   │       └── index.ts
│   │   │
│   │   ├── vended-plugins/       # Optional vended plugins
│   │   │   ├── index.ts          # Barrel export for all plugins
│   │   │   ├── context-offloader/ # Context offloading plugin
│   │   │   │   ├── __tests__/
│   │   │   │   ├── plugin.ts
│   │   │   │   ├── storage.ts
│   │   │   │   └── index.ts
│   │   │   └── skills/           # AgentSkills plugin
│   │   │       ├── __tests__/
│   │   │       ├── agent-skills.ts
│   │   │       ├── skill.ts
│   │   │       └── index.ts
│   │   │
│   │   ├── vended-tools/         # Optional vended tools
│   │   │   ├── index.ts          # Barrel export for all tools
│   │   │   ├── bash/
│   │   │   ├── file-editor/
│   │   │   ├── http-request/
│   │   │   └── notebook/
│   │   │
│   │   ├── errors.ts             # Custom error classes
│   │   ├── index.ts              # Main SDK entry point
│   │   ├── interrupt.ts          # Interrupt handling
│   │   ├── mcp.ts                # MCP client implementation
│   │   ├── mcp-config.ts         # MCP config file parsing
│   │   ├── mime.ts               # MIME type utilities
│   │   └── state-store.ts        # State store implementation
│   │
│   ├── generated/                # Auto-generated WIT type declarations
│   │   ├── interfaces/           # Per-interface type definitions
│   │   └── strands:agent.d.ts    # Top-level WIT agent declaration
│   │
│   ├── test/                     # Tests outside of source
│   │   ├── integ/                # Integration tests
│   │   │   ├── __fixtures__/     # Integration test fixtures
│   │   │   ├── __resources__/    # Static resources for integration tests
│   │   │   ├── a2a/
│   │   │   ├── conversation-manager/
│   │   │   ├── mcp/
│   │   │   ├── models/
│   │   │   │   └── openai/
│   │   │   ├── multiagent/
│   │   │   ├── skills/
│   │   │   ├── tools/
│   │   │   └── agent.test.ts
│   │   └── packages/             # Package compatibility tests (CJS/ESM)
│   │
│   ├── examples/                 # Example applications
│   │   ├── agents-as-tools/
│   │   ├── browser-agent/
│   │   ├── first-agent/
│   │   ├── graph/
│   │   ├── mcp/
│   │   ├── swarm/
│   │   └── telemetry/
│   │
│   ├── package.json              # SDK package config and dependencies
│   ├── tsconfig.base.json        # TypeScript configuration
│   ├── vitest.config.ts          # Testing configuration
│   └── eslint.config.js          # Linting configuration
│
├── strands-wasm/                 # WASM build tooling
│   ├── __fixtures__/             # Vitest module mocks for WIT imports
│   ├── __tests__/                # Unit tests for entry.ts internals
│   ├── generated/                # Auto-generated WIT type declarations
│   │   └── interfaces/           # Per-interface type definitions
│   ├── test/                     # Tests outside of source
│   │   └── guest/                # Tests that load the compiled WASM component
│   ├── docs/                     # WASM-specific documentation
│   ├── patches/                  # Runtime patches for WASM compatibility
│   │   └── getChunkedStream.js
│   ├── entry.ts                  # WASM entry point (TS SDK surface for WASM compilation)
│   ├── build.js                  # Build script for WASM compilation
│   ├── package.json              # WASM package configuration
│   ├── vitest.config.ts          # Test configuration (unit + guest projects)
│   └── tsconfig.json             # TypeScript type-check configuration
│
├── strands-py-wasm/               # Python SDK bindings (WASM-based)
│   ├── strands/                  # Python package source
│   │   ├── _generated/           # Auto-generated type bindings
│   │   ├── agent/                # Agent implementation
│   │   │   └── conversation_manager/
│   │   ├── event_loop/           # Event loop and retry logic
│   │   ├── models/               # Model providers (Bedrock, Anthropic, OpenAI, Gemini)
│   │   ├── multiagent/           # Multi-agent orchestration (Graph, Swarm)
│   │   ├── session/              # Session management (file, S3)
│   │   ├── tools/                # Tool definitions and MCP client
│   │   │   └── mcp/
│   │   ├── types/                # Type definitions
│   │   ├── _conversions.py       # Type conversions between TS and Python
│   │   ├── _wasm_host.py         # WASM host runtime bridge
│   │   ├── hooks.py              # Hooks system
│   │   └── interrupt.py          # Interrupt handling
│   ├── scripts/                  # Build/codegen scripts
│   │   └── generate_types.py     # Type generation from WIT definitions
│   ├── examples/                 # Example applications
│   ├── tests_integ/              # Integration tests
│   ├── pyproject.toml            # Python package configuration
│   └── pyrightconfig.json        # Python type checking configuration
│
├── strandly/                     # Developer CLI tooling
│   ├── scripts/
│   │   └── generate_types.py     # Type generation script
│   ├── src/
│   │   └── cli.ts                # CLI entry point
│   ├── package.json              # Dev CLI package configuration
│   └── tsconfig.json             # TypeScript configuration
│
├── wit/                          # WebAssembly Interface Type definitions
│   ├── deps/                     # WIT dependency interfaces
│   │   ├── clocks/clocks.wit
│   │   └── io/io.wit
│   ├── agent.wit                 # Top-level WIT world definition
│   ├── conversation.wit          # Conversation management interfaces
│   ├── logging.wit               # Logging interfaces
│   ├── mcp.wit                   # MCP protocol interfaces
│   ├── messages.wit              # Message type definitions
│   ├── models.wit                # Model provider interfaces
│   ├── multiagent.wit            # Multi-agent interfaces
│   ├── retry.wit                 # Retry strategy interfaces
│   ├── sessions.wit              # Session management interfaces
│   ├── streaming.wit             # Streaming event interfaces
│   ├── tools.wit                 # Tool interfaces
│   └── vended.wit                # Vended plugin/tool interfaces
│
├── dev-docs/                     # Project documentation
│   ├── TESTING.md                # Comprehensive testing guidelines
│   ├── DEPENDENCIES.md           # Dependency management guidelines
│   ├── DIVERGENCES.md            # Divergences from Python SDK
│   └── PR.md                     # Pull request guidelines and template
│
├── .github/                      # GitHub configuration
│   ├── ISSUE_TEMPLATE/           # Issue templates (bug report, feature request)
│   ├── PULL_REQUEST_TEMPLATE.md  # PR template
│   └── workflows/                # CI/CD workflows
│
├── .husky/                       # Git hooks (pre-commit checks)
│
├── package.json                  # Root workspace config (delegates to strands-ts)
├── .prettierrc                   # Code formatting configuration
├── .gitignore                    # Git ignore rules
│
├── AGENTS.md                     # This file (agent guidance)
├── COMPATIBILITY.MD              # Compatibility documentation
├── CONTRIBUTING.md               # Human contributor guidelines
└── README.md                     # Project overview and usage
```

### Directory Purposes

- **`strands-ts/`**: The SDK workspace package containing all source, tests, and examples
- **`strands-ts/src/`**: All production code with co-located unit tests
- **`strands-ts/src/__fixtures__/`**: Shared test fixtures (mock models, helpers)
- **`strands-ts/src/a2a/`**: Agent-to-agent protocol (A2A client, server, adapters, logging)
- **`strands-ts/src/agent/`**: Agent loop coordination, output printing, snapshots
- **`strands-ts/src/conversation-manager/`**: Conversation history management strategies
- **`strands-ts/src/hooks/`**: Hooks system for event-driven extensibility
- **`strands-ts/src/logging/`**: Structured logging utilities
- **`strands-ts/src/models/`**: Model provider implementations (Bedrock, Anthropic, OpenAI, Google, Vercel)
- **`strands-ts/src/multiagent/`**: Multi-agent orchestration patterns (Graph for DAG execution, Swarm for handoff-based routing)
- **`strands-ts/src/plugins/`**: Plugin system for extending agent functionality
- **`strands-ts/src/registry/`**: Tool registry implementation
- **`strands-ts/src/retry/`**: Retry strategies for model calls (backoff strategies, abstract `ModelRetryStrategy` plugin base class, concrete `DefaultModelRetryStrategy`)
- **`strands-ts/src/sandbox/`**: Sandbox abstraction for agent code execution (abstract `Sandbox` base class, `PosixShellSandbox` base for shell-based implementations)
- **`strands-ts/src/session/`**: Session management (file, S3, custom storage)
- **`strands-ts/src/telemetry/`**: OpenTelemetry tracing and metrics
- **`strands-ts/src/tools/`**: Tool definitions, types, and structured output validation with Zod schemas
- **`strands-ts/src/types/`**: Core type definitions used across the SDK
- **`strands-ts/src/utils/`**: Shared utility functions
- **`strands-ts/src/vended-interventions/`**: Optional vended intervention handlers (hitl, steering — not part of core SDK, independently importable)
- **`strands-ts/src/vended-plugins/`**: Optional vended plugins (context-offloader, skills — not part of core SDK, independently importable)
- **`strands-ts/src/vended-tools/`**: Optional vended tools (bash, file-editor, http-request, notebook)
- **`strands-ts/generated/`**: Auto-generated WIT interface type declarations
- **`strands-ts/test/integ/`**: Integration tests (tests public API and external integrations)
- **`strands-ts/examples/`**: Example applications
- **`strands-wasm/`**: WASM build tooling for compiling the TS SDK to WebAssembly
- **`strands-wasm/generated/`**: Auto-generated WIT interface type declarations for WASM
- **`strands-wasm/test/guest/`**: Tests that load the compiled WASM component
- **`strands-wasm/docs/`**: WASM-specific development documentation
- **`strands-py-wasm/`**: Python SDK bindings powered by the TS SDK compiled to WASM
- **`strands-py-wasm/strands/`**: Python package source with agent, models, multiagent, session, tools, and type modules
- **`strands-py-wasm/scripts/`**: Build and codegen scripts (type generation from WIT definitions)
- **`strands-py-wasm/tests_integ/`**: Python integration tests
- **`strandly/`**: Developer CLI tooling for local development workflows (install on PATH via `npm install && npm link -w strandly`, then call `strandly …`)
- **`wit/`**: WebAssembly Interface Type (WIT) definitions defining the contract between the TS SDK and WASM hosts
- **`wit/deps/`**: External WIT dependency interfaces (clocks, io)
- **`dev-docs/`**: Project documentation (testing guidelines, dependency management, divergences, PR guidelines)
- **`.github/workflows/`**: CI/CD automation and quality gates

**IMPORTANT**: After making changes that affect the directory structure (adding new directories, moving files, or adding significant new files), you MUST update this directory structure section to reflect the current state of the repository.

## Development Workflow for Agents

### 1. Environment Setup

See [CONTRIBUTING.md - Development Environment](CONTRIBUTING.md#development-environment) for:

- Prerequisites (Node.js 20+, npm)
- Installation steps
- Verification commands

### 2. Making Changes

1. **Create feature branch**: `git checkout -b agent-tasks/{ISSUE_NUMBER}`
2. **Implement changes** following the patterns below
3. **Run quality checks** before committing (pre-commit hooks will run automatically)
4. **Commit with conventional commits**: `feat:`, `fix:`, `refactor:`, `docs:`, etc.
5. **Push to remote**: `git push origin agent-tasks/{ISSUE_NUMBER}`
6. **Create pull request** following [PR.md](dev-docs/PR.md) guidelines

### 3. Pull Request Guidelines

When creating pull requests, you **MUST** follow the guidelines in [PR.md](dev-docs/PR.md). Key principles:

- **Focus on WHY**: Explain motivation and user impact, not implementation details
- **Document public API changes**: Show before/after code examples
- **Be concise**: Use prose over bullet lists; avoid exhaustive checklists
- **Target senior engineers**: Assume familiarity with the SDK
- **Exclude implementation details**: Leave these to code comments and diffs

See [PR.md](dev-docs/PR.md) for the complete guidance and template.

### 4. Quality Gates

Pre-commit hooks automatically run:

- Build (via npm run build, required for workspace type resolution)
- Unit tests with coverage (via npm run test:coverage)
- WASM unit tests (via npm run test -w strands-wasm)
- Linting (via npm run lint)
- Format checking (via npm run format:check)
- Type checking (via npm run type-check)

All checks must pass before commit is allowed.

### 5. Testing Guidelines

When writing tests, you **MUST** follow the guidelines in [dev-docs/TESTING.md](dev-docs/TESTING.md). Key topics covered:

- Test organization and file location
- Test batching strategy
- Object assertion best practices
- Test coverage requirements
- Multi-environment testing (Node.js and browser)

See [TESTING.md](dev-docs/TESTING.md) for the complete testing reference.

## Coding Patterns and Best Practices

### Logging Style Guide

The SDK uses a structured logging format consistent with the Python SDK for better log parsing and searchability.

**Format**:

```typescript
// With context fields
logger.warn(`field1=<${value1}>, field2=<${value2}> | human readable message`)

// Without context fields
logger.warn('human readable message')

// Multiple statements in message (use pipe to separate)
logger.warn(`field=<${value}> | statement one | statement two`)
```

**Guidelines**:

1. **Context Fields** (when relevant):
   - Add context as `field=<value>` pairs at the beginning
   - Use commas to separate pairs
   - Enclose values in `<>` for readability (especially helpful for empty values: `field=<>`)
   - Use template literals for string interpolation

2. **Messages**:
   - Add human-readable messages after context fields
   - Use lowercase for consistency
   - Avoid punctuation (periods, exclamation points) to reduce clutter
   - Keep messages concise and focused on a single statement
   - If multiple statements are needed, separate them with pipe character (`|`)

**Examples**:

```typescript
// Good: Context fields with message
logger.warn(`stop_reason=<${stopReason}>, fallback=<${fallback}> | unknown stop reason, converting to camelCase`)
logger.warn(`event_type=<${eventType}> | unsupported bedrock event type`)

// Good: Simple message without context fields
logger.warn('cache points are not supported in openai system prompts, ignoring cache points')

// Good: Multiple statements separated by pipes
logger.warn(`request_id=<${id}> | processing request | starting validation`)

// Bad: Not using angle brackets for values
logger.warn(`stop_reason=${stopReason} | unknown stop reason`)

// Bad: Using punctuation
logger.warn(`event_type=<${eventType}> | Unsupported event type.`)
```

### Import Organization

Use relative imports for internal modules:

```typescript
// Good: Relative imports for internal modules
import { hello } from './hello'
import { Agent } from '../agent'

// Good: External dependencies
import { something } from 'external-package'
```

### File Organization Pattern

**For source files**:

```
strands-ts/src/
├── module.ts              # Source file
└── __tests__/
    └── module.test.ts     # Unit tests co-located
```

**Function ordering within files**:

- Functions MUST be ordered from most general to most specific (top-down reading)
- Public/exported functions MUST appear before private helper functions
- Main entry point functions MUST be at the top of the file
- Helper functions SHOULD follow in order of their usage

**Example**:

```typescript
// Good: Main function first, helpers follow
export async function* mainFunction() {
  const result = await helperFunction1()
  return helperFunction2(result)
}

async function helperFunction1() {
  // Implementation
}

function helperFunction2(input: string) {
  // Implementation
}

// Bad: Helpers before main function
async function helperFunction1() {
  // Implementation
}

export async function* mainFunction() {
  const result = await helperFunction1()
  return helperFunction2(result)
}
```

**For integration tests**:

```
strands-ts/test/integ/
└── feature.test.ts        # Tests public API
```

### TypeScript Type Safety

**Optional chaining for null safety**: Prefer optional chaining over verbose `typeof` checks when accessing potentially undefined properties:

```typescript
// Good: Optional chaining
return globalThis?.process?.env?.API_KEY

// Bad: Verbose typeof checks
if (typeof process !== 'undefined' && typeof process.env !== 'undefined') {
  return process.env.API_KEY
}
return undefined
```

**Strict requirements**:

```typescript
// Good: Explicit return types
export function process(input: string): string {
  return input.toUpperCase()
}

// Bad: No return type
export function process(input: string) {
  return input.toUpperCase()
}

// Good: Proper typing
export function getData(): { id: number; name: string } {
  return { id: 1, name: 'test' }
}

// Bad: Using any
export function getData(): any {
  return { id: 1, name: 'test' }
}
```

**Rules**:

- Always provide explicit return types
- Never use `any` type (enforced by ESLint)
- Use TypeScript strict mode features
- Leverage type inference where appropriate

### Class Field Naming Conventions

**Private fields**: Use underscore prefix for private class fields to improve readability and distinguish them from public members.

```typescript
// Good: Private fields with underscore prefix
export class Example {
  private readonly _config: Config
  private _state: State

  constructor(config: Config) {
    this._config = config
    this._state = { initialized: false }
  }

  public getConfig(): Config {
    return this._config
  }
}

// Bad: No underscore for private fields
export class Example {
  private readonly config: Config // Missing underscore

  constructor(config: Config) {
    this.config = config
  }
}
```

**Rules**:

- Private fields MUST use underscore prefix (e.g., `_field`)
- Public fields MUST NOT use underscore prefix
- This convention improves code readability and makes the distinction between public and private members immediately visible

#### Naming Conventions for New Features

When choosing names and constants that match an existing implementation in the Python SDK, use exactly the same literal used
in the Python SDK. Wherever we can achieve compatibility, keep the previous convention.

#### Plugin Naming

Name plugins for what they do, not for the `Plugin` interface they implement.

```typescript
// Good
export class AgentSkills implements Plugin { ... }
export class DefaultModelRetryStrategy implements Plugin { ... }

// Bad
export class AgentSkillsPlugin implements Plugin { ... }
export class DefaultModelRetryStrategyPlugin implements Plugin { ... }
```

Same rule for the associated config (`AgentSkillsConfig`, not `AgentSkillsPluginConfig`).

### Documentation Requirements

**TSDoc format** (required for all exported functions):

````typescript
/**
 * Brief description of what the function does.
 *
 * @param paramName - Description of the parameter
 * @param optionalParam - Description of optional parameter
 * @returns Description of what is returned
 *
 * @example
 * ```typescript
 * const result = functionName('input')
 * console.log(result) // "output"
 * ```
 */
export function functionName(paramName: string, optionalParam?: number): string {
  // Implementation
}
````

**Interface property documentation**:

```typescript
/**
 * Interface description.
 */
export interface MyConfig {
  /**
   * Single-line description of the property.
   */
  propertyName: string

  /**
   * Single-line description with optional reference link.
   * @see https://docs.example.com/property-details
   */
  anotherProperty?: number
}
```

**Requirements**:

- All exported functions, classes, and interfaces must have TSDoc
- Include `@param` for all parameters
- Include `@returns` for return values
- Include `@example` only for exported classes (main SDK entry points like BedrockModel, Agent)
- Do NOT include `@example` for type definitions, interfaces, or internal types
- Interface properties MUST have single-line descriptions
- Interface properties MAY include an optional `@see` link for additional details
- TSDoc validation enforced by ESLint

### Code Style Guidelines

**Formatting** (enforced by Prettier):

- No semicolons
- Single quotes
- Line length: 120 characters
- Tab width: 2 spaces
- Trailing commas in ES5 style

**Example**:

```typescript
export function example(name: string, options?: Options): Result {
  const config = {
    name,
    enabled: true,
    settings: {
      timeout: 5000,
      retries: 3,
    },
  }

  return processConfig(config)
}
```

### Import Organization

Organize imports in this order:

```typescript
// 1. External dependencies
import { something } from 'external-package'

// 2. Internal modules (using relative paths)
import { Agent } from '../agent'
import { Tool } from '../tools'

// 3. Types (if separate)
import type { Options, Config } from '../types'
```

### Interface and Type Organization

**When defining interfaces or types, organize them so the top-level interface comes first, followed by its dependencies, and then all nested dependencies.**

```typescript
// Correct - Top-level first, then dependencies
export interface Message {
  role: Role
  content: ContentBlock[]
}

export type Role = 'user' | 'assistant'

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

export class TextBlock {
  readonly type = 'textBlock' as const
  readonly text: string
  constructor(data: { text: string }) {
    this.text = data.text
  }
}

export class ToolUseBlock {
  readonly type = 'toolUseBlock' as const
  readonly name: string
  readonly toolUseId: string
  readonly input: JSONValue
  constructor(data: { name: string; toolUseId: string; input: JSONValue }) {
    this.name = data.name
    this.toolUseId = data.toolUseId
    this.input = data.input
  }
}

export class ToolResultBlock {
  readonly type = 'toolResultBlock' as const
  readonly toolUseId: string
  readonly status: 'success' | 'error'
  readonly content: ToolResultContent[]
  constructor(data: { toolUseId: string; status: 'success' | 'error'; content: ToolResultContent[] }) {
    this.toolUseId = data.toolUseId
    this.status = data.status
    this.content = data.content
  }
}

// Wrong - Dependencies before top-level
export type Role = 'user' | 'assistant'

export interface TextBlockData {
  text: string
}

export interface Message {
  // Top-level should come first
  role: Role
  content: ContentBlock[]
}
```

**Rationale**: This ordering makes files more readable by providing an overview first, then details.

### Discriminated Union Naming Convention

**When creating discriminated unions with a `type` field, the type value MUST match the interface name with the first letter lowercase.**

```typescript
// Correct - type matches class name (first letter lowercase)
export class TextBlock {
  readonly type = 'textBlock' as const // Matches 'TextBlock' class name
  readonly text: string
  constructor(data: { text: string }) {
    this.text = data.text
  }
}

export class CachePointBlock {
  readonly type = 'cachePointBlock' as const // Matches 'CachePointBlock' class name
  readonly cacheType: 'default'
  constructor(data: { cacheType: 'default' }) {
    this.cacheType = data.cacheType
  }
}

export type ContentBlock = TextBlock | ToolUseBlock | CachePointBlock

// Wrong - type doesn't match class name
export class CachePointBlock {
  readonly type = 'cachePoint' as const // Should be 'cachePointBlock'
  readonly cacheType: 'default'
}
```

**Rationale**: This consistent naming makes discriminated unions predictable and improves code readability. Developers can easily understand the relationship between the type value and the class.

### API Union Types (Bedrock Pattern)

When the upstream API (e.g., Bedrock) defines a type as a **UNION** ("only one member can be specified"), model it as a TypeScript `type` union with each variant's field **required** — not an `interface` with optional fields. This allows non-breaking expansion when new variants are added.

The Bedrock API marks all fields in union types as "Not Required" as a mechanism for future extensibility. In TypeScript, encode the mutual exclusivity using `|` with each variant having its field required. The "not required" from the API docs means "this field won't be present if a different variant is active."

```typescript
// Correct: type union — each variant has its field required
// Adding a new variant later (e.g., | { image: ImageData }) is non-breaking
export type CitationSourceContent = { text: string }

// Correct: multi-variant union with object-key discrimination
export type DocumentSourceData =
  | { bytes: Uint8Array }
  | { text: string }
  | { content: DocumentContentBlockData[] }
  | { location: S3LocationData }

// Correct: multi-variant union for citation locations
export type CitationLocation =
  | { documentChar: DocumentCharLocation }
  | { documentPage: DocumentPageLocation }
  | { web: WebLocation }

// Wrong: interface with optional fields — cannot expand without breaking
export interface CitationSourceContent {
  text?: string
}

// Wrong: interface with required field — changing to union later is breaking
export interface CitationSourceContent {
  text: string
}
```

**Key points**:

- Use `type` alias (not `interface`) so it can be expanded to a union later
- Each variant's field is **required** within that variant
- Use object-key discrimination (`'text' in source`) to narrow variants at runtime
- See `DocumentSourceData` in `strands-ts/src/types/media.ts` and `CitationLocation` in `strands-ts/src/types/citations.ts` for reference implementations

### Error Handling

```typescript
// Good: Explicit error handling
export function process(input: string): string {
  if (!input) {
    throw new Error('Input cannot be empty')
  }
  return input.trim()
}

// Good: Custom error types
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
```

**Key Features:**

- Automatic tool discovery and registration
- Lazy connection (connects on first use)
- Supports stdio and HTTP transports
- Resource cleanup with `Symbol.dispose`

**See [`examples/mcp/`](strands-ts/examples/mcp/) for complete working examples.**

### Test Assertions

When asserting on objects, prefer `toStrictEqual` for full object comparison rather than checking individual fields:

```typescript
// Good: Full object assertion with toStrictEqual
expect(provider.getConfig()).toStrictEqual({
  modelId: 'gemini-2.5-flash',
  params: { temperature: 0.5 },
})

// Bad: Checking individual fields
expect(provider.getConfig().modelId).toBe('gemini-2.5-flash')
expect(provider.getConfig().params.temperature).toBe(0.5)
```

**Rationale**: Full object assertions catch unexpected properties and ensure the complete shape is correct.

### Dependency Management

When adding or modifying dependencies, you **MUST** follow the guidelines in [dev-docs/DEPENDENCIES.md](dev-docs/DEPENDENCIES.md). Key points:

- **`dependencies`**: Core SDK functionality that users don't interact with directly
- **`peerDependencies`**: Dependencies that cross API boundaries (users construct/pass instances)
- **`devDependencies`**: Build tools, testing frameworks, linters - not shipped to users

**Rule**: If a dependency crosses an API boundary, it **MUST** be a peer dependency.

## Things to Do

**Do**:

- Use relative imports for internal modules
- Co-locate unit tests with source under `__tests__` directories
- Follow nested describe pattern for test organization
- Write explicit return types for all functions
- Document all exported functions with TSDoc
- Use meaningful variable and function names
- Keep functions small and focused (single responsibility)
- Use async/await for asynchronous operations
- Handle errors explicitly

## Things NOT to Do

**Don't**:

- Use `any` type (enforced by ESLint)
- Put unit tests in separate `tests/` directory (use `strands-ts/src/**/__tests__/**`)
- Skip documentation for exported functions
- Use semicolons (Prettier will remove them)
- Commit without running pre-commit hooks
- Ignore linting errors
- Skip type checking
- Use implicit return types

## Development Commands

For detailed command usage, see [CONTRIBUTING.md - Testing Instructions](CONTRIBUTING.md#testing-instructions-and-best-practices).

Quick reference:

```bash
npm test              # Run unit tests in Node.js
npm run test:browser  # Run unit tests in browser (Chromium via Playwright)
npm run test:all      # Run all tests in all environments
npm run test:integ    # Run integration tests
npm run test:coverage # Run tests with coverage report
npm run lint          # Check code quality
npm run format        # Auto-fix formatting
npm run type-check    # Verify TypeScript types
npm run build         # Compile TypeScript
```

## Troubleshooting Common Issues

If TypeScript compilation fails:

1. Run `npm run type-check` to see all type errors
2. Ensure all functions have explicit return types
3. Verify no `any` types are used
4. Check that all imports are correctly typed

## Agent-Specific Notes

### When Implementing Features

1. **Read task requirements** carefully from the GitHub issue
2. **Follow TDD approach** if appropriate:
   - Write failing tests first
   - Implement minimal code to pass tests
   - Refactor while keeping tests green
3. **Use existing patterns** as reference
4. **Document as you go** with TSDoc comments
5. **Run all checks** before committing (pre-commit hooks will enforce this)

### Writing code

- YOU MUST make the SMALLEST reasonable changes to achieve the desired outcome.
- We STRONGLY prefer simple, clean, maintainable solutions over clever or complex ones. Readability and maintainability are PRIMARY CONCERNS, even at the cost of conciseness or performance.
- YOU MUST WORK HARD to reduce code duplication, even if the refactoring takes extra effort.
- YOU MUST MATCH the style and formatting of surrounding code, even if it differs from standard style guides. Consistency within a file trumps external standards.
- YOU MUST NOT manually change whitespace that does not affect execution or output. Otherwise, use a formatting tool.
- Fix broken things immediately when you find them. Don't ask permission to fix bugs.

#### Code Comments

- NEVER add comments explaining that something is "improved", "better", "new", "enhanced", or referencing what it used to be
- Comments should explain WHAT the code does or WHY it exists, not how it's better than something else
- YOU MUST NEVER add comments about what used to be there or how something has changed.
- YOU MUST NEVER refer to temporal context in comments (like "recently refactored" "moved") or code. Comments should be evergreen and describe the code as it is.
- YOU MUST NEVER write overly verbose comments. Use concise language.

### Code Review Considerations

When responding to PR feedback:

- Address all review comments
- Test changes thoroughly
- Update documentation if behavior changes
- Maintain test coverage
- Follow conventional commit format for fix commits

### Integration with Other Files

- **CONTRIBUTING.md**: Contains testing/setup commands and human contribution guidelines
- **dev-docs/TESTING.md**: Comprehensive testing guidelines (MUST follow when writing tests)
- **dev-docs/PR.md**: Pull request guidelines and template
- **README.md**: Public-facing documentation, links to strandsagents.com
- **package.json**: Root workspace config that delegates to strands-ts
- **strands-ts/package.json**: SDK package config, dependencies, and npm scripts

## Additional Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Vitest Documentation](https://vitest.dev/)
- [TSDoc Reference](https://tsdoc.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Strands Agents Documentation](https://strandsagents.com/)
