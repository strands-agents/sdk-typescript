# Vended Tools

This directory contains optional tools that are provided as part of the Strands SDK but are not required dependencies of the core SDK.

## What are Vended Tools?

Vended tools are pre-built, production-ready tools that developers can optionally use with their agents.

## Available Tools

### Bash

A robust tool for executing bash shell commands in Node.js environments with persistent session support.

**Location**: `vended_tools/bash/`

**Key Features**:

- Persistent bash sessions with state management
- Separate stdout and stderr capture
- Configurable command timeouts (default: 120 seconds)
- Session restart capability
- Isolated sessions per agent instance
- Node.js only (requires `child_process` module)

**Security Warning**: Executes arbitrary commands without sandboxing. Only use with trusted input and consider sandboxing for production.

**Usage**:

```typescript
import { bash } from '@strands-agents/sdk/vended_tools/bash'
import { Agent, BedrockModel } from '@strands-agents/sdk'

const agent = new Agent({
  model: new BedrockModel({
    region: 'us-east-1',
  }),
  tools: [bash],
})

// Execute commands
await agent.invoke('List all TypeScript files in the current directory')
```

See [bash/README.md](./bash/README.md) for complete documentation.

### Notebook

A comprehensive tool for managing text notebooks within agent invocations. Supports creating, reading, writing, listing, and clearing notebooks with full state persistence.

**Location**: `vended_tools/notebook/`

**Key Features**:

- Multiple named notebooks
- String replacement and line insertion
- Line range reading with negative index support
- State persistence across agent invocations
- Universal browser and server support

**Usage**:

```typescript
import { notebook } from '@strands-agents/sdk/vended_tools/notebook'
import { ToolRegistry } from '@strands-agents/sdk'

const agent = new Agent({
  model: new BedrockModel({
    region: 'us-east-1',
  }),
  tools: [notebook],
})

// Create a task list
await agent.invoke('Create a notebook called "tasks" with 1 "Write code" task')
```

See [notebook/README.md](./notebook/README.md) for complete documentation.

### File Editor

A filesystem editor tool for viewing, creating, and editing files programmatically. Supports string replacement and line insertion.

**Location**: `vended_tools/file_editor/`

**Key Features**:

- View files with line numbers and line range support
- Create new files with content
- String-based find and replace
- Line-based text insertion
- Directory viewing
- Path security validation
- Configurable file size limits

**Usage**:

```typescript
import { fileEditor } from '@strands-agents/sdk/vended_tools/file_editor'

const agent = new Agent({
  model: new BedrockModel({ region: 'us-east-1' }),
  tools: [fileEditor],
})

await agent.invoke('Create a new file called /tmp/test.txt with "Hello World"')
await agent.invoke('Replace "Hello" with "Hi" in /tmp/test.txt')
```

See [file_editor/README.md](./file_editor/README.md) for complete documentation.

## Contributing

When adding new vended tools:

1. Create a new directory under `vended_tools/`
2. Include implementation, types, and tests
3. Add a README.md in the tool's directory
4. Update this README to list the new tool
5. Ensure 80%+ test coverage
6. Follow the existing patterns from other vended tools

## Directory Structure

```
vended_tools/
├── README.md                    # This file
├── bash/                        # Bash command execution tool
│   ├── __tests__/
│   │   └── bash.test.ts         # Unit tests
│   ├── bash.ts                  # Implementation
│   ├── types.ts                 # Type definitions
│   ├── index.ts                 # Public exports
│   └── README.md                # Documentation
├── notebook/                    # Text notebook management tool
│   ├── __tests__/
│   │   └── notebook.test.ts     # Unit tests
│   ├── notebook.ts              # Implementation
│   ├── types.ts                 # Type definitions
│   ├── index.ts                 # Public exports
│   └── README.md                # Documentation
└── you-new-tool/                # Your new tool
    ├── __tests__/
    │   └── you-new-tool.test.ts # Unit tests
    ├── you-new-tool.ts          # Implementation
    ├── types.ts                 # Type definitions
    ├── index.ts                 # Public exports
    └── README.md                # Documentation
```
