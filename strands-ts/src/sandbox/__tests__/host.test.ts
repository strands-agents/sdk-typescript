import { Buffer } from 'buffer'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { HostSandbox } from '../host.js'
import type { StreamChunk, ExecutionResult } from '../base.js'
import { Sandbox } from '../base.js'

describe('HostSandbox', () => {
  let workDir: string
  let sandbox: HostSandbox

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'sandbox-test-'))
    sandbox = new HostSandbox({ workingDir: workDir })
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  describe('constructor', () => {
    it('extends Sandbox', () => {
      expect(sandbox).toBeInstanceOf(Sandbox)
    })

    it('uses provided workingDir', () => {
      expect(sandbox.workingDir).toBe(workDir)
    })

    it('defaults to process.cwd() when no config', () => {
      const defaultSandbox = new HostSandbox()
      expect(defaultSandbox.workingDir).toBe(process.cwd())
    })
  })

  describe('execute', () => {
    it('runs a shell command and returns stdout', async () => {
      const result = await sandbox.execute('echo hello')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello')
      expect(result.stderr).toBe('')
    })

    it('captures stderr', async () => {
      const result = await sandbox.execute('echo error >&2')
      expect(result.exitCode).toBe(0)
      expect(result.stderr.trim()).toBe('error')
    })

    it('returns non-zero exit code on failure', async () => {
      const result = await sandbox.execute('exit 42')
      expect(result.exitCode).toBe(42)
    })

    it('uses sandbox working directory', async () => {
      const result = await sandbox.execute('pwd')
      expect(result.stdout.trim()).toBe(workDir)
    })

    it('uses cwd option when provided', async () => {
      const subDir = join(workDir, 'subdir')
      mkdirSync(subDir)
      const result = await sandbox.execute('pwd', { cwd: subDir })
      expect(result.stdout.trim()).toBe(subDir)
    })
  })

  describe('executeStreaming', () => {
    it('yields StreamChunks then ExecutionResult', async () => {
      const chunks: (StreamChunk | ExecutionResult)[] = []
      for await (const chunk of sandbox.executeStreaming('echo hello')) {
        chunks.push(chunk)
      }

      const streamChunks = chunks.filter((c): c is StreamChunk => 'streamType' in c)
      const results = chunks.filter((c): c is ExecutionResult => 'exitCode' in c)

      expect(streamChunks.length).toBeGreaterThan(0)
      expect(results).toHaveLength(1)
      expect(results[0]!.exitCode).toBe(0)
      expect(results[0]!.stdout.trim()).toBe('hello')
    })

    it('distinguishes stdout and stderr', async () => {
      const chunks: StreamChunk[] = []
      for await (const chunk of sandbox.executeStreaming('echo out && echo err >&2')) {
        if ('streamType' in chunk) {
          chunks.push(chunk)
        }
      }

      const stdoutChunks = chunks.filter((c) => c.streamType === 'stdout')
      const stderrChunks = chunks.filter((c) => c.streamType === 'stderr')

      expect(stdoutChunks.length).toBeGreaterThan(0)
      expect(stderrChunks.length).toBeGreaterThan(0)
    })
  })

  describe('executeCode', () => {
    it('runs code and returns result', async () => {
      const result = await sandbox.executeCode('print("hello from python")', 'python3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello from python')
    })

    it('rejects unsafe language names', async () => {
      await expect(sandbox.executeCode('code', 'python; rm -rf /')).rejects.toThrow(
        'language parameter contains unsafe characters'
      )
    })

    it('returns exit code 127 for missing interpreter', async () => {
      const result = await sandbox.executeCode('code', 'nonexistent_lang_xyz')
      expect(result.exitCode).toBe(127)
      expect(result.stderr).toContain('Language interpreter not found')
    })
  })

  describe('file operations', () => {
    it('writes and reads a file', async () => {
      const content = Buffer.from('hello world')
      await sandbox.writeFile('test.txt', new Uint8Array(content))
      const read = await sandbox.readFile('test.txt')
      expect(Buffer.from(read).toString()).toBe('hello world')
    })

    it('writes and reads text', async () => {
      await sandbox.writeText('test.txt', 'hello text')
      const text = await sandbox.readText('test.txt')
      expect(text).toBe('hello text')
    })

    it('creates parent directories on write', async () => {
      await sandbox.writeFile('deep/nested/dir/test.txt', new Uint8Array(Buffer.from('deep')))
      const read = await sandbox.readFile('deep/nested/dir/test.txt')
      expect(Buffer.from(read).toString()).toBe('deep')
    })

    it('removes a file', async () => {
      await sandbox.writeFile('removeme.txt', new Uint8Array(Buffer.from('delete this')))
      await sandbox.removeFile('removeme.txt')
      await expect(sandbox.readFile('removeme.txt')).rejects.toThrow()
    })

    it('throws on reading nonexistent file', async () => {
      await expect(sandbox.readFile('nonexistent.txt')).rejects.toThrow()
    })

    it('handles binary data roundtrip', async () => {
      const bytes = new Uint8Array([0, 1, 127, 128, 255])
      await sandbox.writeFile('binary.bin', bytes)
      const read = await sandbox.readFile('binary.bin')
      expect(Array.from(read)).toStrictEqual([0, 1, 127, 128, 255])
    })
  })

  describe('listFiles', () => {
    it('lists files with metadata', async () => {
      writeFileSync(join(workDir, 'a.txt'), 'content')
      mkdirSync(join(workDir, 'subdir'))

      const files = await sandbox.listFiles('.')
      const fileNames = files.map((f) => f.name)

      expect(fileNames).toContain('a.txt')
      expect(fileNames).toContain('subdir')

      const fileEntry = files.find((f) => f.name === 'a.txt')
      expect(fileEntry!.isDir).toBe(false)
      expect(fileEntry!.size).toBeGreaterThan(0)

      const dirEntry = files.find((f) => f.name === 'subdir')
      expect(dirEntry!.isDir).toBe(true)
    })

    it('returns sorted results', async () => {
      writeFileSync(join(workDir, 'c.txt'), '')
      writeFileSync(join(workDir, 'a.txt'), '')
      writeFileSync(join(workDir, 'b.txt'), '')

      const files = await sandbox.listFiles('.')
      const names = files.map((f) => f.name)
      expect(names).toStrictEqual([...names].sort())
    })

    it('includes hidden files', async () => {
      writeFileSync(join(workDir, '.hidden'), '')
      writeFileSync(join(workDir, 'visible.txt'), '')

      const files = await sandbox.listFiles('.')
      const names = files.map((f) => f.name)
      expect(names).toContain('.hidden')
    })
  })
})
