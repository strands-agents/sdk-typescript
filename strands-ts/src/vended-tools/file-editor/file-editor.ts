import { tool } from '../../tools/tool-factory.js'
import { z } from 'zod'
import type { Sandbox } from '../../sandbox/base.js'
import { shellQuote } from '../../utils/shell-quote.js'

const SNIPPET_LINES = 4
const DEFAULT_MAX_FILE_SIZE = 1048576 // 1MB
const MAX_DIRECTORY_DEPTH = 2

const undoStore = new WeakMap<object, Map<string, string>>()

function getUndoMap(agent: object): Map<string, string> {
  let map = undoStore.get(agent)
  if (!map) {
    map = new Map()
    undoStore.set(agent, map)
  }
  return map
}

/**
 * Zod schema for file editor input validation.
 */
const fileEditorInputSchema = z.object({
  command: z
    .enum(['view', 'create', 'str_replace', 'insert', 'undo', 'grep', 'glob'])
    .describe('The operation to perform: `view`, `create`, `str_replace`, `insert`, `undo`, `grep`, `glob`.'),
  path: z.string().describe('Path to the file or directory. Can be absolute or relative to the working directory.'),
  file_text: z.string().optional().describe('Content for new file (required for create command).'),
  view_range: z
    .tuple([z.number(), z.number()])
    .optional()
    .describe('Line range to view [start, end]. 1-indexed. End can be -1 for end of file.'),
  old_str: z.string().optional().describe('Exact string to find and replace (required for str_replace command).'),
  new_str: z.string().optional().describe('Replacement string for str_replace, or text to insert for insert command.'),
  insert_line: z
    .number()
    .optional()
    .describe('Line number where text should be inserted (0-indexed, required for insert command).'),
  pattern: z
    .string()
    .optional()
    .describe('Search pattern. Regex for grep, glob pattern (e.g., **/*.ts) for glob command.'),
  include: z
    .string()
    .optional()
    .describe('File glob filter for grep (e.g., *.ts). Only searches files matching this pattern.'),
  max_results: z.number().optional().describe('Maximum number of results to return for grep or glob commands.'),
})

/**
 * File editor tool for viewing, creating, and editing files programmatically.
 *
 * Provides commands for viewing files/directories, creating files, string replacement,
 * and line insertion.
 *
 * @example
 * ```typescript
 * import { fileEditor } from '@strands-agents/sdk/vended-tools/file-editor'
 * import { Agent } from '@strands-agents/sdk'
 *
 * const agent = new Agent({
 *   model: new BedrockModel({ region: 'us-east-1' }),
 *   tools: [fileEditor],
 * })
 *
 * await agent.invoke('View the file /tmp/test.txt')
 * await agent.invoke('Create a file /tmp/notes.txt with content "Hello World"')
 * await agent.invoke('Replace "Hello" with "Hi" in /tmp/notes.txt')
 * ```
 */
export const fileEditor = tool({
  name: 'fileEditor',
  description:
    'Filesystem tool for viewing, creating, editing, and searching files. Supports view (with line ranges), create, str_replace, insert, undo, grep (search file contents), and glob (find files by name). Paths can be absolute or relative to the working directory.',
  inputSchema: fileEditorInputSchema,
  callback: async (input, context) => {
    if (!context) {
      throw new Error('Tool context is required for file editor operations')
    }

    const sandbox = context.agent.sandbox
    const undoMap = getUndoMap(context.agent)

    let result: string

    switch (input.command) {
      case 'view':
        result = await handleView(sandbox, input.path, input.view_range)
        break

      case 'create':
        result = await handleCreate(sandbox, input.path, input.file_text!)
        break

      case 'str_replace':
        result = await handleStrReplace(sandbox, undoMap, input.path, input.old_str!, input.new_str!)
        break

      case 'insert':
        result = await handleInsert(sandbox, undoMap, input.path, input.insert_line!, input.new_str!)
        break

      case 'undo':
        result = await handleUndo(sandbox, undoMap, input.path)
        break

      case 'grep':
        result = await handleGrep(sandbox, input.path, input.pattern!, input.include, input.max_results)
        break

      case 'glob':
        result = await handleGlob(sandbox, input.path, input.pattern!, input.max_results)
        break

      default:
        throw new Error(`Unknown command: ${input.command}`)
    }

    return result
  },
})

/**
 * Formats file content with line numbers (cat -n style).
 */
function makeOutput(fileContent: string, fileDescriptor: string, initLine: number = 1): string {
  // Expand tabs to spaces in content
  const expandedContent = fileContent.replace(/\t/g, '        ')

  const numberedLines = expandedContent.split('\n').map((line, index) => {
    const lineNum = index + initLine
    // Use two spaces instead of tab to avoid any tabs in output
    return `${lineNum.toString().padStart(6)}  ${line}`
  })

  return `Here's the result of running \`cat -n\` on ${fileDescriptor}:\n${numberedLines.join('\n')}\n`
}

/**
 * Lists directory contents up to 2 levels deep, excluding hidden files.
 */
async function listDirectory(sandbox: Sandbox, dirPath: string): Promise<string> {
  const items: string[] = []

  async function walk(currentPath: string, prefix: string, depth: number): Promise<void> {
    try {
      const entries = await sandbox.listFiles(currentPath)

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue

        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        items.push(relativePath)

        if (entry.isDir && depth < MAX_DIRECTORY_DEPTH) {
          await walk(`${currentPath}/${entry.name}`, relativePath, depth + 1)
        }
      }
    } catch {
      // Ignore permission errors and continue
    }
  }

  await walk(dirPath, '', 0)

  const result = items.sort().join('\n')
  return `Here's the files and directories up to 2 levels deep in ${dirPath}, excluding hidden items:\n${result}\n`
}

/**
 * Handles the view command.
 */
async function handleView(
  sandbox: Sandbox,
  filePath: string,
  viewRange: [number, number] | undefined
): Promise<string> {
  const info = await sandbox.statFile(filePath)

  if (info.isDir) {
    if (viewRange) {
      throw new Error('The `view_range` parameter is not allowed when `path` points to a directory.')
    }
    return await listDirectory(sandbox, filePath)
  }

  if (info.size !== undefined && info.size > DEFAULT_MAX_FILE_SIZE) {
    throw new Error(`File size (${info.size} bytes) exceeds maximum allowed size (${DEFAULT_MAX_FILE_SIZE} bytes)`)
  }

  const raw = await sandbox.readFile(filePath)

  // Null byte heuristic for binary detection (same as git)
  if (raw.includes(0)) {
    return `Binary file: ${filePath} (${raw.length} bytes)`
  }

  const fileContent = new TextDecoder().decode(raw)

  let initLine = 1
  let contentToShow = fileContent

  if (viewRange) {
    const lines = fileContent.split('\n')
    const nLines = lines.length
    let [start, end] = viewRange

    // Validate range
    if (start < 1 || start > nLines) {
      throw new Error(
        `Invalid \`view_range\`: [${start}, ${end}]. Its first element \`${start}\` should be within the range of lines of the file: [1, ${nLines}]`
      )
    }

    if (end !== -1 && end > nLines) {
      throw new Error(
        `Invalid \`view_range\`: [${start}, ${end}]. Its second element \`${end}\` should be smaller than the number of lines in the file: \`${nLines}\``
      )
    }

    if (end !== -1 && end < start) {
      throw new Error(
        `Invalid \`view_range\`: [${start}, ${end}]. Its second element \`${end}\` should be larger or equal than its first \`${start}\``
      )
    }

    initLine = start
    if (end === -1) {
      contentToShow = lines.slice(start - 1).join('\n')
    } else {
      contentToShow = lines.slice(start - 1, end).join('\n')
    }
  }

  return makeOutput(contentToShow, filePath, initLine)
}

/**
 * Handles the create command.
 */
async function handleCreate(sandbox: Sandbox, filePath: string, fileText: string): Promise<string> {
  if (fileText === undefined) {
    throw new Error('Parameter `file_text` is required for command: create')
  }

  const exists = await sandbox.statFile(filePath).then(
    () => true,
    () => false
  )

  if (exists) {
    throw new Error(`File already exists at: ${filePath}. Cannot overwrite files using command \`create\`.`)
  }

  await sandbox.writeText(filePath, fileText)

  return `File created successfully at: ${filePath}`
}

/**
 * Handles the str_replace command.
 */
async function handleStrReplace(
  sandbox: Sandbox,
  undoMap: Map<string, string>,
  filePath: string,
  oldStr: string,
  newStr: string
): Promise<string> {
  const info = await sandbox.statFile(filePath)

  if (info.isDir) {
    throw new Error(`The path ${filePath} is a directory and only the \`view\` command can be used on directories`)
  }

  if (info.size !== undefined && info.size > DEFAULT_MAX_FILE_SIZE) {
    throw new Error(`File size (${info.size} bytes) exceeds maximum allowed size (${DEFAULT_MAX_FILE_SIZE} bytes)`)
  }

  const fileContent = await sandbox.readText(filePath)

  const first = fileContent.indexOf(oldStr)
  if (first === -1) {
    throw new Error(`No replacement was performed, old_str \`${oldStr}\` did not appear verbatim in ${filePath}.`)
  }

  if (fileContent.indexOf(oldStr, first + 1) !== -1) {
    const lines = fileContent.split('\n')
    const lineNumbers = lines.map((line, index) => (line.includes(oldStr) ? index + 1 : -1)).filter((num) => num !== -1)
    throw new Error(
      `No replacement was performed. Multiple occurrences of old_str \`${oldStr}\` in lines ${JSON.stringify(lineNumbers)}. Please ensure it is unique`
    )
  }

  undoMap.set(filePath, fileContent)

  const newFileContent = fileContent.slice(0, first) + newStr + fileContent.slice(first + oldStr.length)

  await sandbox.writeText(filePath, newFileContent)

  const replacementLine = fileContent.slice(0, first).split('\n').length - 1
  const lineDifference = newStr.split('\n').length - oldStr.split('\n').length

  const lines = newFileContent.split('\n')
  const startLine = Math.max(0, replacementLine - SNIPPET_LINES)
  const endLine = Math.min(lines.length, replacementLine + SNIPPET_LINES + lineDifference + 1)
  const snippet = lines.slice(startLine, endLine).join('\n')

  return `The file ${filePath} has been edited. ${makeOutput(snippet, `a snippet of ${filePath}`, startLine + 1)}Review the changes and make sure they are as expected. Edit the file again if necessary.`
}

/**
 * Handles the insert command.
 */
async function handleInsert(
  sandbox: Sandbox,
  undoMap: Map<string, string>,
  filePath: string,
  insertLine: number,
  newStr: string
): Promise<string> {
  if (insertLine === undefined || newStr === undefined) {
    throw new Error('Parameters `insert_line` and `new_str` are required for command: insert')
  }

  const info = await sandbox.statFile(filePath)

  if (info.isDir) {
    throw new Error(`The path ${filePath} is a directory and only the \`view\` command can be used on directories`)
  }

  if (info.size !== undefined && info.size > DEFAULT_MAX_FILE_SIZE) {
    throw new Error(`File size (${info.size} bytes) exceeds maximum allowed size (${DEFAULT_MAX_FILE_SIZE} bytes)`)
  }

  const fileText = await sandbox.readText(filePath)

  const fileTextLines = fileText.split('\n')
  const nLines = fileTextLines.length

  if (insertLine < 0 || insertLine > nLines) {
    throw new Error(
      `Invalid \`insert_line\` parameter: ${insertLine}. It should be within the range of lines of the file: [0, ${nLines}]`
    )
  }

  const newStrLines = newStr.split('\n')
  const newFileTextLines =
    fileText === ''
      ? newStrLines
      : [...fileTextLines.slice(0, insertLine), ...newStrLines, ...fileTextLines.slice(insertLine)]

  undoMap.set(filePath, fileText)

  const newFileText = newFileTextLines.join('\n')

  await sandbox.writeText(filePath, newFileText)

  const snippetStartLine = Math.max(0, insertLine - SNIPPET_LINES)
  const snippetEndLine = Math.min(newFileTextLines.length, insertLine + newStrLines.length + SNIPPET_LINES)
  const snippet = newFileTextLines.slice(snippetStartLine, snippetEndLine).join('\n')

  return `The file ${filePath} has been edited. ${makeOutput(snippet, 'a snippet of the edited file', snippetStartLine + 1)}Review the changes and make sure they are as expected (correct indentation, no duplicate lines, etc). Edit the file again if necessary.`
}

async function handleGrep(
  sandbox: Sandbox,
  dirPath: string,
  pattern: string,
  include: string | undefined,
  maxResults: number | undefined
): Promise<string> {
  const includeFlag = include ? ` --include=${shellQuote(include)}` : ''
  const result = await sandbox.execute(`grep -rn${includeFlag} ${shellQuote(pattern)} ${shellQuote(dirPath)}`)

  if (result.exitCode === 1) {
    return `No matches found for pattern \`${pattern}\` in ${dirPath}`
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `grep failed with exit code ${result.exitCode}`)
  }

  const lines = result.stdout.trim().split('\n')
  const limited = maxResults ? lines.slice(0, maxResults) : lines

  let output = limited.join('\n')
  if (maxResults && lines.length > maxResults) {
    output += `\n\n(${lines.length - maxResults} more results truncated)`
  }

  return output
}

async function handleGlob(
  sandbox: Sandbox,
  dirPath: string,
  pattern: string,
  maxResults: number | undefined
): Promise<string> {
  const flag = pattern.includes('/') ? '-path' : '-name'
  const result = await sandbox.execute(`find ${shellQuote(dirPath)} ${flag} ${shellQuote(pattern)}`)

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `find failed with exit code ${result.exitCode}`)
  }

  const paths = result.stdout.trim().split('\n').filter(Boolean)

  if (paths.length === 0) {
    return `No files found matching pattern \`${pattern}\` in ${dirPath}`
  }

  const limited = maxResults ? paths.slice(0, maxResults) : paths

  let output = limited.join('\n')
  if (maxResults && paths.length > maxResults) {
    output += `\n\n(${paths.length - maxResults} more results truncated)`
  }

  return output
}

/**
 * Handles the undo command.
 */
async function handleUndo(sandbox: Sandbox, undoMap: Map<string, string>, filePath: string): Promise<string> {
  const previous = undoMap.get(filePath)

  if (previous === undefined) {
    throw new Error(`Nothing to undo for ${filePath}`)
  }

  await sandbox.writeText(filePath, previous)
  undoMap.delete(filePath)

  return `Reverted: ${filePath}`
}
