# Testing Guidelines - Strands TypeScript SDK

> **IMPORTANT**: When writing tests, you **MUST** follow the guidelines in this document. These patterns ensure consistency, maintainability, and proper test coverage across the SDK.

This document contains comprehensive testing guidelines for the Strands TypeScript SDK. For general development guidance, see [AGENTS.md](../AGENTS.md).

## Test Fixtures Quick Reference

All test fixtures are located in `src/__fixtures__/`. Use these helpers to reduce boilerplate and ensure consistency.

| Fixture                | File                    | When to Use                                                                          | Details                                                                     |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `MockMessageModel`     | `mock-message-model.ts` | Agent loop tests - specify content blocks, auto-generates stream events              | [Model Fixtures](#model-fixtures-mock-message-modelts-model-test-helpersts) |
| `TestModelProvider`    | `model-test-helpers.ts` | Low-level model tests - precise control over individual `ModelStreamEvent` sequences | [Model Fixtures](#model-fixtures-mock-message-modelts-model-test-helpersts) |
| `collectIterator()`    | `model-test-helpers.ts` | Collect all items from any async iterable into an array                              | [Model Fixtures](#model-fixtures-mock-message-modelts-model-test-helpersts) |
| `collectGenerator()`   | `model-test-helpers.ts` | Collect yielded items AND final return value from async generators                   | [Model Fixtures](#model-fixtures-mock-message-modelts-model-test-helpersts) |
| `MockHookProvider`     | `mock-hook-provider.ts` | Record and verify hook invocations during agent execution                            | [Hook Fixtures](#hook-fixtures-mock-hook-providerts)                        |
| `createMockTool()`     | `tool-helpers.ts`       | Create mock tools with custom result behavior                                        | [Tool Fixtures](#tool-fixtures-tool-helpersts)                              |
| `createRandomTool()`   | `tool-helpers.ts`       | Create minimal mock tools when execution doesn't matter                              | [Tool Fixtures](#tool-fixtures-tool-helpersts)                              |
| `createMockContext()`  | `tool-helpers.ts`       | Create mock `ToolContext` for testing tool implementations directly                  | [Tool Fixtures](#tool-fixtures-tool-helpersts)                              |
| `createMockAgent()`    | `agent-helpers.ts`      | Create minimal mock Agent with messages and state                                    | [Agent Fixtures](#agent-fixtures-agent-helpersts)                           |
| `isNode` / `isBrowser` | `environment.ts`        | Environment detection for conditional test execution                                 | [Environment Fixtures](#environment-fixtures-environmentts)                 |

## Test Organization

### Unit Test Location

**Rule**: Unit test files are co-located with source files, grouped in a directory named `__tests__`

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
- Integration tests: `{feature}.test.ts` in `test/integ/`

## Test Structure Pattern

Follow this nested describe pattern for consistency:

### For Functions

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

### For Classes

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

### Key Principles

- Top-level `describe` uses the function/class name
- Nested `describe` blocks group related test scenarios
- Use descriptive test names without "should" prefix
- Group tests by functionality or scenario

## Writing Effective Tests

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

## Test Batching Strategy

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
  const tool = createComplexTool({
    /* expensive setup */
  })
  expect(tool.toolName).toBe('testTool')
})

it('has correct description', () => {
  const tool = createComplexTool({
    /* same expensive setup */
  })
  expect(tool.description).toBe('Test description')
})
```

**Good - Batched properties**:

```typescript
it('creates tool with correct properties', () => {
  const tool = createComplexTool({
    /* setup once */
  })
  expect(tool.toolName).toBe('testTool')
  expect(tool.description).toBe('Test description')
  expect(tool.toolSpec.name).toBe('testTool')
})
```

## Object Assertion Best Practices

**Prefer testing entire objects at once** instead of individual properties for better readability and test coverage.

```typescript
// ✅ Good: Verify entire object at once
it('returns expected user object', () => {
  const user = getUser('123')
  expect(user).toEqual({
    id: '123',
    name: 'John Doe',
    email: 'john@example.com',
    isActive: true,
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

## What to Test

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

## Test Coverage

- **Minimum**: 80% coverage required (enforced by Vitest)
- **Target**: Aim for high coverage on critical paths
- **Exclusions**: Test files, config files, generated code

## Test Model Providers

**When to use each test provider:**

- **`MockMessageModel`**: For agent loop tests and high-level flows - focused on content blocks
- **`TestModelProvider`**: For low-level event streaming tests where you need precise control over individual events

### MockMessageModel - Content-Focused Testing

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

## Testing Hooks

When testing hook behavior, you **MUST** use `agent.hooks.addCallback()` for registering single callbacks when `agent.hooks` is available. Do NOT create inline `HookProvider` objects — this is an anti-pattern for single callbacks.

```typescript
// ✅ CORRECT - Use agent.hooks.addCallback() for single callbacks
const agent = new Agent({ model, tools: [tool] })

agent.hooks.addCallback(BeforeToolCallEvent, (event: BeforeToolCallEvent) => {
  event.toolUse = {
    ...event.toolUse,
    input: { value: 42 },
  }
})

// ✅ CORRECT - Use MockHookProvider to record and verify hook invocations
const hookProvider = new MockHookProvider()
const agent = new Agent({ model, hooks: [hookProvider] })
await agent.invoke('Hi')
expect(hookProvider.invocations).toContainEqual(new BeforeInvocationEvent({ agent }))

// ❌ WRONG - Do NOT create inline HookProvider objects
const switchToolHook = {
  registerCallbacks: (registry: HookRegistry) => {
    registry.addCallback(BeforeToolCallEvent, (event: BeforeToolCallEvent) => {
      if (event.toolUse.name === 'tool1') {
        event.tool = tool2
      }
    })
  },
}
```

**When to use each approach:**

- **`agent.hooks.addCallback()`** - For adding a single callback to verify hook behavior (e.g., modifying tool input, switching tools)
- **`MockHookProvider`** - For recording and verifying hook lifecycle behavior and that specific hook events fired during execution

## Test Fixtures Reference

All test fixtures are located in `src/__fixtures__/`. Use these helpers to reduce boilerplate and ensure consistency.

### Model Fixtures (`mock-message-model.ts`, `model-test-helpers.ts`)

- **`MockMessageModel`** - Content-focused model for agent loop tests. Use `addTurn()` with content blocks.
- **`TestModelProvider`** - Low-level model for precise control over `ModelStreamEvent` sequences.
- **`collectIterator(stream)`** - Collects all items from an async iterable into an array.
- **`collectGenerator(generator)`** - Collects yielded items and final return value from an async generator.

```typescript
// MockMessageModel for agent tests
const model = new MockMessageModel()
  .addTurn({ type: 'toolUseBlock', name: 'calc', toolUseId: 'id-1', input: {} })
  .addTurn({ type: 'textBlock', text: 'Done' })

// collectIterator for stream results
const events = await collectIterator(agent.stream('Hi'))
```

### Hook Fixtures (`mock-hook-provider.ts`)

- **`MockHookProvider`** - Records all hook invocations for verification. Pass to `Agent({ hooks: [provider] })`.
  - Use `{ includeModelEvents: false }` to exclude `ModelStreamEventHook` from recordings.
  - Access `provider.invocations` to verify hook events fired.

```typescript
// Record and verify hook invocations
const hookProvider = new MockHookProvider({ includeModelEvents: false })
const agent = new Agent({ model, hooks: [hookProvider] })

await agent.invoke('Hi')

expect(hookProvider.invocations[0]).toEqual(new BeforeInvocationEvent({ agent }))
```

### Tool Fixtures (`tool-helpers.ts`)

- **`createMockTool(name, resultFn)`** - Creates a mock tool with custom result behavior.
- **`createRandomTool(name?)`** - Creates a minimal mock tool (use when tool execution doesn't matter).
- **`createMockContext(toolUse, agentState?)`** - Creates a mock `ToolContext` for testing tool implementations directly.

```typescript
// Mock tool with custom result
const tool = createMockTool(
  'calculator',
  () => new ToolResultBlock({ toolUseId: 'id', status: 'success', content: [new TextBlock('42')] })
)

// Minimal tool when execution doesn't matter
const tool = createRandomTool('myTool')
```

**When to use fixtures vs `FunctionTool` directly:**

Use `createMockTool()` or `createRandomTool()` when tools are incidental to the test. Use `FunctionTool` or `tool()` directly only when testing tool-specific behavior.

```typescript
// ✅ Use fixtures when testing agent/hook behavior
const tool = createMockTool('testTool', () => ({
  type: 'toolResultBlock',
  toolUseId: 'tool-1',
  status: 'success' as const,
  content: [new TextBlock('Success')],
}))
const agent = new Agent({ model, tools: [tool] })

// ❌ Don't use FunctionTool when tool behavior is irrelevant to the test
const tool = new FunctionTool({ name: 'testTool', description: '...', inputSchema: {...}, callback: ... })
```

### Agent Fixtures (`agent-helpers.ts`)

- **`createMockAgent(data?)`** - Creates a minimal mock Agent with messages and state. Use for testing components that need an Agent reference without full agent behavior.

```typescript
const agent = createMockAgent({
  messages: [new Message({ role: 'user', content: [new TextBlock('Hi')] })],
  state: { key: 'value' },
})
```

### Environment Fixtures (`environment.ts`)

- **`isNode`** - Boolean that detects if running in Node.js environment.
- **`isBrowser`** - Boolean that detects if running in a browser environment.

Use these for conditional test execution when tests depend on environment-specific features.

```typescript
import { isNode } from '../__fixtures__/environment'

// Skip tests that require Node.js features in browser
describe.skipIf(!isNode)('Node.js specific features', () => {
  it('uses environment variables', () => {
    expect(process.env.NODE_ENV).toBeDefined()
  })
})
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
describe.skipIf(!isNode)('Node.js specific features', () => {
  it('uses environment variables', () => {
    // This test accesses process.env
    expect(process.env.NODE_ENV).toBeDefined()
  })
})
```

## Development Commands

```bash
npm test              # Run unit tests in Node.js
npm run test:browser  # Run unit tests in browser (Chromium via Playwright)
npm run test:all      # Run all tests in all environments
npm run test:integ    # Run integration tests
npm run test:coverage # Run tests with coverage report
```

For detailed command usage, see [CONTRIBUTING.md - Testing Instructions](../CONTRIBUTING.md#testing-instructions-and-best-practices).

## Checklist Items

- [ ] Do the tests use relevant helpers from `src/__fixtures__/` as noted in the "Test Fixtures Quick Reference" table above?
- [ ] Are recurring code or patterns extracted to functions for better usability/readability?
- [ ] Are tests focused on verifying one or two things only?
- [ ] Are tests written concisely enough that the bulk of each test is important to the test instead of boilerplate code?
- [ ] Are tests asserting on the entire object instead of specific fields?
