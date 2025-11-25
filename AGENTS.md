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
│   │   └── index.test.ts         # Tests for main entry point
│   │
│   ├── agent/                    # Agent loop and streaming
│   │   ├── __tests__/            # Unit tests for agent loop
│   │   │   ├── agent.test.ts     # Tests for agent implementation
│   │   │   ├── state.test.ts     # Tests for agent state
│   │   │   └── printer.test.ts   # Tests for printer
│   │   ├── agent.ts              # Core agent implementation
│   │   ├── printer.ts            # Agent output printing
│   │   ├── state.ts              # Agent state implementation
│   │   └── streaming.ts          # Agent streaming event types
│   │
│   ├── conversation-manager/ # Conversation management implementations
│   │   ├── __tests__/        # Unit tests for conversation managers
│   │   │   ├── conversation-manager.test.ts
│   │   │   ├── null-conversation-manager.test.ts
│   │   │   └── sliding-window-conversation-manager.test.ts
│   │   ├── conversation-manager.ts        # Abstract base class
│   │   ├── null-conversation-manager.ts   # No-op implementation
│   │   ├── sliding-window-conversation-manager.ts  # Sliding window strategy
│   │   └── index.ts          # Public exports
│   │
│   ├── hooks/                    # Hooks system for extensibility
│   │   ├── __tests__/            # Unit tests for hooks
│   │   │   ├── events.test.ts    # Tests for hook events
│   │   │   └── registry.test.ts  # Tests for HookRegistry
│   │   ├── events.ts             # HookEvent base class and concrete events
│   │   ├── registry.ts           # HookRegistry implementation
│   │   ├── types.ts              # Hook-related type definitions
│   │   └── index.ts              # Public exports for hooks
│   │
│   ├── models/                   # Model provider implementations
│   │   ├── __tests__/            # Unit tests for model providers
│   │   │   └── bedrock.test.ts   # Tests for Bedrock model provider
│   │   ├── bedrock.ts            # AWS Bedrock model provider
│   │   ├── model.ts              # Base model provider interface
│   │   └── streaming.ts          # Streaming event types
│   │
│   ├── tools/                    # Tool definitions and types
│   │   ├── __tests__/            # Unit tests for tools
│   │   │   ├── registry.test.ts  # Tests for ToolRegistry
│   │   │   └── tool.test.ts      # Tests for FunctionTool
│   │   ├── function-tool.ts      # FunctionTool implementation
│   │   ├── mcp-tool.ts           # MCP tool wrapper
│   │   ├── registry.ts           # ToolRegistry implementation
│   │   ├── tool.ts               # Tool interface
│   │   └── types.ts              # Tool-related type definitions
│   │
│   ├── types/                    # Core type definitions
│   │   ├── json.ts               # JSON schema and value types
│   │   └── messages.ts           # Message and content block types
│   │
│   ├── __tests__/                # Unit tests for root-level source files
│   │   ├── errors.test.ts        # Tests for error classes
│   │   ├── index.test.ts         # Tests for main entry point
│   │   └── mcp.test.ts           # Tests for MCP integration
│   │
│   ├── mcp.ts                    # MCP client implementation
│   ├── errors.ts                 # Custom error classes
│   └── index.ts                  # Main SDK entry point (single export point)
│
├── vended_tools/                  # Optional vended tools (not part of core SDK)
│   ├── notebook/                 # Notebook tool for managing text notebooks
│   │   ├── __tests__/            # Unit tests for notebook tool
│   │   │   └── notebook.test.ts
│   │   ├── notebook.ts           # Notebook implementation
│   │   ├── types.ts              # Notebook type definitions
│   │   ├── index.ts              # Public exports for notebook tool
│   │   └── README.md             # Notebook tool documentation
│   └── README.md                 # Vended tools overview
│
├── tests_integ/                  # Integration tests (separate from source)
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
- **`src/agent/`**: Agent loop coordination, streaming event types, output printing, and conversation management
- **`src/agent/conversation-manager/`**: Conversation history management strategies
- **`src/hooks/`**: Hooks system for event-driven extensibility
- **`src/models/`**: Model provider implementations (Bedrock, OpenAI, future providers)
- **`src/tools/`**: Tool definitions and types for agent tool use
- **`src/types/`**: Core type definitions used across the SDK
- **`vended_tools/`**: Optional vended tools (not part of core SDK, independently importable)
- **`tests_integ/`**: Integration tests (tests public API and external integrations)
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

### 3. Quality Gates

Pre-commit hooks automatically run:
- Unit tests (via npm test)
- Linting (via npm run lint)
- Format checking (via npm run format:check)
- Type checking (via npm run type-check)

All checks must pass before commit is allowed.

## Coding Patterns and Best Practices

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
tests_integ/
└── feature.test.ts        # Tests public API
```

### Test Organization Pattern

Follow this nested describe pattern for consistency:

**For functions**:
```typescript
import { describe, it, expect } from 'vitest'
import { functionName } from '../module'

describe('functionName', () => {
  describe('when called with valid input', () => {
    it('returns expected result', () => {
      const result = functionName('input')
      expect(result).toBe('expected')
    })
  })

  describe('when called with edge case', () => {
    it('handles gracefully', () => {
      const result = functionName('')
      expect(result).toBeDefined()
    })
  })
})
```

**For classes**:
```typescript
import { describe, it, expect } from 'vitest'
import { ClassName } from '../module'

describe('ClassName', () => {
  describe('methodName', () => {
    it('returns expected result', () => {
      const instance = new ClassName()
      const result = instance.methodName()
      expect(result).toBe('expected')
    })

    it('handles error case', () => {
      const instance = new ClassName()
      expect(() => instance.methodName()).toThrow()
    })
  })

  describe('anotherMethod', () => {
    it('performs expected action', () => {
      // Test implementation
    })
  })
})
```

**Key principles**:
- Top-level `describe` uses the function/class name
- Nested `describe` blocks group related test scenarios
- Use descriptive test names without "should" prefix
- Group tests by functionality or scenario

### Test Batching Strategy

**Rule**: When test setup cost exceeds test logic cost, you MUST batch related assertions into a single test.

**You MUST batch when**:
- Setup complexity > test logic complexity
- Multiple assertions verify the same object state
- Related behaviors share expensive context

**You SHOULD keep separate tests for**:
- Distinct behaviors or execution paths
- Error conditions
- Different input scenarios

**Bad - Redundant setup**:
```typescript
it('has correct tool name', () => {
  const tool = createComplexTool({ /* expensive setup */ })
  expect(tool.toolName).toBe('testTool')
})

it('has correct description', () => {
  const tool = createComplexTool({ /* same expensive setup */ })
  expect(tool.description).toBe('Test description')
})
```

**Good - Batched properties**:
```typescript
it('creates tool with correct properties', () => {
  const tool = createComplexTool({ /* setup once */ })
  expect(tool.toolName).toBe('testTool')
  expect(tool.description).toBe('Test description')
  expect(tool.toolSpec.name).toBe('testTool')
})
```

### TypeScript Type Safety

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

## Testing Patterns

### Unit Test Location

**Rule**: Unit tests files are co-located with source files, grouped in a directory named `__tests__`

```
src/subdir/
├── agent.ts                    # Source file
├── model.ts                    # Source file
└── __tests__/
    ├── agent.test.ts           # Tests for agent.ts
    └── model.test.ts           # Tests for model.ts
```

### Integration Test Location

**Rule**: Integration tests are separate in `tests_integ/`

```
tests_integ/
├── api.test.ts                 # Tests public API
└── environment.test.ts         # Tests environment compatibility
```

### Test File Naming

- Unit tests: `{sourceFileName}.test.ts` in `src/**/__tests__/**`
- Integration tests: `{feature}.test.ts` in `tests_integ/`

### Test Coverage

- **Minimum**: 80% coverage required (enforced by Vitest)
- **Target**: Aim for high coverage on critical paths
- **Exclusions**: Test files, config files, generated code

### Writing Effective Tests

```typescript
// Good: Clear, specific test
describe('calculateTotal', () => {
  describe('when given valid numbers', () => {
    it('returns the sum', () => {
      expect(calculateTotal([1, 2, 3])).toBe(6)
    })
  })

  describe('when given empty array', () => {
    it('returns zero', () => {
      expect(calculateTotal([])).toBe(0)
    })
  })
})

// Bad: Vague, unclear test
describe('calculateTotal', () => {
  it('works', () => {
    expect(calculateTotal([1, 2, 3])).toBeTruthy()
  })
})
```

### Object Assertion Best Practices

**Prefer testing entire objects at once** instead of individual properties for better readability and test coverage.

```typescript
// ✅ Good: Verify entire object at once
it('returns expected user object', () => {
  const user = getUser('123')
  expect(user).toEqual({
    id: '123',
    name: 'John Doe',
    email: 'john@example.com',
    isActive: true
  })
})

// ✅ Good: Verify entire array of objects
it('yields expected stream events', async () => {
  const events = await collectIterator(stream)
  expect(events).toEqual([
    { type: 'streamEvent', data: 'Starting...' },
    { type: 'streamEvent', data: 'Processing...' },
    { type: 'streamEvent', data: 'Complete!' },
  ])
})

// ❌ Bad: Testing individual properties
it('returns expected user object', () => {
  const user = getUser('123')
  expect(user).toBeDefined()
  expect(user.id).toBe('123')
  expect(user.name).toBe('John Doe')
  expect(user.email).toBe('john@example.com')
  expect(user.isActive).toBe(true)
})

// ❌ Bad: Testing array elements individually in a loop
it('yields expected stream events', async () => {
  const events = await collectIterator(stream)
  for (const event of events) {
    expect(event.type).toBe('streamEvent')
    expect(event).toHaveProperty('data')
  }
})
```

**Benefits of testing entire objects**:
- **More concise**: Single assertion instead of multiple
- **Better test coverage**: Catches unexpected additional or missing properties
- **More readable**: Clear expectation of the entire structure
- **Easier to maintain**: Changes to the object require updating one place

**Use cases**:
- Always use `toEqual()` for object and array comparisons
- Use `toBe()` only for primitive values and reference equality
- When testing error objects, verify the entire structure including message and type

### Testing Guidelines

**Testing Approach:**
- You **MUST** write tests for implementations (functions, classes, methods)
- You **SHOULD NOT** write tests for interfaces since TypeScript compiler already enforces type correctness
- You **SHOULD** write Vitest type tests (`*.test-d.ts`) for complex types to ensure backwards compatibility

**Example Implementation Test:**
```typescript
describe('BedrockModel', () => {
  it('streams messages correctly', async () => {
    const provider = new BedrockModel(config)
    const stream = provider.stream(messages)
    
    for await (const event of stream) {
      if (event.type === 'modelMessageStartEvent') {
        expect(event.role).toBe('assistant')
      }
    }
  })
})
```

### Test Model Providers

**When to use each test provider:**

- **`MockMessageModel`**: For agent loop tests and high-level flows - focused on content blocks
- **`TestModelProvider`**: For low-level event streaming tests where you need precise control over individual events

#### MockMessageModel - Content-Focused Testing

For tests focused on messages, you SHOULD use `MockMessageModel` with a content-focused API that eliminates boilerplate:

```typescript
import { MockMessageModel } from '../__fixtures__/mock-message-model'

// ✅ RECOMMENDED - Single content block (most common)
const provider = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })

// ✅ RECOMMENDED - Array of content blocks
const provider = new MockMessageModel().addTurn([
  { type: 'textBlock', text: 'Let me help' },
  { type: 'toolUseBlock', name: 'calc', toolUseId: 'id-1', input: {} },
])

// ✅ RECOMMENDED - Multi-turn with builder pattern
const provider = new MockMessageModel()
  .addTurn({ type: 'toolUseBlock', name: 'calc', toolUseId: 'id-1', input: {} }) // Auto-derives 'toolUse'
  .addTurn({ type: 'textBlock', text: 'The answer is 42' }) // Auto-derives 'endTurn'

// ✅ OPTIONAL - Explicit stopReason when needed
const provider = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Partial response' }, 'maxTokens')

// ✅ OPTIONAL - Error handling
const provider = new MockMessageModel()
  .addTurn({ type: 'textBlock', text: 'Success' })
  .addTurn(new Error('Model failed'))
```

## MCP (Model Context Protocol) Integration

The [Model Context Protocol (MCP)](https://modelcontextprotocol.io) enables agents to connect to external tools and data sources through a standardized protocol. The SDK provides `McpClient` for seamless integration with MCP servers.

**Implementation:**
- [`src/mcp.ts`](src/mcp.ts) - McpClient class
- [`src/tools/mcp-tool.ts`](src/tools/mcp-tool.ts) - McpTool wrapper
- [`examples/mcp/`](examples/mcp/) - Usage examples

**Basic Usage:**

```typescript
import { Agent, McpClient } from '@strands-agents/sdk'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// Connect to local MCP server
const localMcpClient = new McpClient({
  transport: new StdioClientTransport({
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp']
  })
})

const agent = new Agent({
  tools: [localMcpClient],
  model: new OpenAIModel()
})
```

**HTTP Transport for Remote Servers:**

```typescript
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const remoteMcpClient = new McpClient({
  transport: new StreamableHTTPClientTransport(
    new URL('https://api.example.com/mcp/'),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${token}` }
      }
    }
  )
})
```

**Multiple MCP Servers:**

```typescript
const agent = new Agent({
  tools: [localMcpClient, remoteMcpClient],
  model: new OpenAIModel()
})
```

**Key Features:**
- Automatic tool discovery and registration
- Lazy connection (connects on first use)
- Supports stdio and HTTP transports
- Resource cleanup with `Symbol.dispose`

**See [`examples/mcp/`](examples/mcp/) for complete working examples.**

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

## Multi-Environment Testing

The SDK is designed to work seamlessly in both Node.js and browser environments. Our test suite validates this by running tests in both environments using Vitest's browser mode with Playwright.

### Test Projects

The test suite is organized into three projects:

1. **unit-node** (green): Unit tests running in Node.js environment
2. **unit-browser** (cyan): Same unit tests running in Chromium browser
3. **integ** (magenta): Integration tests running in Node.js

### Environment-Specific Test Patterns

- You MUST write tests that are environment-agnostic unless they depend on Node.js features like filesystem or env-vars

Some tests require Node.js-specific features (like process.env, AWS SDK) and should be skipped in browser environments:

```typescript
import { describe, it, expect } from 'vitest'
import { isNode } from '../__fixtures__/environment'

// Tests will run in Node.js, skip in browser
describe.skipIf(!isNode)("Node.js specific features", () => {
  it("uses environment variables", () => {
    // This test accesses process.env
    expect(process.env.NODE_ENV).toBeDefined()
  })
})
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
- **README.md**: Public-facing documentation, links to strandsagents.com
- **package.json**: Defines all npm scripts referenced in documentation

## Additional Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Vitest Documentation](https://vitest.dev/)
- [TSDoc Reference](https://tsdoc.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Strands Agents Documentation](https://strandsagents.com/)
