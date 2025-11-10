# Vended Tools

This directory contains optional tools that are provided as part of the Strands SDK but are not required dependencies of the core SDK.

## What are Vended Tools?

Vended tools are pre-built, production-ready tools that developers can optionally use with their agents.

## Available Tools

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

A filesystem editor tool for viewing, creating, and editing files programmatically. Supports string replacement, line insertion, and undo functionality.

**Location**: `vended_tools/file_editor/`

**Key Features**:

- View files with line numbers and line range support
- Create new files with content
- String-based find and replace
- Line-based text insertion
- Undo edit history
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
└── you-new-tool/                # tool
    ├── __tests__/
    │   └── you-new-tool.test.ts # Unit tests
    ├── you-new-tool.ts          # Implementation
    ├── types.ts                 # Type definitions
    └── index.ts                 # Public exports
```
