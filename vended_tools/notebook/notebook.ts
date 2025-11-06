import { tool } from '../../src/tools/zod-tool.js'
import { z } from 'zod'
import type { NotebookState } from './types.js'

/**
 * Zod schema for notebook input validation.
 */
const notebookInputSchema = z
  .object({
    mode: z.enum(['create', 'list', 'read', 'write', 'clear']),
    name: z.string().optional(),
    newStr: z.string().optional(),
    readRange: z.tuple([z.number(), z.number()]).optional(),
    oldStr: z.string().optional(),
    insertLine: z.union([z.string(), z.number()]).optional(),
  })
  .refine(
    (data) => {
      // Validate write mode requirements
      if (data.mode === 'write') {
        const hasReplacement = data.oldStr !== undefined && data.newStr !== undefined
        const hasInsertion = data.insertLine !== undefined && data.newStr !== undefined
        return hasReplacement || hasInsertion
      }
      return true
    },
    {
      message:
        'Write operation requires either (oldStr + newStr) for replacement or (insertLine + newStr) for insertion',
    }
  )

/**
 * Notebook tool for managing persistent text notebooks.
 *
 * Notebooks are stored in `invocationState.notebooks` and persist within an agent session.
 * Supports create, list, read, write (replace/insert), and clear operations.
 *
 * @example
 * ```typescript
 * // With agent
 * const agent = new Agent({ tools: [notebook] })
 * await agent.invoke('Create a notebook called "notes"')
 * await agent.invoke('Add "- Task 1" to notes')
 *
 * // Direct usage
 * await notebook.invoke(
 *   { mode: 'create', name: 'notes', newStr: '# Notes' },
 *   { invocationState: state }
 * )
 * ```
 */
export const notebook = tool({
  name: 'notebook',
  description:
    'Manages text notebooks for note-taking and documentation. Supports create, list, read, write (replace or insert), and clear operations. Notebooks persist within the agent invocation.',
  inputSchema: notebookInputSchema,
  callback: (input, context) => {
    if (!context) {
      throw new Error('Tool context is required for notebook operations')
    }

    // Initialize notebooks if not present or empty
    if (!context.invocationState.notebooks) {
      context.invocationState.notebooks = {}
    }

    const notebooks = context.invocationState.notebooks as NotebookState['notebooks']

    // Ensure default notebook exists
    if (Object.keys(notebooks).length === 0) {
      notebooks.default = ''
    }

    switch (input.mode) {
      case 'create':
        return handleCreate(notebooks, input.name ?? 'default', input.newStr)

      case 'list':
        return handleList(notebooks)

      case 'read':
        return handleRead(notebooks, input.name ?? 'default', input.readRange)

      case 'write':
        return handleWrite(notebooks, input.name ?? 'default', input.oldStr, input.newStr, input.insertLine)

      case 'clear':
        return handleClear(notebooks, input.name ?? 'default')

      default:
        throw new Error(`Unknown mode: ${input.mode}`)
    }
  },
})

/**
 * Handles create operation.
 */
function handleCreate(notebooks: Record<string, string>, name: string, newStr?: string): string {
  notebooks[name] = newStr ?? ''
  const message = `Created notebook '${name}'${newStr ? ' with specified content' : ' (empty)'}`
  return message
}

/**
 * Handles list operation.
 */
function handleList(notebooks: Record<string, string>): string {
  const notebookNames = Object.keys(notebooks)
  const details = notebookNames
    .map((name) => {
      const lineCount = notebooks[name] ? notebooks[name].split('\n').length : 0
      const status = lineCount === 0 ? 'Empty' : `${lineCount} lines`
      return `- ${name}: ${status}`
    })
    .join('\n')

  return `Available notebooks:\n${details}`
}

/**
 * Handles read operation.
 */
function handleRead(notebooks: Record<string, string>, name: string, readRange?: [number, number]): string {
  if (!(name in notebooks)) {
    throw new Error(`Notebook '${name}' not found`)
  }

  const content = notebooks[name]!

  if (!readRange) {
    return content || `Notebook '${name}' is empty`
  }

  // Handle line range reading
  const lines = content.split('\n')
  let [start, end] = readRange

  // Handle negative indices
  if (start < 0) {
    start = lines.length + start + 1
  }
  if (end < 0) {
    end = lines.length + end + 1
  }

  const selectedLines: string[] = []
  for (let lineNum = start; lineNum <= end; lineNum++) {
    if (lineNum >= 1 && lineNum <= lines.length) {
      selectedLines.push(`${lineNum}: ${lines[lineNum - 1]}`)
    }
  }

  return selectedLines.length > 0 ? selectedLines.join('\n') : 'No valid lines found in range'
}

/**
 * Handles write operation (both string replacement and line insertion).
 */
function handleWrite(
  notebooks: Record<string, string>,
  name: string,
  oldStr?: string,
  newStr?: string,
  insertLine?: string | number
): string {
  if (!(name in notebooks)) {
    throw new Error(`Notebook '${name}' not found`)
  }

  // String replacement mode
  if (oldStr !== undefined && newStr !== undefined) {
    if (!notebooks[name]!.includes(oldStr)) {
      throw new Error(`String '${oldStr}' not found in notebook '${name}'`)
    }

    notebooks[name] = notebooks[name]!.replace(oldStr, newStr)
    return `Replaced text in notebook '${name}'`
  }

  // Line insertion mode
  if (insertLine !== undefined && newStr !== undefined) {
    const lines = notebooks[name]!.split('\n')
    let lineNum: number

    // Handle string search
    if (typeof insertLine === 'string') {
      lineNum = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes(insertLine)) {
          lineNum = i
          break
        }
      }
      if (lineNum === -1) {
        throw new Error(`Text '${insertLine}' not found in notebook '${name}'`)
      }
    } else {
      // Handle numeric index with negative support
      if (insertLine < 0) {
        lineNum = lines.length + insertLine
      } else {
        lineNum = insertLine - 1
      }
    }

    // Validate line number range (allow -1 for prepending before first line)
    if (lineNum < -1 || lineNum > lines.length) {
      throw new Error(`Line number out of range`)
    }

    // Insert at the calculated position
    lines.splice(lineNum + 1, 0, newStr)
    const updatedContent = lines.join('\n')
    Object.assign(notebooks, { [name]: updatedContent })

    return `Inserted text at line ${lineNum + 2} in notebook '${name}'`
  }

  throw new Error('Invalid write operation')
}

/**
 * Handles clear operation.
 */
function handleClear(notebooks: Record<string, string>, name: string): string {
  const notebook = notebooks[name]
  if (notebook === undefined) {
    throw new Error(`Notebook '${name}' not found`)
  }

  notebooks[name] = ''
  return `Cleared notebook '${name}'`
}
