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
│   ├── __tests__/                # Unit tests (co-located with source)
│   │   ├── hello.test.ts         # Tests for hello.ts
│   │   └── index.test.ts         # Tests for main entry point
│   ├── index.ts                  # Main SDK entry point (single export point)
│   └── hello.ts                  # Example: Hello world function
│
├── tests_integ/                  # Integration tests (separate from source)
│   └── environment.test.ts       # Environment compatibility tests
│
├── .github/                      # GitHub Actions workflows
│   ├── workflows/                # CI/CD workflows
│   │   ├── pr-and-push.yml       # Triggers test/lint on PR and push
│   │   ├── test-lint.yml         # Unit tests and linting
│   │   └── integration-test.yml  # Secure integration tests with AWS
│   └── agent-scripts/            # Agent system prompts and configs
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
├── vitest.config.ts              # Testing configuration
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
- **`src/__tests__/`**: Unit tests for specific source files (tests internal functionality)
- **`tests_integ/`**: Integration tests (tests public API and external integrations)
- **`.github/workflows/`**: CI/CD automation and quality gates
- **`.project/`**: Task management and project tracking

## Development Workflow for Agents

### 1. Environment Setup

See [CONTRIBUTING.md - Development Environment](CONTRIBUTING.md#development-environment) for:
- Prerequisites (Node.js 20+, npm)
- Installation steps
- Verification commands

### 2. Making Changes

1. **Create feature branch**: `git checkout -b agent-tasks/{TASK_NUMBER}`
2. **Implement changes** following the patterns below
3. **Run quality checks** before committing (pre-commit hooks will run automatically)
4. **Commit with conventional commits**: `feat:`, `fix:`, `refactor:`, `docs:`, etc.
5. **Push to remote**: `git push origin agent-tasks/{TASK_NUMBER}`

### 3. Quality Gates

Pre-commit hooks automatically run:
- Unit tests (via npm test)
- Linting (via npm run lint)
- Format checking (via npm run format:check)
- Type checking (via npm run type-check)

All checks must pass before commit is allowed.

## Coding Patterns and Best Practices

### TypeScript Path Aliases

Use path aliases for cleaner imports:

```typescript
// Good: Use path alias
import { hello } from '@/hello'
import { Agent } from '@/agent'

// Avoid: Relative paths
import { hello } from '../hello'
import { Agent } from '../../agent'
```

**Configuration**: Path aliases are configured in `tsconfig.json` and `vitest.config.ts`:
- `@/*` maps to `src/*`

### File Organization Pattern

**For source files**:
```
src/
├── module.ts              # Source file
└── __tests__/
    └── module.test.ts     # Unit tests co-located
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
import { functionName } from '@/module'

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
import { ClassName } from '@/module'

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

**Requirements**:
- All exported functions, classes, and interfaces must have TSDoc
- Include `@param` for all parameters
- Include `@returns` for return values
- Include `@example` for complex functionality
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

// 2. Internal modules (using path aliases)
import { Agent } from '@/agent'
import { Tool } from '@/tools'

// 3. Types (if separate)
import type { Options, Config } from '@/types'
```

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

## Things to Do

✅ **Do**:
- Use path aliases (`@/`) for all imports
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
- Use relative paths like `../` when path aliases are available
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
npm test              # Run unit tests
npm run test:integ    # Run integration tests  
npm run test:coverage # Run tests with coverage report
npm run lint          # Check code quality
npm run format        # Auto-fix formatting
npm run type-check    # Verify TypeScript types
npm run build         # Compile TypeScript
```

## Troubleshooting Common Issues

### Path Alias Not Resolving

If `@/` imports don't work:
1. Verify `tsconfig.json` has `baseUrl` and `paths` configured
2. Verify `vitest.config.ts` has alias configuration
3. Restart your IDE/editor

### Tests Not Found

If tests aren't discovered:
1. Ensure unit tests are in `src/__tests__/*.test.ts`
2. Ensure integration tests are in `tests_integ/*.test.ts`
3. Check `vitest.config.ts` configuration

### Pre-commit Hooks Failing

If hooks fail:
1. Run the failing command manually to see details
2. Fix the issues (tests, linting, formatting, or type errors)
3. Try committing again

### Type Errors

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
