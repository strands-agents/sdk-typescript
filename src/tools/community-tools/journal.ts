import { FunctionTool } from '../function-tool.js'
import type { JSONValue } from '../../types/json.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

const JOURNAL_DIR = 'journal'

interface JournalInput {
  action: 'write' | 'read' | 'list' | 'addTask'
  content?: string
  date?: string
  task?: string
}

function successResult(text: string): JSONValue {
  return { status: 'success', content: [{ text }] }
}

function errorResult(text: string): JSONValue {
  return { status: 'error', content: [{ text }] }
}

function ensureJournalDir(cwd: string): string {
  const dir = path.join(cwd, JOURNAL_DIR)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getJournalPath(cwd: string, dateStr: string | undefined): string {
  const date = dateStr ?? new Date().toISOString().slice(0, 10)
  const dir = ensureJournalDir(cwd)
  return path.join(dir, `${date}.md`)
}

function runJournal(input: JournalInput, cwd: string): JSONValue {
  const action = input.action
  if (!action) {
    return errorResult('Missing required field: action')
  }
  switch (action) {
    case 'write': {
      const content = input.content
      if (content == null || content === '') {
        return errorResult('Content is required for write action')
      }
      const filePath = getJournalPath(cwd, input.date)
      const timestamp = new Date().toTimeString().slice(0, 8)
      const line = `\n## ${timestamp}\n${content}\n`
      fs.appendFileSync(filePath, line)
      return successResult(`Added entry to journal: ${filePath}`)
    }
    case 'read': {
      const filePath = getJournalPath(cwd, input.date)
      if (!fs.existsSync(filePath)) {
        return errorResult(`No journal found for date: ${path.basename(filePath, '.md')}`)
      }
      const content = fs.readFileSync(filePath, 'utf-8')
      return successResult(content)
    }
    case 'list': {
      const dir = ensureJournalDir(cwd)
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .sort()
      if (files.length === 0) {
        return successResult('No journal entries found')
      }
      const entries = files.map((f) => {
        const filePath = path.join(dir, f)
        const content = fs.readFileSync(filePath, 'utf-8')
        const entryCount = (content.match(/^## /gm) ?? []).length
        const taskCount = (content.match(/- \[ \]/g) ?? []).length
        return `${path.basename(f, '.md')}: ${entryCount} entries, ${taskCount} tasks`
      })
      return successResult(entries.join('\n'))
    }
    case 'addTask': {
      const task = input.task
      if (task == null || task === '') {
        return errorResult('Task is required for addTask action')
      }
      const filePath = getJournalPath(cwd, input.date)
      const timestamp = new Date().toTimeString().slice(0, 8)
      const line = `\n## ${timestamp} - Task\n- [ ] ${task}\n`
      fs.appendFileSync(filePath, line)
      return successResult(`Added task to journal: ${filePath}`)
    }
    default:
      return errorResult(`Unknown action: ${String(action)}`)
  }
}

export const journal = new FunctionTool({
  name: 'journal',
  description: 'Create and manage daily journal entries with tasks and notes. Actions: write, read, list, addTask.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['write', 'read', 'list', 'addTask'],
        description: 'Action to perform',
      },
      content: { type: 'string', description: 'Content for write action' },
      date: { type: 'string', description: 'Date YYYY-MM-DD (default: today)' },
      task: { type: 'string', description: 'Task description for addTask action' },
    },
    required: ['action'],
  },
  callback: (input: unknown): JSONValue => {
    const cwd = globalThis?.process?.cwd() ?? '.'
    return runJournal((input ?? {}) as JournalInput, cwd)
  },
})
