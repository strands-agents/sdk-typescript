import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileWrite } from '../file-write.js'
import { createMockToolContext, runToolStream, getToolResultText } from './test-helpers.js'

describe('file_write tool', () => {
  const tmpDir = path.join(os.tmpdir(), 'file-write-test-' + Date.now())

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true })
    }
  })

  describe('properties', () => {
    it('has correct name and description', () => {
      expect(fileWrite.name).toBe('file_write')
      expect(fileWrite.description).toContain('Write')
      const schema = fileWrite.toolSpec.inputSchema as { required?: string[] } | undefined
      expect(schema?.required).toContain('path')
      expect(schema?.required).toContain('content')
    })
  })

  describe('validation', () => {
    it('returns error when path is missing', async () => {
      const ctx = createMockToolContext('file_write', { content: 'data' })
      const block = await runToolStream(fileWrite, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Missing required field: path')
    })

    it('returns error when content is missing', async () => {
      const ctx = createMockToolContext('file_write', { path: '/tmp/test.txt' })
      const block = await runToolStream(fileWrite, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Missing required field: content')
    })
  })

  describe('execution', () => {
    it('writes a file successfully', async () => {
      const filePath = path.join(tmpDir, 'output.txt')
      const ctx = createMockToolContext('file_write', { path: filePath, content: 'Hello!' })
      const block = await runToolStream(fileWrite, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Wrote 6 characters')
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('Hello!')
    })

    it('creates parent directories', async () => {
      const filePath = path.join(tmpDir, 'nested', 'dir', 'file.txt')
      const ctx = createMockToolContext('file_write', { path: filePath, content: 'nested content' })
      const block = await runToolStream(fileWrite, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Wrote')
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('nested content')
    })

    it('appends to file when append is true', async () => {
      const filePath = path.join(tmpDir, 'append.txt')
      fs.mkdirSync(tmpDir, { recursive: true })
      fs.writeFileSync(filePath, 'Hello')

      const ctx = createMockToolContext('file_write', { path: filePath, content: ' World', append: true })
      const block = await runToolStream(fileWrite, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Appended')
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('Hello World')
    })

    it('overwrites existing file by default', async () => {
      const filePath = path.join(tmpDir, 'overwrite.txt')
      fs.mkdirSync(tmpDir, { recursive: true })
      fs.writeFileSync(filePath, 'old content')

      const ctx = createMockToolContext('file_write', { path: filePath, content: 'new content' })
      await runToolStream(fileWrite, ctx)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('new content')
    })
  })
})
