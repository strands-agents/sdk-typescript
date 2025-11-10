# File Editor Tool

A filesystem editor tool for viewing, creating, and editing files programmatically with an LLM agent. Supports string replacement, line insertion, undo functionality, and directory viewing.

## Features

- **View files** with line numbers and optional line range support
- **Create files** with initial content
- **String-based find and replace** with uniqueness validation
- **Line-based text insertion** at any position
- **Undo edit history** for reverting changes
- **Directory viewing** up to 2 levels deep
- **Path security validation** to prevent directory traversal
- **Configurable file size limits** (default 1MB)

## Installation

```typescript
import { fileEditor } from '@strands-agents/sdk/vended_tools/file_editor'
```

## Usage

### Basic Example

```typescript
import { Agent } from '@strands-agents/sdk'
import { BedrockModel } from '@strands-agents/sdk'
import { fileEditor } from '@strands-agents/sdk/vended_tools/file_editor'

const agent = new Agent({
  model: new BedrockModel({ region: 'us-east-1' }),
  tools: [fileEditor],
})

// The agent can now use the file editor tool
await agent.invoke('Create a file /tmp/notes.txt with "# My Notes"')
await agent.invoke('View the contents of /tmp/notes.txt')
await agent.invoke('Replace "My Notes" with "Project Notes" in /tmp/notes.txt')
```

### Direct Tool Invocation

```typescript
import { fileEditor } from '@strands-agents/sdk/vended_tools/file_editor'

// View a file
const viewResult = await fileEditor.invoke(
  { command: 'view', path: '/tmp/test.txt' },
  context
)

// View specific lines
const rangeResult = await fileEditor.invoke(
  { command: 'view', path: '/tmp/test.txt', view_range: [10, 20] },
  context
)

// Create a new file
const createResult = await fileEditor.invoke(
  { command: 'create', path: '/tmp/new-file.txt', file_text: 'Hello World' },
  context
)

// Replace text
const replaceResult = await fileEditor.invoke(
  { command: 'str_replace', path: '/tmp/test.txt', old_str: 'old text', new_str: 'new text' },
  context
)

// Insert at a specific line
const insertResult = await fileEditor.invoke(
  { command: 'insert', path: '/tmp/test.txt', insert_line: 5, new_str: 'new line' },
  context
)

// Undo last edit
const undoResult = await fileEditor.invoke(
  { command: 'undo_edit', path: '/tmp/test.txt' },
  context
)
```

## Commands

### `view`

View file contents with line numbers, or list directory contents.

**Parameters:**
- `path` (string, required): Absolute path to file or directory
- `view_range` (optional): `[start_line, end_line]` for viewing specific lines (1-indexed, end can be -1 for EOF)

**Example:**
```typescript
{ command: 'view', path: '/tmp/file.txt' }
{ command: 'view', path: '/tmp/file.txt', view_range: [10, 20] }
{ command: 'view', path: '/tmp/directory' }
```

### `create`

Create a new file with specified content.

**Parameters:**
- `path` (string, required): Absolute path for new file
- `file_text` (string, required): Initial content for the file

**Example:**
```typescript
{ command: 'create', path: '/tmp/new.txt', file_text: 'Hello World' }
```

**Notes:**
- Will create parent directories if they don't exist
- Fails if file already exists (prevents accidental overwrites)

### `str_replace`

Replace an exact string match in a file.

**Parameters:**
- `path` (string, required): Absolute path to file
- `old_str` (string, required): Exact string to find (must appear exactly once)
- `new_str` (string, optional): Replacement string (default: empty string)

**Example:**
```typescript
{ command: 'str_replace', path: '/tmp/file.txt', old_str: 'old text', new_str: 'new text' }
```

**Notes:**
- `old_str` must appear exactly once in the file
- Shows a snippet of 4 lines before and after the change
- Saves previous content to history for undo

### `insert`

Insert text at a specific line number.

**Parameters:**
- `path` (string, required): Absolute path to file
- `insert_line` (number, required): Line number for insertion (0-indexed)
- `new_str` (string, required): Text to insert

**Example:**
```typescript
{ command: 'insert', path: '/tmp/file.txt', insert_line: 5, new_str: 'new line' }
```

**Notes:**
- Line numbers are 0-indexed (0 = insert at beginning, N = insert after line N)
- Shows a snippet of 4 lines before and after the insertion
- Saves previous content to history for undo

### `undo_edit`

Revert the last edit operation on a file.

**Parameters:**
- `path` (string, required): Absolute path to file

**Example:**
```typescript
{ command: 'undo_edit', path: '/tmp/file.txt' }
```

**Notes:**
- Restores the file to its state before the last edit
- Maintains up to 10 versions of history per file
- Fails if no edit history exists

## Configuration

The file editor tool uses sensible defaults, but can be configured by modifying constants in the source:

- **Maximum file size**: 1MB (1,048,576 bytes) - prevents reading very large files
- **Maximum history size**: 10 versions per file - limits memory usage
- **Snippet lines**: 4 lines before/after changes - controls output verbosity

## Security

The tool includes several security features:

1. **Absolute paths required**: Prevents confusion with relative paths
2. **Directory traversal prevention**: Blocks paths containing `..`
3. **Clear error messages**: All errors are descriptive and actionable

## Limitations

### Version 1

- **Node.js only**: Uses Node.js filesystem APIs (no browser support)
- **Text files only**: Designed for UTF-8 encoded text files
- **No regex support**: String replacement uses exact match only
- **Memory-based history**: History is lost when agent session ends

### Future Enhancements

Planned for future versions:
- Additional file readers (PDF, CSV, images)
- Browser compatibility
- Persistent history storage
- Regex support for string replacement
- Streaming support for very large files
- File copying/moving operations

## TypeScript Types

```typescript
import type { FileEditorState, FileEditorInput, IFileReader } from '@strands-agents/sdk/vended_tools/file_editor'

// State structure for history
interface FileEditorState {
  fileEditorHistory: Record<string, string[]>
}

// Input union type
type FileEditorInput = ViewInput | CreateInput | StrReplaceInput | InsertInput | UndoEditInput

// Pluggable file reader interface
interface IFileReader {
  canRead(path: string): Promise<boolean>
  read(path: string): Promise<string>
}
```

## Error Handling

The tool provides clear, actionable error messages:

- **File not found**: Includes the path and suggests checking the path
- **Permission denied**: Indicates which file couldn't be accessed
- **Invalid path**: Explains why (not absolute, contains traversal, etc.)
- **File too large**: Shows actual size vs limit
- **String not found**: For `str_replace`, indicates the string wasn't found
- **Multiple occurrences**: For `str_replace`, lists line numbers where string appears
- **No history**: For `undo_edit`, indicates no edits to undo

## Examples

### Creating and editing a configuration file

```typescript
// Create initial config
await agent.invoke('Create /tmp/config.json with {}')

// Add content
await agent.invoke('Replace {} with {"debug": false, "port": 3000} in /tmp/config.json')

// Update a value
await agent.invoke('Replace "debug": false with "debug": true in /tmp/config.json')

// Undo if needed
await agent.invoke('Undo the last edit to /tmp/config.json')
```

### Viewing and navigating large files

```typescript
// View first 20 lines
await agent.invoke('View lines 1-20 of /tmp/large-file.txt')

// View specific section
await agent.invoke('View lines 100-150 of /tmp/large-file.txt')

// View from line 500 to end
await agent.invoke('View from line 500 to end of /tmp/large-file.txt')
```

### Working with multiple files

```typescript
// View directory structure
await agent.invoke('View the contents of /tmp/project')

// Create multiple files
await agent.invoke('Create /tmp/project/README.md with "# My Project"')
await agent.invoke('Create /tmp/project/main.py with "print(\'Hello\')"')

// Edit each file independently (separate history)
await agent.invoke('Add "## Installation" to /tmp/project/README.md after line 1')
await agent.invoke('Replace print with logging.info in /tmp/project/main.py')
```

## License

This tool is part of the Strands TypeScript SDK and is licensed under the same terms.
