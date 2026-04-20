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
│   │   │   ├── server.ts         # A2A server base
│   │   │   └── index.ts
│   │   │
│   │   ├── agent/                # Agent loop and streaming
│   │   │   ├── __tests__/
│   │   │   ├── agent.ts          # Core agent implementation
│   │   │   ├── agent-as-tool.ts  # Wrap agent as a tool
│   │   │   ├── printer.ts        # Agent output printing
│   │   │   └── snapshot.ts       # Agent state snapshots
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
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── models/               # Model provider implementations
│   │   │   ├── __tests__/
│   │   │   ├── google/           # Google Gemini provider
│   │   │   ├── anthropic.ts      # Anthropic Claude
│   │   │   ├── bedrock.ts        # AWS Bedrock
│   │   │   ├── openai.ts         # OpenAI
│   │   │   ├── vercel.ts         # Vercel AI SDK
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
│   │   ├── plugins/              # Plugin system
│   │   │   ├── __tests__/
│   │   │   ├── plugin.ts
│   │   │   ├── registry.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── registry/             # Tool registry
│   │   │   ├── __tests__/
│   │   │   └── tool-registry.ts
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
│   │   │   ├── json.ts
│   │   │   ├── media.ts
│   │   │   ├── messages.ts
│   │   │   ├── serializable.ts
│   │   │   ├── snapshot.ts
│   │   │   └── validation.ts
│   │   │
│   │   ├── vended-plugins/       # Optional vended plugins
│   │   │   └── skills/           # AgentSkills plugin
│   │   │
│   │   ├── vended-tools/         # Optional vended tools
│   │   │   ├── bash/
│   │   │   ├── file-editor/
│   │   │   ├── http-request/
│   │   │   └── notebook/
│   │   │
│   │   ├── errors.ts             # Custom error classes
│   │   ├── index.ts              # Main SDK entry point
│   │   ├── mcp.ts                # MCP client implementation
│   │   ├── mime.ts               # MIME type utilities
│   │   └── state-store.ts        # State store implementation
│   │
│   ├── test/                     # Tests outside of source
│   │   ├── integ/                # Integration tests
│   │   │   ├── a2a/
│   │   │   ├── conversation-manager/
│   │   │   ├── mcp/
│   │   │   ├── models/
│   │   │   ├── multiagent/
│   │   │   ├── skills/
│   │   │   ├── tools/
│   │   │   ├── agent.test.ts
│   │   │   └── ...
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
├── test/                         # Root-level package compatibility tests
│   └── packages/
│       ├── cjs-module/
│       └── esm-module/
│
├── .github/                      # GitHub Actions workflows
│   ├── workflows/
│   └── agent-sops/
│
├── .husky/                       # Git hooks (pre-commit checks)
│
├── package.json                  # Root workspace config (delegates to strands-ts)
├── .prettierrc                   # Code formatting configuration
├── .gitignore                    # Git ignore rules
│
├── AGENTS.md                     # This file (agent guidance)
├── CONTRIBUTING.md               # Human contributor guidelines
└── README.md                     # Project overview and usage
```

### Directory Purposes

- **`strands-ts/`**: The SDK workspace package containing all source, tests, and examples
- **`strands-ts/src/`**: All production code with co-located unit tests
- **`strands-ts/src/__fixtures__/`**: Shared test fixtures (mock models, helpers)
- **`strands-ts/src/a2a/`**: Agent-to-agent protocol (A2A client, server, adapters)
- **`strands-ts/src/agent/`**: Agent loop coordination, output printing, snapshots
- **`strands-ts/src/conversation-manager/`**: Conversation history management strategies
- **`strands-ts/src/hooks/`**: Hooks system for event-driven extensibility
- **`strands-ts/src/logging/`**: Structured logging utilities
- **`strands-ts/src/models/`**: Model provider implementations (Bedrock, Anthropic, OpenAI, Google, Vercel)
- **`strands-ts/src/multiagent/`**: Multi-agent orchestration patterns (Graph for DAG execution, Swarm for handoff-based routing)
- **`strands-ts/src/plugins/`**: Plugin system for extending agent functionality
- **`strands-ts/src/registry/`**: Tool registry implementation
- **`strands-ts/src/session/`**: Session management (file, S3, custom storage)
- **`strands-ts/src/telemetry/`**: OpenTelemetry tracing and metrics
- **`strands-ts/src/tools/`**: Tool definitions, types, and structured output validation with Zod schemas
- **`strands-ts/src/types/`**: Core type definitions used across the SDK
- **`strands-ts/src/vended-plugins/`**: Optional vended plugins (not part of core SDK, independently importable)
- **`strands-ts/src/vended-tools/`**: Optional vended tools (bash, file-editor, http-request, notebook)
- **`strands-ts/test/integ/`**: Integration tests (tests public API and external integrations)
- **`strands-ts/examples/`**: Example applications
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

#### Naming Conventions for New Features

When choosing names and constants that match an existing implementation in the Python SDK, use exactly the same literal used
in the Python SDK. Wherever we can achieve compatibility, keep the previous convention.

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

// Wrong - Dependencies before top-level
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
// Correct - type matches class name (first letter lowercase)
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

// Wrong - type doesn't match class name
export class CachePointBlock {
  readonly type = 'cachePoint' as const  // Should be 'cachePointBlock'
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

When adding or modifying dependencies, you **MUST** follow the guidelines in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md). Key points:

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
- **docs/TESTING.md**: Comprehensive testing guidelines (MUST follow when writing tests)
- **docs/PR.md**: Pull request guidelines and template
- **README.md**: Public-facing documentation, links to strandsagents.com
- **package.json**: Root workspace config that delegates to strands-ts
- **strands-ts/package.json**: SDK package config, dependencies, and npm scripts

## Additional Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Vitest Documentation](https://vitest.dev/)
- [TSDoc Reference](https://tsdoc.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Strands Agents Documentation](https://strandsagents.com/)
