# Development Guide - Strands TypeScript SDK

This document provides comprehensive information for developers working on the Strands TypeScript SDK.

## Directory Structure

```
sdk-typescript/
├── src/                          # Source code
│   ├── index.ts                  # Main SDK entry point
│   └── hello.ts                  # Hello world function (example)
├── tests/                        # Unit tests
│   ├── hello.test.ts             # Tests for hello function
│   └── index.test.ts             # Tests for main entry point
├── tests_integ/                  # Integration tests
│   ├── setup.test.ts             # Project setup validation
│   └── environment.test.ts       # Environment compatibility tests
├── dist/                         # Compiled output (generated)
├── coverage/                     # Test coverage reports (generated)
├── node_modules/                 # Dependencies (generated)
├── package.json                  # Project configuration
├── tsconfig.json                 # TypeScript configuration
├── vitest.config.ts              # Test configuration
├── eslint.config.js              # Linting configuration
├── .prettierrc                   # Code formatting configuration
├── .gitignore                    # Git ignore rules
├── AGENTS.md                     # This file
├── CONTRIBUTING.md               # Contribution guidelines
└── README.md                     # Project documentation
```

## Development Environment Setup

### Prerequisites

- **Node.js**: Version 20.0.0 or higher
- **npm**: Version 9.0.0 or higher (comes with Node.js)

### Initial Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/strands-agents/sdk-typescript.git
   cd sdk-typescript
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Verify setup**:
   ```bash
   npm test
   npm run lint
   npm run format:check
   npm run type-check
   npm run prepare  # Set up git pre-commit hooks
   ```

### Development Workflow

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes following TDD approach**:
   - Write failing tests first
   - Implement minimal code to pass tests
   - Refactor while keeping tests green

3. **Run quality checks**:
   ```bash
   npm test              # Run all tests
   npm run test:coverage # Run tests with coverage
   npm run lint          # Check code quality
   npm run format        # Fix formatting issues
   npm run type-check    # Verify TypeScript types
   ```

## Testing Instructions

### Running Tests

```bash
# Run all tests (unit + integration)
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run only integration tests
npm run test:integ
```

### Test Structure

- **Unit Tests** (`tests/`): Test individual functions and modules
- **Integration Tests** (`tests_integ/`): Test complete workflows and environment compatibility

### Test Requirements

- **Coverage**: 80%+ line, function, branch, and statement coverage required
- **Framework**: Vitest for fast, modern testing
- **Assertions**: Use Vitest's built-in `expect` assertions
- **Async Testing**: Use `async/await` for asynchronous tests

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest'
import { functionToTest } from '../src/module'

describe('functionToTest', () => {
  it('should handle basic case', () => {
    const result = functionToTest('input')
    expect(result).toBe('expected output')
  })

  it('should handle edge case', () => {
    const result = functionToTest('')
    expect(result).toBe('default output')
  })
})
```

## Code Quality Standards

### TypeScript Configuration

- **Strict Mode**: All strict TypeScript checks enabled
- **No Any Types**: `any` type is forbidden (`@typescript-eslint/no-explicit-any`)
- **Explicit Return Types**: All functions must have explicit return types
- **Node.js 20+ Support**: Minimum supported Node.js version
- **Browser Compatibility**: Chrome 90+, Firefox 88+, Safari 14+

### Documentation Requirements

- **TSDoc**: 100% documentation coverage required
- **Function Documentation**: All exported functions must have TSDoc comments
- **Parameter Documentation**: Document all parameters with types and descriptions
- **Example Usage**: Include `@example` blocks for complex functions

### Code Style

- **Prettier**: Enforced code formatting
  - No semicolons
  - Single quotes
  - Line length: 120 characters
  - Tab width: 2 spaces
- **ESLint**: Enforced code quality rules
  - TypeScript best practices
  - No unused variables
  - TSDoc syntax validation

### Example Code Style

```typescript
/**
 * Performs a specific operation with the given parameters.
 * 
 * @param input - The input value to process
 * @param options - Configuration options for the operation
 * @returns The processed result
 * 
 * @example
 * ```typescript
 * const result = performOperation('hello', { uppercase: true })
 * console.log(result) // "HELLO"
 * ```
 */
export function performOperation(input: string, options: OperationOptions): string {
  // Implementation here
  return processedInput
}
```

## Build and Development Scripts

```bash
# Build the project
npm run build

# Development
npm run test:watch        # Watch mode for tests
npm run lint:fix          # Auto-fix linting issues
npm run format            # Auto-format code

# Quality Checks
npm run test              # Run all tests
npm run test:coverage     # Test coverage report
npm run lint              # Check code quality
npm run format:check      # Verify formatting
npm run type-check        # TypeScript type checking
```

## Pull Request Guidelines

### Before Creating a PR

1. **All tests pass**: `npm test` returns success
2. **Code quality**: `npm run lint` passes without errors  
3. **Formatting**: `npm run format:check` passes
4. **Type checking**: `npm run type-check` passes
5. **Coverage**: 80%+ test coverage maintained
6. **Pre-commit hooks**: Installed and passing (`npm run prepare`)

### PR Requirements

- **Descriptive title**: Use format "feat: add new feature" or "fix: resolve issue"
- **Clear description**: Explain what changes were made and why
- **Test coverage**: All new code must have tests
- **Documentation**: Update relevant documentation files
- **No breaking changes**: Unless explicitly discussed and approved

### Documentation Updates

When implementing features that impact the following files, ensure they are updated:

- **AGENTS.md**: Development environment or testing procedure changes
- **README.md**: Public API changes or usage examples  
- **CONTRIBUTING.md**: New development requirements or processes

## Architecture Guidelines

### Module Structure

- **Single Entry Point**: All exports go through `src/index.ts`
- **ES Modules**: Use ES6 import/export syntax
- **Type Safety**: Leverage TypeScript's type system fully
- **Browser Compatible**: Code should work in both Node.js and browser environments

### Dependencies

- **Minimal Runtime Dependencies**: Keep the SDK lightweight
- **Development Dependencies**: Use modern tooling for developer experience
- **Peer Dependencies**: Consider making large dependencies peer dependencies

## Environment Compatibility

### Node.js Environment

- **Minimum Version**: Node.js 20.0.0
- **ES Features**: ES2022 features are supported
- **Async/Await**: Full support for modern async patterns

### Browser Environment

- **Target Browsers**: Chrome 90+, Firefox 88+, Safari 14+
- **ES Modules**: Native ES module support expected
- **No Polyfills**: Consumers handle their own polyfills if needed

## Troubleshooting

### Common Issues

1. **Test Failures**: 
   - Ensure all dependencies are installed: `npm install`
   - Check if tests were written before implementation (TDD)

2. **Linting Errors**:
   - Fix formatting: `npm run format`
   - Check TSDoc syntax for functions

3. **Type Errors**:
   - Ensure all functions have explicit return types
   - Avoid using `any` type anywhere in the codebase

4. **Coverage Issues**:
   - Write tests for all code paths
   - Check coverage report: `npm run test:coverage`

### Getting Help

- Check existing issues in the GitHub repository
- Review the CONTRIBUTING.md guidelines
- Ensure you're following the development workflow outlined in this document