# Contributing Guidelines

Thank you for your interest in contributing to the Strands TypeScript SDK! Whether it's a bug report, new feature, correction, or additional documentation, we greatly value feedback and contributions from our community.

Please read through this document before submitting any issues or pull requests.

> **Note**: For AI agent-specific development patterns and guidelines, see [AGENTS.md](AGENTS.md).

## Development Tenets
Our team follows these core principles when designing and implementing features. These tenets help us make consistent decisions, resolve trade-offs, and maintain the quality and coherence of the SDK. When contributing, please consider how your changes align with these principles:

1. **Simple at any scale:** We believe that simple things should be simple. The same clean abstractions that power a weekend prototype should scale effortlessly to production workloads. We reject the notion that enterprise-grade means enterprise-complicated - Strands remains approachable whether it's your first agent or your millionth.
2. **Extensible by design:** We allow for as much configuration as possible, from hooks to model providers, session managers, tools, etc. We meet customers where they are with flexible extension points that are simple to integrate with.
3. **Composability:** Primitives are building blocks with each other. Each feature of Strands is developed with all other features in mind, they are consistent and complement one another.
4. **The obvious path is the happy path:** Through intuitive naming, helpful error messages, and thoughtful API design, we guide developers toward correct patterns and away from common pitfalls.
5. **We are accessible to humans and agents:** Strands is designed for both humans and AI to understand equally well. We don’t take shortcuts on curated DX for humans and we go the extra mile to make sure coding assistants can help you use those interfaces the right way.
6. **Embrace common standards:** We respect what came before, and do not want to reinvent something that is already widely adopted or done better.

When proposing solutions or reviewing code, we reference these principles to guide our decisions. If two approaches seem equally valid, we choose the one that best aligns with our tenets.

## Development Environment

### Prerequisites

- **Node.js**: Version 20.0.0 or higher
- **npm**: Version 9.0.0 or higher

### Setup

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/strands-agents/sdk-typescript.git
   cd sdk-typescript
   npm install
   ```

2. Install Playwright browsers for browser testing:
   ```bash
   npm run test:browser:install
   ```

3. Verify your setup by running the test suite:
   ```bash
   npm test
   npm run lint
   npm run format:check
   npm run type-check
   ```

4. Install git hooks for automatic quality checks:
   ```bash
   npm run prepare
   ```

This will set up pre-commit hooks that automatically run tests, linting, formatting checks, and type checking before each commit.

## Testing Instructions and Best Practices

### Running Tests

```bash
# Run unit tests only (Node.js environment)
npm test

# Run unit tests for a single file
npm test -- src/models/__tests__/openai.test.ts

# Run tests with coverage (required: 80%+)
npm run test:coverage

# Run tests in watch mode during development
npm run test:watch

# Run only integration tests
npm run test:integ

# Run integ tests for a single file
npm run test:integ -- tests_integ/openai.test.ts

# Run browser tests (Chromium)
npm run test:browser

# Run tests in all environments (Node.js + Browser)
npm run test:all

# Run tests in all environments with coverage
npm run test:all:coverage
```

### Browser Testing

The SDK includes browser environment testing using Vitest's browser mode with Playwright/Chromium to ensure cross-platform compatibility.

**Running Browser Tests:**

```bash
# Run all tests in browser environment
npm run test:browser

# Run all tests in both Node.js and browser environments
npm run test:all

# Run all tests with coverage
npm run test:all:coverage
```

For detailed browser testing patterns, see [AGENTS.md - Multi-Environment Testing](AGENTS.md#multi-environment-testing).

### Test Requirements

- **80%+ Coverage**: All code should have at least 80% test coverage
- **Unit Tests**: Test individual functions in `src/**/__tests__/**` directories
- **Integration Tests**: Test complete workflows in `tests_integ/` directory
- **TSDoc Coverage**: All exported functions must have complete documentation

For detailed testing patterns and examples, see [AGENTS.md - Testing Patterns](AGENTS.md#testing-patterns).

### Documentation Updates

**Important**: When implementing changes that impact the following files, you must update them:

- **AGENTS.md**: Agent-specific development guidance (directory structure, coding patterns, testing patterns, things to do/not do)
- **README.md**: Project overview, getting started guide, usage examples, public API documentation
- **CONTRIBUTING.md**: Human contribution guidelines (development requirements, testing procedures, PR process)

## Reporting Bugs/Feature Requests

We welcome you to use the GitHub issue tracker to report bugs or suggest features.

When filing an issue, please check existing open, or recently closed, issues to make sure somebody else hasn't already reported the issue. Please try to include as much information as you can. Details like these are incredibly useful:

* A reproducible test case or series of steps
* The version of our code being used
* Any modifications you've made relevant to the bug
* Anything unusual about your environment or deployment

## Contributing via Pull Requests

Contributions via pull requests are much appreciated. Before sending us a pull request, please ensure that:

1. You are working against the latest source on the *main* branch.
2. You check existing open, and recently merged, pull requests to make sure someone else hasn't addressed the problem already.
3. You open an issue to discuss any significant work - we would hate for your time to be wasted.

To send us a pull request, please:

1. Fork the repository.
2. Create a feature branch from `main`.
3. Make your changes, ensuring code quality and test coverage.
4. Quality checks will run automatically on commit via pre-commit hooks. You can also run them manually:
   ```bash
   npm test              # 80%+ test coverage required
   npm run lint          # No linting errors allowed
   npm run format:check  # Code must be properly formatted
   npm run type-check    # TypeScript must compile without errors
   ```
5. Update relevant documentation files (see Documentation Updates section above).
6. Commit to your fork using clear, conventional commit messages.
7. Send us a pull request, answering any default questions in the pull request interface.
8. Pay attention to any automated CI failures reported in the pull request, and stay involved in the conversation.

### Pull Request Requirements

- **All tests pass**: 80%+ test coverage maintained
- **Code quality**: ESLint passes with no errors
- **Documentation**: TSDoc comments for all exported functions
- **Formatting**: Prettier formatting applied consistently
- **Type safety**: No `any` types allowed, explicit return types required
- **Conventional commits**: Use conventional commit message format

GitHub provides additional documentation on [forking a repository](https://help.github.com/articles/fork-a-repo/) and
[creating a pull request](https://help.github.com/articles/creating-a-pull-request/).

## Finding contributions to work on

Looking at the existing issues is a great way to find something to contribute on. As our projects, by default, use the default GitHub issue labels (enhancement/bug/duplicate/help wanted/invalid/question/wontfix), looking at any 'help wanted' issues is a great place to start.

## Code of Conduct

This project has adopted the [Amazon Open Source Code of Conduct](https://aws.github.io/code-of-conduct).
For more information see the [Code of Conduct FAQ](https://aws.github.io/code-of-conduct-faq) or contact
opensource-codeofconduct@amazon.com with any additional questions or comments.

## Security issue notifications

If you discover a potential security issue in this project we ask that you notify AWS/Amazon Security via our [vulnerability reporting page](http://aws.amazon.com/security/vulnerability-reporting/). Please do **not** create a public github issue.

## Licensing

See the [LICENSE](LICENSE) file for our project's licensing. We will ask you to confirm the licensing of your contribution.

