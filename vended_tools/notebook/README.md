# Notebook Tool

A comprehensive tool for managing text notebooks within agent invocations. Supports creating, reading, writing, listing, and clearing notebooks with full state persistence.

## Overview

The notebook tool provides a flexible system for agents to maintain structured text data across multiple named notebooks. Each notebook acts as a persistent text store that can be manipulated through various operations.

## Features

- **Multiple Notebooks**: Create and manage multiple named notebooks simultaneously
- **Flexible Operations**: Create, read, write, list, and clear notebooks
- **String Replacement**: Replace text patterns within notebooks
- **Line Insertion**: Insert text at specific line numbers or after matching text
- **Range Reading**: Read specific line ranges with negative index support
- **State Persistence**: Notebooks persist within agent invocation state
- **Type Safety**: Built with Zod schemas for runtime validation
- **Universal**: Works in both browser and server environments

## Installation

The notebook tool is included in the Strands SDK vended tools:

```typescript
import { notebook } from '@strands-agents/sdk/vended_tools/notebook'
import { ToolRegistry } from '@strands-agents/sdk'

const registry = new ToolRegistry()
registry.register(notebook)
```

## Usage

### Basic Example

```typescript
import { notebook } from '@strands-agents/sdk/vended_tools/notebook'

// Initialize state
const state = { notebooks: {} }
const context = { invocationState: state, toolUse: { name: 'notebook', toolUseId: 'test', input: {} } }

// Create a notebook
await notebook.invoke({ mode: 'create', name: 'notes', newStr: '# My Notes' }, context)

// Write to notebook
await notebook.invoke(
  {
    mode: 'write',
    name: 'notes',
    insertLine: -1,
    newStr: '\n- Task 1\n- Task 2',
  },
  context
)

// Read notebook
const content = await notebook.invoke({ mode: 'read', name: 'notes' }, context)
```

## Operations

### Create

Creates a new notebook or overwrites an existing one.

```typescript
// Create empty notebook
await notebook.invoke({ mode: 'create', name: 'todo' }, context)

// Create with initial content
await notebook.invoke(
  {
    mode: 'create',
    name: 'notes',
    newStr: '# Project Notes\n\nInitial content here',
  },
  context
)
```

### List

Lists all available notebooks with their line counts.

```typescript
const list = await notebook.invoke({ mode: 'list' }, context)
// Returns: "Available notebooks:\n- default: Empty\n- notes: 5 lines"
```

### Read

Reads notebook content, optionally with line range selection.

```typescript
// Read entire notebook
const content = await notebook.invoke({ mode: 'read', name: 'notes' }, context)

// Read specific lines (1-indexed)
const range = await notebook.invoke(
  {
    mode: 'read',
    name: 'notes',
    readRange: [2, 4],
  },
  context
)

// Read with negative indices (from end)
const lastLines = await notebook.invoke(
  {
    mode: 'read',
    readRange: [-3, -1],
  },
  context
)
```

### Write

Modifies notebook content through string replacement or line insertion.

#### String Replacement

```typescript
// Replace text
await notebook.invoke(
  {
    mode: 'write',
    name: 'todo',
    oldStr: '[ ] Task 1',
    newStr: '[x] Task 1',
  },
  context
)

// Replace multiline text
await notebook.invoke(
  {
    mode: 'write',
    oldStr: 'Old section\nOld content',
    newStr: 'New section\nNew content',
  },
  context
)
```

#### Line Insertion

```typescript
// Insert after line number (1-indexed)
await notebook.invoke(
  {
    mode: 'write',
    insertLine: 2,
    newStr: 'New line after line 2',
  },
  context
)

// Insert at beginning
await notebook.invoke(
  {
    mode: 'write',
    insertLine: 0,
    newStr: 'First line',
  },
  context
)

// Append to end
await notebook.invoke(
  {
    mode: 'write',
    insertLine: -1,
    newStr: 'Last line',
  },
  context
)

// Insert after text match
await notebook.invoke(
  {
    mode: 'write',
    insertLine: '# Section 2',
    newStr: 'Content under section 2',
  },
  context
)
```

### Clear

Clears all content from a notebook while keeping it in the list.

```typescript
await notebook.invoke({ mode: 'clear', name: 'notes' }, context)
```

## State Management

### Structure

Notebooks are stored in the invocation state as a simple key-value store:

```typescript
interface NotebookState {
  notebooks: Record<string, string>
}
```

### Default Notebook

- A 'default' notebook is automatically created when the notebooks object is empty
- If no name is specified, operations use the 'default' notebook
- The default notebook behaves like any other notebook

### Persistence

- Notebooks persist throughout a single agent invocation
- State is managed in `context.invocationState.notebooks`
- Callers must handle persistence between sessions if needed
- All modifications update the state object in place

## API Reference

### Input Schema

The tool uses a discriminated union on the `mode` field:

```typescript
type NotebookInput =
  | { mode: 'create'; name?: string; newStr?: string }
  | { mode: 'list' }
  | { mode: 'read'; name?: string; readRange?: [number, number] }
  | {
      mode: 'write'
      name?: string
      oldStr?: string
      newStr?: string
      insertLine?: string | number
    }
  | { mode: 'clear'; name?: string }
```

### Line Number Conventions

- **1-indexed**: Line numbers are 1-indexed (line 1 is the first line)
- **Negative indices**: Count from the end (-1 is after the last line, -2 is before the last line)
- **Insert position**: `insertLine: N` inserts _after_ line N (0 inserts at the beginning)

### Error Handling

The tool throws descriptive errors for:

- Non-existent notebooks
- Text not found in replacement operations
- Line numbers out of range
- Missing required parameters
- Invalid operation combinations

## Testing

The notebook tool includes comprehensive tests covering:

- All operation modes
- Edge cases (empty notebooks, negative indices, etc.)
- Error conditions
- State persistence
- Multi-notebook operations

Run tests with:

```bash
npm test -- vended_tools/notebook/__tests__/notebook.test.ts
```

## Design Decisions

### Why Not File System?

The notebook tool uses in-memory state rather than file system operations to:

- Work universally in browser and server environments
- Provide instant access without I/O overhead
- Avoid permission and security concerns
- Preserves notebooks across agent sessions

### String-Based Storage

Notebooks store content as strings (not arrays of lines) because:

- Simpler serialization for state persistence
- More natural for text-based content
- Efficient for most use cases
- Lines are split on-demand for operations

### Operation Design

The tool uses a mode-based approach (rather than separate tools) to:

- Provide a cohesive interface for notebook management
- Reduce tool registration overhead
- Enable better type safety with discriminated unions
- Match the Python reference implementation

## Examples

### Todo List Manager

```typescript
// Create todo list
await notebook.invoke(
  {
    mode: 'create',
    name: 'todo',
    newStr: '# Todo List\n\n[ ] Task 1\n[ ] Task 2',
  },
  context
)

// Mark task complete
await notebook.invoke(
  {
    mode: 'write',
    name: 'todo',
    oldStr: '[ ] Task 1',
    newStr: '[x] Task 1',
  },
  context
)

// Add new task
await notebook.invoke(
  {
    mode: 'write',
    name: 'todo',
    insertLine: -1,
    newStr: '[ ] Task 3',
  },
  context
)
```

### Research Notes

```typescript
// Initialize notes
await notebook.invoke(
  {
    mode: 'create',
    name: 'research',
    newStr: '# Research Notes\n\n## Findings',
  },
  context
)

// Add finding after specific section
await notebook.invoke(
  {
    mode: 'write',
    name: 'research',
    insertLine: '## Findings',
    newStr: '- Discovery 1: Important insight',
  },
  context
)

// Read recent findings (last 5 lines)
const recent = await notebook.invoke(
  {
    mode: 'read',
    name: 'research',
    readRange: [-5, -1],
  },
  context
)
```

## Migration from Python

This TypeScript implementation matches the Python reference implementation with a few enhancements:

- **Type Safety**: Full TypeScript types with Zod validation
- **Modern API**: Uses discriminated unions for operation modes
- **Better Errors**: More descriptive error messages
- **Consistent Naming**: Uses TypeScript naming conventions

## Contributing

When contributing to the notebook tool:

1. Maintain 80%+ test coverage
2. Add tests for any new features
3. Update this README with new functionality
4. Follow the existing code patterns
5. Ensure all tests pass before submitting

## License

Same license as the Strands SDK.
