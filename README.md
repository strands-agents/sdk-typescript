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
    <a href="https://www.npmjs.com/package/@strands-agents/sdk"><img alt="NPM Version" src="https://img.shields.io/npm/v/@strands-agents/sdk"/></a>
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

---

## Overview

Strands Agents is a simple yet powerful SDK that takes a model-driven approach to building and running AI agents. The TypeScript SDK brings key features from the Python Strands framework to Node.js environments, enabling type-safe agent development for everything from simple assistants to complex workflows.

### Key Features

- **🪶 Lightweight & Flexible**: Simple agent loop that works seamlessly in Node.js and browser environments
- **🔒 Type-Safe Tools**: Define tools easily using Zod schemas for robust input validation and type inference
- **🔌 Model Agnostic**: First-class support for Amazon Bedrock and OpenAI, with extensible architecture for custom providers
- **🔗 Built-in MCP**: Native support for Model Context Protocol (MCP) clients, enabling access to external tools and servers
- **⚡ Streaming Support**: Real-time response streaming for better user experience
- **🎣 Extensible Hooks**: Lifecycle hooks for monitoring and customizing agent behavior
- **💬 Conversation Management**: Flexible strategies for managing conversation history and context windows

---

## Quick Start

### Installation

Ensure you have **[Node.js 20+](https://nodejs.org/)** installed, then:

```bash
npm install @strands-agents/sdk
```

### Basic Usage

```typescript
import { Agent } from '@strands-agents/sdk'

// Create agent (uses default Amazon Bedrock provider)
const agent = new Agent()

// Invoke
const result = await agent.invoke('What is the square root of 1764?')
console.log(result)
```

> **Note**: For the default Amazon Bedrock model provider, you'll need AWS credentials configured and model access enabled for Claude 4.5 Sonnet in your region.

---

## Core Concepts

### Agents

The `Agent` class is the central orchestrator that manages the interaction loop between users, models, and tools.

```typescript
import { Agent } from '@strands-agents/sdk'

const agent = new Agent({
  systemPrompt: 'You are a helpful assistant.',
})
```
### Model Providers

Switch between model providers easily:

**Amazon Bedrock (Default)**

```typescript
import { Agent, BedrockModel } from '@strands-agents/sdk'

const model = new BedrockModel({
  region: 'us-east-1',
  modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
  maxTokens: 4096,
  temperature: 0.7
})

const agent = new Agent({ model })
```

**OpenAI**

```typescript
import { Agent } from '@strands-agents/sdk'
import { OpenAIModel } from '@strands-agents/sdk/openai'

// Automatically uses process.env.OPENAI_API_KEY and defaults to gpt-4o
const model = new OpenAIModel()

const agent = new Agent({ model })
```

### Streaming Responses

Access responses as they are generated:

```typescript
const agent = new Agent()

console.log('Agent response stream:')
for await (const event of agent.stream('Tell me a story about a brave toaster.')) {
  console.log('[Event]', event.type)
}
```

### Tools

Tools enable agents to interact with external systems and perform actions. Create type-safe tools using Zod schemas:

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import { z } from 'zod'

const weatherTool = tool({
  name: 'get_weather',
  description: 'Get the current weather for a specific location.',
  inputSchema: z.object({
    location: z.string().describe('The city and state, e.g., San Francisco, CA'),
  }),
  callback: (input) => {
    // input is fully typed based on the Zod schema
    return `The weather in ${input.location} is 72°F and sunny.`
  },
})

const agent = new Agent({
  tools: [weatherTool],
})

await agent.invoke('What is the weather in San Francisco?')
```

**Vended Tools**: The SDK includes optional pre-built tools:
- **Notebook Tool**: Manage text-based notebooks for persistent note-taking
- **File Editor Tool**: Perform file system operations (read, write, edit files)
- **HTTP Request Tool**: Make HTTP requests to external APIs


### MCP Integration

Seamlessly integrate Model Context Protocol (MCP) servers:

```typescript
import { Agent, McpClient } from "@strands-agents/sdk";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Create a client for a local MCP server
const documentationTools = new McpClient({
  transport: new StdioClientTransport({
    command: "uvx",
    args: ["awslabs.aws-documentation-mcp-server@latest"],
  }),
});

const agent = new Agent({
  systemPrompt: "You are a helpful assistant using MCP tools.",
  tools: [documentationTools], // Pass the MCP client directly as a tool source
});

await agent.invoke("Use a random tool from the MCP server.");

await documentationTools.disconnect();
```

---

## Documentation

For detailed guidance, tutorials, and concept overviews, please visit:

- **[Official Documentation](https://strandsagents.com/)**: Comprehensive guides and tutorials
- **[API Reference](.sop/summary/interfaces.md)**: Complete API documentation
- **[Examples](./examples/)**: Sample applications
- **[Contributing Guide](CONTRIBUTING.md)**: Development setup and guidelines

---

## Contributing ❤️

We welcome contributions! See our [Contributing Guide](CONTRIBUTING.md) for details on:

- Development setup and environment
- Testing and code quality standards
- Pull request process
- Code of Conduct
- Security issue reporting

---

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

---

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information on reporting security issues.

---

## ⚠️ Preview Status

Strands Agents is currently in public preview. During this period:
- APIs may change as we refine the SDK
- We welcome feedback and contributions
