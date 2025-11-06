import { tool } from '../../src/tools/zod-tool.js'
import { z } from 'zod'
import type { NotebookState } from './types.js'

/**
 * Zod schema for notebook input validation.
 * Uses discriminated union on the 'mode' field for type-safe operation handling.
 */
const notebookInputSchema = z.discriminatedUnion('mode', [
  // Create operation
  z.object({
    mode: z.literal('create'),
    name: z.string().optional(),
    newStr: z.string().optional(),
  }),

  // List operation
  z.object({
    mode: z.literal('list'),
  }),

  // Read operation
  z.object({
    mode: z.literal('read'),
    name: z.string().optional(),
    readRange: z.tuple([z.number(), z.number()]).optional(),
  }),

  // Write operation (either string replacement or line insertion)
  z
    .object({
      mode: z.literal('write'),
      name: z.string().optional(),
      oldStr: z.string().optional(),
      newStr: z.string().optional(),
      insertLine: z.union([z.string(), z.number()]).optional(),
    })
    .refine(
      (data) => {
        // Must have either (oldStr + newStr) or (insertLine + newStr)
        const hasReplacement = data.oldStr !== undefined && data.newStr !== undefined
        const hasInsertion = data.insertLine !== undefined && data.newStr !== undefined
        return hasReplacement || hasInsertion
      },
      {
        message:
          'Write operation requires either (oldStr + newStr) for replacement or (insertLine + newStr) for insertion',
      }
    ),

  // Clear operation
  z.object({
    mode: z.literal('clear'),
    name: z.string().optional(),
  }),
])

/**
 * Notebook tool for managing text notebooks.
 *
 * This tool provides comprehensive notebook operations for creating, reading, writing,
 * listing, and clearing text notebooks. Notebooks are stored in the invocationState
 * and work seamlessly in both browser and server environments.
 *
 * State Management:
 * - Notebooks are stored in `invocationState.notebooks` as a Record\<string, string\>
 * - A 'default' notebook is automatically created if no notebooks exist
 * - All notebooks persist within a single agent invocation
 * - Callers must handle persistence between sessions
 *
 * @example
 * ```typescript
 * import { notebook } from '@strands-agents/sdk/vended_tools/notebook'
 * import { ToolRegistry } from '@strands-agents/sdk'
 *
 * const registry = new ToolRegistry()
 * registry.register(notebook)
 *
 * // Initialize state
 * const state = { notebooks: {} }
 *
 * // Create a notebook
 * await notebook.invoke({ mode: 'create', name: 'notes', newStr: '# My Notes' }, { invocationState: state })
 *
 * // Write to notebook
 * await notebook.invoke({ mode: 'write', name: 'notes', insertLine: -1, newStr: '- New item' }, { invocationState: state })
 *
 * // Read notebook
 * const content = await notebook.invoke({ mode: 'read', name: 'notes' }, { invocationState: state })
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

      default: {
        // This should never happen due to discriminated union, but TypeScript needs it
        // Using never type for exhaustiveness checking
        const _exhaustiveCheck: never = input
        throw new Error(`Unknown mode: ${(_exhaustiveCheck as { mode: string }).mode}`)
      }
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
