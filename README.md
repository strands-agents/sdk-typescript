<div align="center">
  <div>
    <a href="https://strandsagents.com">
      <img src="https://strandsagents.com/latest/assets/logo-github.svg" alt="Strands Agents" width="55px" height="105px">
    </a>
  </div>

  <h1>
    Strands Agents - TypeScript SDK
  </h1>

  <h2>
    A model-driven approach to building AI agents in TypeScript/JavaScript.
  </h2>

  <div align="center">
    <a href="https://github.com/strands-agents/sdk-typescript/graphs/commit-activity"><img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/strands-agents/sdk-typescript"/></a>
    <a href="https://github.com/strands-agents/sdk-typescript/issues"><img alt="GitHub open issues" src="https://img.shields.io/github/issues/strands-agents/sdk-typescript"/></a>
    <a href="https://github.com/strands-agents/sdk-typescript/pulls"><img alt="GitHub open pull requests" src="https://img.shields.io/github/issues-pr/strands-agents/sdk-typescript"/></a>
    <a href="https://github.com/strands-agents/sdk-typescript/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/strands-agents/sdk-typescript"/></a>
  </div>
  
  <p>
    <a href="https://strandsagents.com/">Documentation</a>
    ◆ <a href="https://github.com/strands-agents/samples">Samples</a>
    ◆ <a href="https://github.com/strands-agents/sdk-python">Python SDK</a>
    ◆ <a href="https://github.com/strands-agents/tools">Tools</a>
    ◆ <a href="https://github.com/strands-agents/agent-builder">Agent Builder</a>
    ◆ <a href="https://github.com/strands-agents/mcp-server">MCP Server</a>
  </p>
</div>

Strands Agents is a simple yet powerful SDK that takes a model-driven approach to building and running AI agents. The TypeScript SDK brings key features from the Python Strands framework to TypeScript environments, enabling agent development for both Node.js servers and web browsers.

> **Note**: This SDK is currently under active development. Features are being added incrementally. Check the [project overview](.project/project-overview.md) for the roadmap.

## Feature Overview (Planned)

- **Lightweight & Flexible**: Simple agent loop that works seamlessly in Node.js and browsers
- **Model Agnostic**: Support for Amazon Bedrock, OpenAI, and custom model providers
- **Tool System**: Decorator-based tool definition with automatic registry management

## Quick Start (Coming Soon)

Once the SDK is complete, usage will look something like this:

```typescript
import { Agent } from '@strands-agents/sdk'
import { calculator } from '@strands-agents/tools'

const agent = new Agent({ tools: [calculator] })
const response = await agent.invoke('What is the square root of 1764?')
console.log(response)
```

## Installation (Coming Soon)

Once published to npm:

```bash
npm install @strands-agents/sdk
```

For browser usage:

```typescript
import { Agent } from '@strands-agents/sdk'
// Your agent code here
```

For Node.js usage:

```typescript
import { Agent } from '@strands-agents/sdk'
// Your agent code here
```

## Development Status

This TypeScript SDK is being developed with the following features (see [project overview](.project/project-overview.md) for details):

- ✅ **Project Structure**: TypeScript configuration, testing framework, development infrastructure
- 🚧 **Model Providers**: Amazon Bedrock, OpenAI, and custom provider support
- ✅ **Tool System**: Tool execution, registry, and decorator-based definitions
- 🚧 **Agent Interface**: Core agent class with `invoke` and `stream` methods
- 🚧 **Event Loop**: Async iterator-based agent loop for orchestration
- 🚧 **Conversation Manager**: Context window overflow handling
- 🚧 **Hooks System**: Lifecycle event extensibility
- 🚧 **Telemetry**: OpenTelemetry-based observability
- 🚧 **Metrics**: Usage tracking and reporting

## Tool System

The SDK includes a flexible tool system for managing and executing tools that agents can use to interact with their environment.

### ToolRegistry

The `ToolRegistry` class provides CRUDL (Create, Read, Update, Delete, List) operations for managing tool instances:

```typescript
import { ToolRegistry, FunctionTool } from '@strands-agents/sdk'

// Create a registry
const registry = new ToolRegistry()

// Create some tools
const calculator = new FunctionTool({
  name: 'calculator',
  description: 'Performs basic arithmetic operations',
  inputSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string' },
      a: { type: 'number' },
      b: { type: 'number' }
    },
    required: ['operation', 'a', 'b']
  },
  callback: (input: unknown) => {
    const { operation, a, b } = input as any
    switch (operation) {
      case 'add': return a + b
      case 'subtract': return a - b
      case 'multiply': return a * b
      case 'divide': return a / b
      default: throw new Error(`Unknown operation: ${operation}`)
    }
  }
})

// Register tools (single or multiple)
registry.register(calculator)
registry.register([tool1, tool2, tool3])

// Retrieve a tool
const tool = registry.get('calculator')

// Update a tool
registry.update('calculator', updatedCalculator)

// List all tools
const allTools = registry.list()

// Remove a tool
registry.remove('calculator')
```

### FunctionTool

The `FunctionTool` class wraps callback functions and handles all ToolResult conversion automatically:

```typescript
import { FunctionTool } from '@strands-agents/sdk'

// Synchronous tool
const greeter = new FunctionTool({
  name: 'greeter',
  description: 'Greets a person by name',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' }
    },
    required: ['name']
  },
  callback: (input: unknown) => {
    const { name } = input as any
    return `Hello, ${name}!`
  }
})

// Async tool with streaming
const processor = new FunctionTool({
  name: 'processor',
  description: 'Processes data with progress updates',
  inputSchema: {
    type: 'object',
    properties: {
      data: { type: 'string' }
    },
    required: ['data']
  },
  callback: async function* (input: unknown) {
    const { data } = input as any
    yield 'Starting processing...'
    // Do some work
    yield 'Halfway done...'
    // More work
    return `Processed: ${data.toUpperCase()}`
  }
})
```

## Documentation

For detailed guidance on the Strands Agents framework (Python-based examples):

- [User Guide](https://strandsagents.com/)
- [Quick Start Guide](https://strandsagents.com/latest/user-guide/quickstart/)
- [Model Providers](https://strandsagents.com/latest/user-guide/concepts/model-providers/amazon-bedrock/)
- [Tools](https://strandsagents.com/latest/user-guide/concepts/tools/tools_overview/)
- [Agent Loop](https://strandsagents.com/latest/user-guide/concepts/agents/agent-loop/)
- [API Reference](https://strandsagents.com/latest/api-reference/agent/)

TypeScript-specific documentation will be added as the SDK develops.

## Contributing ❤️

We welcome contributions! See our [Contributing Guide](CONTRIBUTING.md) for details on:
- Development setup and environment
- Testing and code quality standards
- Pull request process
- Code of Conduct
- Security issue reporting

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information on reporting security issues.


