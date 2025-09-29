# Title: Set up project structure and core type system

## Description:
Set up a minimal TypeScript SDK project with a simple hello world implementation. Create basic project configuration and a simple function to establish the foundation.

## Work Required:
- Initialize package.json with TypeScript SDK basics
- Name the package: "@strands-agents/sdk"
- Create tsconfig.json with Node.js 20+ and browser compatibility (Chrome 90+, Firefox 88+, Safari 14+)
- Update the CONTRIBUITING.md file with testing instructions and best practices to follow when implementing features
  - Include instructions to update the AGENTS.md, README.md, and CONTRIBUITNG.md after making any changes that would impact their current content.
- Create src/ directory with simple hello world function
- Set up basic Vitest testing configuration with test coverage reporting
- Add docstring coverage checking to ensure code is well documented, and following the TSDoc standard
- Create index.ts that exports the hello world function
- Add unit tests for hello world function
- Add integration test that validates the complete project setup. These can be no-op tests for now
- Add prettier for formatting (no-semi-colons, line-length 120)
- Force typing with no any type
- Add ESLint for linting (configured with TS best practices)
- Add NPM tasks for common tasks (linting/tests/formatting)
- Create an AGENTS.md file containing relevant information like directory structure, dev environment setup, testing instructions, and pull request instructions.
- Create a github workflow that checks formatting, linting, and runs unit tests.
- Create another github workflow to run integration tests on a specific environment. You can use the action defined here as an example of how to restrict how this integ test workflow is run: https://github.com/strands-agents/sdk-python/blob/main/.github/workflows/integration-test.yml

## Exit Criteria:
A working TypeScript project that exports a hello world function with passing unit and integration tests, test coverage reporting, and docstring coverage validation. Project is configured for both Node.js and browser environments.

## Dependencies:
- None (first task)
