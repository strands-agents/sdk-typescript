# Tools - File Editor

A vended tool for reading and modifying files on disk. Supports viewing, creating, string replacement, and line insertion. Node.js only. Import from `@strands-agents/sdk/vended-tools/file-editor`.

Templates: [tools-file-editor.ts](../templates/tools-file-editor.ts)

---

## File operations

- View: read file contents
- Create: create a new file
- String-replace: replace a string in an existing file
- Insert: insert text at a specific line

Watch for: Does string-replace handle edge cases (multiple matches, no match)?

## Validation

- Path validation: try invalid paths, verify errors
- Directory detection: try to edit a directory, verify it's rejected

Watch for: Are path validation errors clear?
