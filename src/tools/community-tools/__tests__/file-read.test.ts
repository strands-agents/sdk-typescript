import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileRead } from '../file-read.js'
import { createMockToolContext, runToolStream, getToolResultText } from './test-helpers.js'

describe('file_read tool', () => {
  const tmpDir = path.join(os.tmpdir(), 'file-read-test-' + Date.now())

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true })
    }
  })

  describe('properties', () => {
    it('has correct name and description', () => {
      expect(fileRead.name).toBe('file_read')
      expect(fileRead.description).toContain('Read')
      const schema = fileRead.toolSpec.inputSchema as { required?: string[] } | undefined
      expect(schema?.required).toContain('path')
    })
  })

  describe('validation', () => {
    it('returns error when path is missing', async () => {
      const ctx = createMockToolContext('file_read', {})
      const block = await runToolStream(fileRead, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Missing required field: path')
    })

    it('returns error when file does not exist', async () => {
      const ctx = createMockToolContext('file_read', { path: '/tmp/nonexistent-file-xyz.txt' })
      const block = await runToolStream(fileRead, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('File not found')
    })
  })

  describe('execution', () => {
    it('reads a file successfully', async () => {
      fs.mkdirSync(tmpDir, { recursive: true })
      const filePath = path.join(tmpDir, 'test.txt')
      fs.writeFileSync(filePath, 'Hello, World!')

      const ctx = createMockToolContext('file_read', { path: filePath })
      const block = await runToolStream(fileRead, ctx)
      const text = getToolResultText(block)
      expect(text).toBe('Hello, World!')
    })

    it('returns error for directories', async () => {
      fs.mkdirSync(tmpDir, { recursive: true })

      const ctx = createMockToolContext('file_read', { path: tmpDir })
      const block = await runToolStream(fileRead, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Not a file')
    })
  })
})
