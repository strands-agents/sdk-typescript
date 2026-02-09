import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { journal } from '../journal.js'
import { createMockToolContext, runToolStream, getToolResultText } from './test-helpers.js'

const TEST_DIR = path.join(process.cwd(), 'journal-test-tmp')

describe('journal tool', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true })
    }
    fs.mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true })
    }
  })

  describe('properties', () => {
    it('has correct name and description', () => {
      expect(journal.name).toBe('journal')
      expect(journal.description).toContain('journal')
      expect(journal.toolSpec.inputSchema).toBeDefined()
    })
  })

  describe('with custom cwd', () => {
    const originalCwd = process.cwd()

    beforeEach(() => {
      process.chdir(TEST_DIR)
    })

    afterEach(() => {
      process.chdir(originalCwd)
    })

    it('write creates entry and returns success', async () => {
      const ctx = createMockToolContext('journal', {
        action: 'write',
        content: 'Test entry content',
        date: '2025-02-07',
      })
      const block = await runToolStream(journal, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Added entry')
      expect(text).toContain('2025-02-07')
      const journalPath = path.join(TEST_DIR, 'journal', '2025-02-07.md')
      expect(fs.existsSync(journalPath)).toBe(true)
      expect(fs.readFileSync(journalPath, 'utf-8')).toContain('Test entry content')
    })

    it('read returns content for existing date', async () => {
      const journalDir = path.join(TEST_DIR, 'journal')
      fs.mkdirSync(journalDir, { recursive: true })
      const filePath = path.join(journalDir, '2025-02-07.md')
      fs.writeFileSync(filePath, '## 10:00:00\nExisting content\n')
      const ctx = createMockToolContext('journal', { action: 'read', date: '2025-02-07' })
      const block = await runToolStream(journal, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Existing content')
    })

    it('read returns error for missing date', async () => {
      const ctx = createMockToolContext('journal', { action: 'read', date: '2020-01-01' })
      const block = await runToolStream(journal, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('No journal')
      expect(text).toContain('2020-01-01')
    })

    it('list returns message when no entries', async () => {
      const ctx = createMockToolContext('journal', { action: 'list' })
      const block = await runToolStream(journal, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('No journal entries')
    })

    it('addTask adds task line', async () => {
      const ctx = createMockToolContext('journal', {
        action: 'addTask',
        task: 'Finish tests',
        date: '2025-02-07',
      })
      const block = await runToolStream(journal, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Added task')
      const journalPath = path.join(TEST_DIR, 'journal', '2025-02-07.md')
      expect(fs.readFileSync(journalPath, 'utf-8')).toContain('- [ ] Finish tests')
    })

    it('returns error when action missing', async () => {
      const ctx = createMockToolContext('journal', {})
      const block = await runToolStream(journal, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Missing required field: action')
    })

    it('returns error when write has no content', async () => {
      const ctx = createMockToolContext('journal', { action: 'write' })
      const block = await runToolStream(journal, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Content is required for write action')
    })
  })
})
