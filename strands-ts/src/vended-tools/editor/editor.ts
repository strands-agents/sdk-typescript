/**
 * Sandbox-aware file editor tool implementation.
 *
 * Provides view, create, str_replace, insert, and undo_edit operations on files
 * in the agent's sandbox. The tool delegates all file I/O to the sandbox's
 * `readFile`, `writeFile`, and `listFiles` methods.
 *
 * The tool shape matches Anthropic's `text_editor` built-in tool — 5 commands,
 * 7 parameters. This means models trained on Anthropic's tool spec will work
 * well with this tool out of the box.
 *
 * Configuration keys (set via `agent.appState.set('strands_editor_tool', {...})`):
 * - `maxFileSize` (number): Maximum file size in bytes for read operations.
 *   Default: 1048576 (1 MB).
 * - `requireAbsolutePaths` (boolean): When true, rejects relative paths.
 *   Default: false.
 *
 * @example
 * ```typescript
 * import { editor } from '@strands-agents/sdk/vended-tools/editor'
 * import { Agent } from '@strands-agents/sdk'
 *
 * const agent = new Agent({ tools: [editor] })
 * await agent.invoke('View the contents of /tmp/example.ts')
 * ```
 */

import { tool } from '../../tools/tool-factory.js'
import { z } from 'zod'
import type { Sandbox } from '../../sandbox/base.js'
import type { ToolContext } from '../../tools/tool.js'
import type { EditorToolConfig } from './types.js'

/**
 * State key for editor tool configuration in agent.appState.
 */
const STATE_KEY = 'strands_editor_tool'

/**
 * State key for undo history (internal).
 */
const UNDO_STATE_KEY = '_strands_editor_undo'

/**
 * Default maximum file size (1 MB).
 */
const DEFAULT_MAX_FILE_SIZE = 1_048_576

/**
 * Number of context lines to show around edits.
 */
const SNIPPET_LINES = 4

/**
 * Zod schema for editor input validation.
 */
const editorInputSchema = z.object({
  command: z
    .enum(['view', 'create', 'str_replace', 'insert', 'undo_edit'])
    .describe('The operation to perform: view, create, str_replace, insert, or undo_edit'),
  path: z.string().describe('Path to the file or directory'),
  file_text: z.string().optional().describe('Content for new file (required for create command)'),
  old_str: z
    .string()
    .optional()
    .describe('Exact string to find and replace (required for str_replace). Must appear exactly once.'),
  new_str: z.string().optional().describe('Replacement string (for str_replace and insert commands)'),
  insert_line: z
    .number()
    .optional()
    .describe('Line number where text should be inserted (0-indexed, required for insert)'),
  view_range: z
    .tuple([z.number(), z.number()])
    .optional()
    .describe('Line range to view [start, end]. 1-indexed. Use -1 for end of file.'),
})

/**
 * Format file content with line numbers (cat -n style).
 */
function makeOutput(content: string, descriptor: string, initLine = 1): string {
  const expanded = content.replace(/\t/g, '        ')
  const lines = expanded.split('\n')
  const numbered = lines.map((line, i) => {
    const lineNum = i + initLine
    return `${lineNum.toString().padStart(6)}  ${line}`
  })
  return `Here's the result of running \`cat -n\` on ${descriptor}:\n${numbered.join('\n')}\n`
}

/**
 * Save file content for undo.
 */
function saveUndo(context: ToolContext, path: string, content: string): void {
  const undoState = (context.agent.appState.get(UNDO_STATE_KEY) as Record<string, string>) ?? {}
  undoState[path] = content
  context.agent.appState.set(UNDO_STATE_KEY, undoState)
}

/**
 * Get saved undo content for a file.
 */
function getUndo(context: ToolContext, path: string): string | undefined {
  const undoState = (context.agent.appState.get(UNDO_STATE_KEY) as Record<string, string>) ?? {}
  return undoState[path]
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Handle the view command.
 */
async function handleView(
  sandbox: Sandbox,
  config: EditorToolConfig,
  path: string,
  viewRange?: [number, number]
): Promise<string> {
  // Check if path is a directory
  try {
    const entries = await sandbox.listFiles(path)
    if (viewRange) {
      return 'Error: The `view_range` parameter is not allowed when `path` points to a directory.'
    }
    const items = entries
      .filter((e) => e.name !== '.' && e.name !== '..')
      .map((e) => (e.isDir ? `${e.name}/` : e.name))
      .sort()
    return (
      `Here's the files and directories up to 2 levels deep in ${path}, ` +
      `excluding hidden items:\n${items.join('\n')}\n`
    )
  } catch {
    // Not a directory, try as file
  }

  // Read file
  const maxSize = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE
  let content: string
  try {
    const data = await sandbox.readFile(path)
    content = new TextDecoder('utf-8').decode(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      return `Error: The path ${path} does not exist. Please provide a valid path.`
    }
    if (error instanceof Error && error.message.includes('decode')) {
      return `Error: The file ${path} is not a text file (cannot decode as UTF-8).`
    }
    return `Error: The path ${path} does not exist. Please provide a valid path.`
  }

  // Check size
  if (new TextEncoder().encode(content).length > maxSize) {
    return `Error: File size exceeds maximum allowed size (${maxSize} bytes).`
  }

  if (!viewRange) {
    return makeOutput(content, path)
  }

  // Validate and apply view range
  const lines = content.split('\n')
  const nLines = lines.length
  const [start, end] = viewRange

  if (start < 1 || start > nLines) {
    return `Error: Invalid \`view_range\`: [${start}, ${end}]. First element \`${start}\` should be within [1, ${nLines}].`
  }
  if (end !== -1 && end > nLines) {
    return `Error: Invalid \`view_range\`: [${start}, ${end}]. Second element \`${end}\` should be <= ${nLines}.`
  }
  if (end !== -1 && end < start) {
    return `Error: Invalid \`view_range\`: [${start}, ${end}]. Second element must be >= first element.`
  }

  const selected = end === -1 ? lines.slice(start - 1) : lines.slice(start - 1, end)
  return makeOutput(selected.join('\n'), path, start)
}

/**
 * Handle the create command.
 */
async function handleCreate(sandbox: Sandbox, context: ToolContext, path: string, fileText: string): Promise<string> {
  // Check if file already exists
  try {
    await sandbox.readFile(path)
    return `Error: File already exists at: ${path}. Cannot overwrite with \`create\`. Use \`str_replace\` to edit.`
  } catch {
    // File doesn't exist, good
  }

  await sandbox.writeFile(path, new TextEncoder().encode(fileText))
  return `File created successfully at: ${path}`
}

/**
 * Handle the str_replace command.
 */
async function handleStrReplace(
  sandbox: Sandbox,
  context: ToolContext,
  config: EditorToolConfig,
  path: string,
  oldStr: string,
  newStr: string
): Promise<string> {
  let content: string
  try {
    content = new TextDecoder('utf-8').decode(await sandbox.readFile(path))
  } catch {
    return `Error: The path ${path} does not exist.`
  }

  // Expand tabs for matching
  content = content.replace(/\t/g, '        ')
  const expandedOld = oldStr.replace(/\t/g, '        ')
  const expandedNew = newStr.replace(/\t/g, '        ')

  // Count occurrences — MUST be exactly 1
  const matches = content.match(new RegExp(escapeRegExp(expandedOld), 'g'))
  const count = matches ? matches.length : 0

  if (count === 0) {
    return `Error: No replacement was performed, old_str \`${oldStr}\` did not appear verbatim in ${path}.`
  }

  if (count > 1) {
    const lines = content.split('\n')
    const lineNums = lines.map((line, i) => (line.includes(expandedOld) ? i + 1 : -1)).filter((n) => n !== -1)
    return (
      `Error: No replacement was performed. Multiple occurrences (${count}) of old_str ` +
      `in lines ${JSON.stringify(lineNums)}. Please ensure old_str is unique.`
    )
  }

  // Save undo state
  saveUndo(context, path, content)

  // Perform replacement
  const newContent = content.replace(expandedOld, () => expandedNew)

  // Write back
  await sandbox.writeFile(path, new TextEncoder().encode(newContent))

  // Generate snippet around the change
  const replaceIdx = content.indexOf(expandedOld)
  const replaceLine = content.substring(0, replaceIdx).split('\n').length - 1
  const insertedLines = expandedNew.split('\n').length
  const originalLines = expandedOld.split('\n').length
  const lineDiff = insertedLines - originalLines

  const newLines = newContent.split('\n')
  const snippetStart = Math.max(0, replaceLine - SNIPPET_LINES)
  const snippetEnd = Math.min(newLines.length, replaceLine + SNIPPET_LINES + lineDiff + 1)
  const snippet = newLines.slice(snippetStart, snippetEnd).join('\n')

  return (
    `The file ${path} has been edited. ` +
    makeOutput(snippet, `a snippet of ${path}`, snippetStart + 1) +
    'Review the changes and make sure they are as expected. Edit the file again if necessary.'
  )
}

/**
 * Handle the insert command.
 */
async function handleInsert(
  sandbox: Sandbox,
  context: ToolContext,
  config: EditorToolConfig,
  path: string,
  insertLine: number,
  newStr: string
): Promise<string> {
  let content: string
  try {
    content = new TextDecoder('utf-8').decode(await sandbox.readFile(path))
  } catch {
    return `Error: The path ${path} does not exist.`
  }

  // Expand tabs
  content = content.replace(/\t/g, '        ')
  const expandedNew = newStr.replace(/\t/g, '        ')

  const lines = content.split('\n')
  const nLines = lines.length

  if (insertLine < 0 || insertLine > nLines) {
    return `Error: Invalid \`insert_line\`: ${insertLine}. Should be within [0, ${nLines}].`
  }

  // Save undo state
  saveUndo(context, path, content)

  // Insert
  const newStrLines = expandedNew.split('\n')
  let newLines: string[]
  if (content === '') {
    newLines = newStrLines
  } else {
    newLines = [...lines.slice(0, insertLine), ...newStrLines, ...lines.slice(insertLine)]
  }

  const newContent = newLines.join('\n')
  await sandbox.writeFile(path, new TextEncoder().encode(newContent))

  // Generate snippet
  const snippetStart = Math.max(0, insertLine - SNIPPET_LINES)
  const snippetEnd = Math.min(newLines.length, insertLine + newStrLines.length + SNIPPET_LINES)
  const snippet = newLines.slice(snippetStart, snippetEnd).join('\n')

  return (
    `The file ${path} has been edited. ` +
    makeOutput(snippet, 'a snippet of the edited file', snippetStart + 1) +
    'Review the changes and make sure they are as expected. Edit the file again if necessary.'
  )
}

/**
 * Handle the undo_edit command.
 */
async function handleUndo(sandbox: Sandbox, context: ToolContext, path: string): Promise<string> {
  const previousContent = getUndo(context, path)
  if (previousContent === undefined) {
    return `Error: No edit history found for ${path}.`
  }

  // Read current content for future undo
  let current = ''
  try {
    current = new TextDecoder('utf-8').decode(await sandbox.readFile(path))
  } catch {
    // File might have been deleted
  }

  // Write the previous content back
  await sandbox.writeFile(path, new TextEncoder().encode(previousContent))

  // Save current as new undo (so undo is toggleable)
  saveUndo(context, path, current)

  return `Successfully reverted last edit to ${path}.`
}

/**
 * Sandbox-aware file editor for viewing, creating, and editing files.
 *
 * Unlike the legacy `fileEditor` tool that uses Node.js `fs` directly,
 * this tool delegates all file I/O to `context.agent.sandbox`, making it
 * work transparently with any sandbox implementation.
 *
 * Commands:
 * - **view**: Display file contents with line numbers, or list directory contents.
 * - **create**: Create a new file (fails if file exists).
 * - **str_replace**: Replace a unique string occurrence in a file.
 * - **insert**: Insert text at a specific line number.
 * - **undo_edit**: Revert the last edit to a file.
 *
 * @example
 * ```typescript
 * import { editor } from '@strands-agents/sdk/vended-tools/editor'
 * import { Agent } from '@strands-agents/sdk'
 *
 * const agent = new Agent({ tools: [editor] })
 * await agent.invoke('Create a file /tmp/hello.ts with a greeting function')
 * ```
 */
export const editor = tool({
  name: 'editor',
  description:
    "View, create, and edit files in the agent's sandbox. Supports view (with line ranges), " +
    'create, str_replace (unique occurrence), insert (at line number), and undo_edit. ' +
    'All file operations go through the sandbox.',
  inputSchema: editorInputSchema,
  callback: async (input, context?: ToolContext) => {
    if (!context) {
      throw new Error('Tool context is required for editor operations')
    }

    const config: EditorToolConfig = (context.agent.appState.get(STATE_KEY) as EditorToolConfig) ?? {}
    const sandbox = context.agent.sandbox

    // Path validation is opt-in
    if (config.requireAbsolutePaths) {
      if (!input.path.startsWith('/')) {
        return `Error: The path ${input.path} is not an absolute path.`
      }
      if (input.path.includes('..')) {
        return 'Error: Path traversal (..) is not allowed.'
      }
    }

    try {
      switch (input.command) {
        case 'view':
          return await handleView(sandbox, config, input.path, input.view_range)
        case 'create':
          if (input.file_text === undefined) {
            return 'Error: Parameter `file_text` is required for command: create'
          }
          return await handleCreate(sandbox, context, input.path, input.file_text)
        case 'str_replace':
          if (input.old_str === undefined) {
            return 'Error: Parameter `old_str` is required for command: str_replace'
          }
          return await handleStrReplace(sandbox, context, config, input.path, input.old_str, input.new_str ?? '')
        case 'insert':
          if (input.insert_line === undefined) {
            return 'Error: Parameter `insert_line` is required for command: insert'
          }
          if (input.new_str === undefined) {
            return 'Error: Parameter `new_str` is required for command: insert'
          }
          return await handleInsert(sandbox, context, config, input.path, input.insert_line, input.new_str)
        case 'undo_edit':
          return await handleUndo(sandbox, context, input.path)
        default:
          return `Error: Unknown command: ${input.command}`
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('NotImplementedError')) {
        return `Error: Sandbox does not support this operation — ${error.message}`
      }
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
