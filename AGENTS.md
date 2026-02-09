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

```
sdk-typescript/
├── src/                          # Source code (all production code)
│   ├── __tests__/                # Unit tests for root-level source files
│   │   ├── errors.test.ts        # Tests for error classes
│   │   ├── index.test.ts         # Tests for main entry point
│   │   └── interrupt.test.ts     # Tests for interrupt system
│   │
│   ├── agent/                    # Agent loop and streaming
│   │   ├── __tests__/            # Unit tests for agent loop
│   │   │   ├── agent.test.ts     # Tests for agent implementation
│   │   │   ├── agent.interrupt.test.ts # Tests for interrupt raise/resume cycle
│   │   │   ├── agent.hook.test.ts # Tests for agent hook integration
│   │   │   ├── state.test.ts     # Tests for agent state
│   │   │   └── printer.test.ts   # Tests for printer
│   │   ├── agent.ts              # Core agent implementation (incl. interrupt, structured output, steering)
│   │   ├── printer.ts            # Agent output printing
│   │   ├── state.ts              # Agent state implementation
│   │   └── streaming.ts          # Agent streaming event types
│   │
│   ├── conversation-manager/ # Conversation management implementations
│   │   ├── __tests__/        # Unit tests for conversation managers
│   │   │   ├── conversation-manager.test.ts
│   │   │   ├── null-conversation-manager.test.ts
│   │   │   ├── sliding-window-conversation-manager.test.ts
│   │   │   └── summarizing-conversation-manager.test.ts
│   │   ├── conversation-manager.ts        # Abstract base class
│   │   ├── null-conversation-manager.ts   # No-op implementation
│   │   ├── sliding-window-conversation-manager.ts  # Sliding window strategy
│   │   ├── summarizing-conversation-manager.ts     # LLM-based summarization strategy
│   │   └── index.ts          # Public exports
│   │
│   ├── hooks/                    # Hooks system for extensibility
│   │   ├── __tests__/            # Unit tests for hooks
│   │   │   ├── events.test.ts    # Tests for hook events
│   │   │   ├── events-interrupt.test.ts  # Tests for BeforeToolCallEvent.interrupt()
│   │   │   ├── interrupt-integration.test.ts # Tests for interrupt collection in registry
│   │   │   └── registry.test.ts  # Tests for HookRegistry
│   │   ├── events.ts             # HookEvent base class and concrete events (incl. interrupt support)
│   │   ├── registry.ts           # HookRegistry implementation (incl. interrupt collection)
│   │   ├── types.ts              # Hook-related type definitions
│   │   └── index.ts              # Public exports for hooks
│   │
│   ├── models/                   # Model provider implementations
│   │   ├── __tests__/            # Unit tests for model providers
│   │   │   ├── anthropic.test.ts # Tests for Anthropic model provider
│   │   │   ├── bedrock.test.ts   # Tests for Bedrock model provider
│   │   │   ├── gemini.test.ts    # Tests for Gemini model provider
│   │   │   ├── model.test.ts     # Tests for base model provider
│   │   │   └── openai.test.ts    # Tests for OpenAI model provider
│   │   ├── anthropic.ts          # Anthropic Claude model provider
│   │   ├── bedrock.ts            # AWS Bedrock model provider
│   │   ├── gemini/               # Google Gemini model provider
│   │   │   ├── adapters.ts       # Gemini adapter utilities
│   │   │   ├── errors.ts         # Gemini error types
│   │   │   ├── model.ts          # Gemini model implementation
│   │   │   └── types.ts          # Gemini-specific types
│   │   ├── model.ts              # Base model provider interface
│   │   ├── openai.ts             # OpenAI model provider
│   │   └── streaming.ts          # Streaming event types
│   │
│   ├── tools/                    # Tool definitions and types
│   │   ├── __tests__/            # Unit tests for tools
│   │   │   ├── agent-tool.test.ts # Tests for AgentTool
│   │   │   ├── registry.test.ts  # Tests for ToolRegistry
│   │   │   ├── tool.test.ts      # Tests for FunctionTool
│   │   │   └── zod-tool.test.ts  # Tests for zod-based tool factory
│   │   ├── structured-output/    # Structured output tool system
│   │   │   ├── __tests__/
│   │   │   │   ├── structured-output-context.test.ts
│   │   │   │   └── structured-output-tool.test.ts
│   │   │   ├── structured-output-context.ts  # Structured output context management
│   │   │   └── structured-output-tool.ts     # Structured output tool implementation
│   │   ├── agent-tool.ts         # AgentTool implementation (wraps Agent as Tool)
│   │   ├── function-tool.ts      # FunctionTool implementation
│   │   ├── mcp-tool.ts           # MCP tool wrapper
│   │   ├── tool.ts               # Tool interface (incl. ToolContext with interrupt support)
│   │   ├── types.ts              # Tool-related type definitions
│   │   └── zod-tool.ts           # Zod schema-based tool factory
│   │
│   ├── registry/                 # Generic and tool registries
│   │   ├── registry.ts           # Base Registry implementation
│   │   └── tool-registry.ts      # ToolRegistry specialization
│   │
│   ├── session/                  # Session management (persistence)
│   │   ├── __tests__/            # Unit tests for session managers
│   │   │   └── file-session-manager.test.ts
│   │   ├── file-session-manager.ts       # File-system session manager
│   │   ├── repository-session-manager.ts # Repository-pattern session manager
│   │   ├── s3-session-manager.ts         # AWS S3 session manager
│   │   ├── session-manager.ts            # Abstract base session manager
│   │   └── session-repository.ts         # SessionRepository interface
│   │
│   ├── multiagent/               # Multi-agent orchestration (Swarm, Graph)
│   │   ├── __tests__/            # Unit tests for multi-agent patterns
│   │   │   ├── base.test.ts      # Tests for Status, NodeResult, MultiAgentBase, events
│   │   │   ├── swarm.test.ts     # Tests for Swarm and SwarmNode
│   │   │   └── graph.test.ts     # Tests for Graph, GraphBuilder, GraphNode
│   │   ├── base.ts               # Status, NodeResult, MultiAgentResult, MultiAgentBase
│   │   ├── graph.ts              # Graph, GraphBuilder, GraphNode, GraphEdge, GraphState, GraphResult
│   │   ├── hook-events.ts        # Multi-agent hook events (BeforeNodeCallEvent, etc.)
│   │   ├── index.ts              # Public exports for multiagent
│   │   ├── streaming-events.ts   # Multi-agent streaming event classes
│   │   ├── swarm.ts              # Swarm, SwarmNode, SharedContext, SwarmState, SwarmResult
│   │   └── types.ts              # MultiAgentInput, MultiAgentStreamEvent
│   │
│   ├── telemetry/                # OpenTelemetry tracing integration
│   │   ├── __tests__/            # Unit tests for telemetry
│   │   │   └── tracer.test.ts    # Tests for tracer
│   │   ├── tracer.ts             # Core tracing implementation (StrandsTracer, getTracer, serialize)
│   │   └── types.ts              # Telemetry type definitions (AttributeValue)
│   │
│   ├── experimental/             # Experimental features (API may change)
│   │   └── steering/             # Agent steering system
│   │       ├── core/             # Core steering abstractions
│   │       │   ├── __tests__/
│   │       │   │   └── handler.test.ts
│   │       │   ├── action.ts     # Steering actions (Proceed, Guide, Interrupt)
│   │       │   ├── context.ts    # SteeringContext and providers
│   │       │   └── handler.ts    # Base SteeringHandler
│   │       ├── handlers/         # Steering handler implementations
│   │       │   └── llm/          # LLM-based steering
│   │       │       ├── __tests__/
│   │       │       │   ├── llm-handler.test.ts
│   │       │       │   └── mappers.test.ts
│   │       │       ├── llm-handler.ts  # LLMSteeringHandler
│   │       │       └── mappers.ts      # Prompt mappers for LLM steering
│   │       └── context-providers/ # Built-in context providers
│   │           ├── __tests__/
│   │           │   └── ledger-provider.test.ts
│   │           └── ledger-provider.ts  # Ledger-based tool tracking
│   │
│   ├── logging/                  # Structured logging
│   │   ├── index.ts              # Public exports
│   │   ├── logger.ts             # Logger implementation and configureLogging
│   │   └── types.ts              # Logger interface
│   │
│   ├── types/                    # Core type definitions
│   │   ├── __tests__/            # Unit tests for types
│   │   │   ├── agent.test.ts     # Tests for AgentResult
│   │   │   ├── json.test.ts      # Tests for JSON utilities
│   │   │   ├── media.test.ts     # Tests for media types
│   │   │   ├── messages.test.ts  # Tests for message types
│   │   │   └── validation.test.ts # Tests for validation utilities
│   │   ├── agent.ts              # Agent types (AgentResult, AgentData, AgentResultMetrics)
│   │   ├── interrupt.ts          # Interrupt response types (InterruptResponse, InterruptResponseContent)
│   │   ├── json.ts               # JSON schema and value types
│   │   ├── media.ts              # Media content types (ImageBlock, VideoBlock, DocumentBlock)
│   │   ├── messages.ts           # Message and content block types
│   │   ├── session.ts            # Session serialization types and helpers
│   │   └── validation.ts         # Validation utilities
│   │
│   ├── __tests__/                # Unit tests for root-level source files
│   │   ├── errors.test.ts        # Tests for error classes
│   │   ├── index.test.ts         # Tests for main entry point
│   │   ├── interrupt.test.ts     # Tests for interrupt system
│   │   └── mcp.test.ts           # Tests for MCP integration
│   │
│   ├── __fixtures__/             # Shared test fixtures
│   │   ├── mock-message-model.ts # Content-focused mock model for agent tests
│   │   ├── model-test-helpers.ts # Test helpers for model testing
│   │   ├── tool-helpers.ts       # Mock tool and context helpers
│   │   └── environment.ts        # Environment detection for tests
│   │
│   ├── interrupt.ts              # Interrupt system (Interrupt, InterruptException, InterruptState)
│   ├── mcp.ts                    # MCP client implementation
│   ├── errors.ts                 # Custom error classes
│   └── index.ts                  # Main SDK entry point (single export point)
│
├── src/vended-tools/              # Optional vended tools (not part of core SDK)
│   ├── notebook/                 # Notebook tool for managing text notebooks
│   │   ├── __tests__/            # Unit tests for notebook tool
│   │   │   └── notebook.test.ts
│   │   ├── notebook.ts           # Notebook implementation
│   │   ├── types.ts              # Notebook type definitions
│   │   ├── index.ts              # Public exports for notebook tool
│   │   └── README.md             # Notebook tool documentation
│   └── README.md                 # Vended tools overview
│
├── test/integ/                  # Integration tests (separate from source)
│   ├── agent.test.ts             # Agent integration tests
│   ├── bedrock.test.ts           # Bedrock integration tests (requires AWS credentials)
│   ├── hooks.test.ts             # Hooks integration tests
│   └── registry.test.ts          # ToolRegistry integration tests
│
├── examples/                     # Example applications
│   ├── first-agent/              # Basic agent usage example
│   └── mcp/                      # MCP integration examples
│
├── .github/                      # GitHub Actions workflows
│   ├── workflows/                # CI/CD workflows
│   │   ├── pr-and-push.yml       # Triggers test/lint on PR and push
│   │   ├── test-lint.yml         # Unit tests and linting
│   │   └── integration-test.yml  # Secure integration tests with AWS
│   └── agent-sops/               # Agent system prompts
│
├── .project/                     # Project management (tasks, tracking)
│   ├── tasks/                    # Active tasks
│   ├── tasks/completed/          # Completed tasks
│   ├── project-overview.md       # Project goals and roadmap
│   └── task-registry.md          # Task dependencies
│
├── dist/                         # Compiled output (generated, not in git)
├── coverage/                     # Test coverage reports (generated)
├── node_modules/                 # Dependencies (generated)
│
├── package.json                  # Project configuration and dependencies
├── tsconfig.json                 # TypeScript compiler configuration
├── vitest.config.ts              # Testing configuration (with unit/integ projects)
├── eslint.config.js              # Linting configuration
├── .prettierrc                   # Code formatting configuration
├── .gitignore                    # Git ignore rules
├── .husky/                       # Git hooks (pre-commit checks)
│
├── AGENTS.md                     # This file (agent guidance)
├── CONTRIBUTING.md               # Human contributor guidelines
└── README.md                     # Project overview and usage
```

### Directory Purposes

- **`src/`**: All production code lives here with co-located unit tests
- **`src/__tests__/`**: Unit tests for root-level source files
- **`src/__fixtures__/`**: Shared test fixtures (mock models, tool helpers, environment detection)
- **`src/agent/`**: Agent loop coordination, streaming, output printing, interrupt handling
- **`src/conversation-manager/`**: Conversation history management strategies (sliding window, summarizing)
- **`src/hooks/`**: Hooks system for event-driven extensibility (incl. interrupt support)
- **`src/models/`**: Model provider implementations (Bedrock, Anthropic, OpenAI, Gemini)
- **`src/registry/`**: Generic and tool-specific registries
- **`src/session/`**: Session management and persistence (file, S3, repository pattern)
- **`src/multiagent/`**: Multi-agent orchestration (Swarm pattern, Graph pattern, base infrastructure, hook/stream events)
- **`src/telemetry/`**: OpenTelemetry tracing integration (optional peer dependency)
- **`src/tools/`**: Tool definitions, types, and implementations (FunctionTool, AgentTool, MCP, structured output)
- **`src/types/`**: Core type definitions used across the SDK
- **`src/experimental/`**: Experimental features with unstable APIs (agent steering)
- **`src/logging/`**: Structured logging configuration and types
- **`src/vended-tools/`**: Optional vended tools (not part of core SDK, independently importable)
- **`test/integ/`**: Integration tests (tests public API and external integrations)
- **`.github/workflows/`**: CI/CD automation and quality gates
- **`.project/`**: Task management and project tracking

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
6. **Create pull request** following [PR.md](docs/PR.md) guidelines

### 3. Pull Request Guidelines

When creating pull requests, you **MUST** follow the guidelines in [PR.md](docs/PR.md). Key principles:

- **Focus on WHY**: Explain motivation and user impact, not implementation details
- **Document public API changes**: Show before/after code examples
- **Be concise**: Use prose over bullet lists; avoid exhaustive checklists
- **Target senior engineers**: Assume familiarity with the SDK
- **Exclude implementation details**: Leave these to code comments and diffs

See [PR.md](docs/PR.md) for the complete guidance and template.

### 4. Quality Gates

Pre-commit hooks automatically run:
- Unit tests (via npm test)
- Linting (via npm run lint)
- Format checking (via npm run format:check)
- Type checking (via npm run type-check)

All checks must pass before commit is allowed.

### 5. Testing Guidelines

When writing tests, you **MUST** follow the guidelines in [docs/TESTING.md](docs/TESTING.md). Key topics covered:

- Test organization and file location
- Test batching strategy
- Object assertion best practices
- Test coverage requirements
- Multi-environment testing (Node.js and browser)

See [TESTING.md](docs/TESTING.md) for the complete testing reference.

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
// ✅ Good: Context fields with message
logger.warn(`stop_reason=<${stopReason}>, fallback=<${fallback}> | unknown stop reason, converting to camelCase`)
logger.warn(`event_type=<${eventType}> | unsupported bedrock event type`)

// ✅ Good: Simple message without context fields
logger.warn('cache points are not supported in openai system prompts, ignoring cache points')

// ✅ Good: Multiple statements separated by pipes
logger.warn(`request_id=<${id}> | processing request | starting validation`)

// ❌ Bad: Not using angle brackets for values
logger.warn(`stop_reason=${stopReason} | unknown stop reason`)

// ❌ Bad: Using punctuation
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
src/
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
// ✅ Good: Main function first, helpers follow
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

// ❌ Bad: Helpers before main function
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
test/integ/
└── feature.test.ts        # Tests public API
```

### TypeScript Type Safety

**Optional chaining for null safety**: Prefer optional chaining over verbose `typeof` checks when accessing potentially undefined properties:

```typescript
// ✅ Good: Optional chaining
return globalThis?.process?.env?.API_KEY

// ❌ Bad: Verbose typeof checks
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
// ✅ Good: Private fields with underscore prefix
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

// ❌ Bad: No underscore for private fields
export class Example {
  private readonly config: Config  // Missing underscore

  constructor(config: Config) {
    this.config = config
  }
}
```

**Rules**:
- Private fields MUST use underscore prefix (e.g., `_field`)
- Public fields MUST NOT use underscore prefix
- This convention improves code readability and makes the distinction between public and private members immediately visible

### Documentation Requirements

**TSDoc format** (required for all exported functions):

```typescript
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
```

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
// ✅ Correct - Top-level first, then dependencies
export interface Message {
  role: Role
  content: ContentBlock[]
}

export type Role = 'user' | 'assistant'

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

export class TextBlock {
  readonly type = 'textBlock' as const
  readonly text: string
  constructor(data: { text: string }) { this.text = data.text }
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

// ❌ Wrong - Dependencies before top-level
export type Role = 'user' | 'assistant'

export interface TextBlockData {
  text: string
}

export interface Message {  // Top-level should come first
  role: Role
  content: ContentBlock[]
}
```

**Rationale**: This ordering makes files more readable by providing an overview first, then details.

### Discriminated Union Naming Convention

**When creating discriminated unions with a `type` field, the type value MUST match the interface name with the first letter lowercase.**

```typescript
// ✅ Correct - type matches class name (first letter lowercase)
export class TextBlock {
  readonly type = 'textBlock' as const  // Matches 'TextBlock' class name
  readonly text: string
  constructor(data: { text: string }) { this.text = data.text }
}

export class CachePointBlock {
  readonly type = 'cachePointBlock' as const  // Matches 'CachePointBlock' class name
  readonly cacheType: 'default'
  constructor(data: { cacheType: 'default' }) { this.cacheType = data.cacheType }
}

export type ContentBlock = TextBlock | ToolUseBlock | CachePointBlock

// ❌ Wrong - type doesn't match class name
export class CachePointBlock {
  readonly type = 'cachePoint' as const  // Should be 'cachePointBlock'
  readonly cacheType: 'default'
}
```

**Rationale**: This consistent naming makes discriminated unions predictable and improves code readability. Developers can easily understand the relationship between the type value and the class.

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

**See [`examples/mcp/`](examples/mcp/) for complete working examples.**

### Test Assertions

When asserting on objects, prefer `toStrictEqual` for full object comparison rather than checking individual fields:

```typescript
// ✅ Good: Full object assertion with toStrictEqual
expect(provider.getConfig()).toStrictEqual({
  modelId: 'gemini-2.5-flash',
  params: { temperature: 0.5 },
})

// ❌ Bad: Checking individual fields
expect(provider.getConfig().modelId).toBe('gemini-2.5-flash')
expect(provider.getConfig().params.temperature).toBe(0.5)
```

**Rationale**: Full object assertions catch unexpected properties and ensure the complete shape is correct.

## Things to Do

✅ **Do**:
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

❌ **Don't**:
- Use `any` type (enforced by ESLint)
- Put unit tests in separate `tests/` directory (use `src/**/__tests__/**`)
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
- **docs/TESTING.md**: Comprehensive testing guidelines (MUST follow when writing tests)
- **docs/PR.md**: Pull request guidelines and template
- **README.md**: Public-facing documentation, links to strandsagents.com
- **package.json**: Defines all npm scripts referenced in documentation

## Additional Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Vitest Documentation](https://vitest.dev/)
- [TSDoc Reference](https://tsdoc.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Strands Agents Documentation](https://strandsagents.com/)
