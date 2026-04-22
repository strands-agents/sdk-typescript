import { describe, it, expect, vi } from 'vitest'
import { ShellBasedSandbox } from '../shell-based.js'
import type { ExecutionResult, ExecuteOptions, StreamChunk } from '../base.js'
import { Sandbox } from '../base.js'

/**
 * Concrete test subclass that implements only executeStreaming.
 * Records commands for assertion.
 */
class TestShellSandbox extends ShellBasedSandbox {
  readonly commands: string[] = []
  exitCode = 0
  stdout = ''
  stderr = ''

  async *executeStreaming(
    command: string,
    _options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    this.commands.push(command)
    yield { data: this.stdout, streamType: 'stdout' }
    yield { exitCode: this.exitCode, stdout: this.stdout, stderr: this.stderr, outputFiles: [] }
  }
}

describe('ShellBasedSandbox', () => {
  describe('class hierarchy', () => {
    it('extends Sandbox', () => {
      const sandbox = new TestShellSandbox()
      expect(sandbox).toBeInstanceOf(Sandbox)
      expect(sandbox).toBeInstanceOf(ShellBasedSandbox)
    })
  })

  describe('executeCodeStreaming', () => {
    it('delegates to executeStreaming with shell-quoted command', async () => {
      const sandbox = new TestShellSandbox()
      sandbox.stdout = 'hello\n'

      const chunks: (StreamChunk | ExecutionResult)[] = []
      for await (const chunk of sandbox.executeCodeStreaming('print("hello")', 'python')) {
        chunks.push(chunk)
      }

      expect(sandbox.commands).toHaveLength(1)
      expect(sandbox.commands[0]).toContain("'python'")
      expect(sandbox.commands[0]).toContain('-c')
    })

    it('passes options through to executeStreaming', async () => {
      const sandbox = new TestShellSandbox()
      const executeSpy = vi.spyOn(sandbox, 'executeStreaming')

      const chunks: (StreamChunk | ExecutionResult)[] = []
      for await (const chunk of sandbox.executeCodeStreaming('code', 'node', { timeout: 30, cwd: '/tmp' })) {
        chunks.push(chunk)
      }

      expect(executeSpy).toHaveBeenCalledWith(expect.any(String), { timeout: 30, cwd: '/tmp' })
    })
  })

  describe('readFile', () => {
    it('uses base64 encoding for safe binary transport', async () => {
      const sandbox = new TestShellSandbox()
      // base64 of "hello world"
      sandbox.stdout = 'aGVsbG8gd29ybGQ=\n'

      const data = await sandbox.readFile('/tmp/test.txt')
      const text = new TextDecoder().decode(data)
      expect(text).toBe('hello world')
      expect(sandbox.commands[0]).toContain('base64')
      expect(sandbox.commands[0]).toContain("'/tmp/test.txt'")
    })

    it('throws on non-zero exit code', async () => {
      const sandbox = new TestShellSandbox()
      sandbox.exitCode = 1
      sandbox.stderr = 'No such file'

      await expect(sandbox.readFile('/nope')).rejects.toThrow('No such file')
    })
  })

  describe('writeFile', () => {
    it('uses base64 encoding and mkdir -p', async () => {
      const sandbox = new TestShellSandbox()
      const content = new TextEncoder().encode('hello')

      await sandbox.writeFile('/tmp/dir/file.txt', content)

      expect(sandbox.commands[0]).toContain('mkdir -p')
      expect(sandbox.commands[0]).toContain('base64 -d')
    })

    it('throws on non-zero exit code', async () => {
      const sandbox = new TestShellSandbox()
      sandbox.exitCode = 1
      sandbox.stderr = 'Permission denied'

      await expect(sandbox.writeFile('/nope', new Uint8Array([1]))).rejects.toThrow('Permission denied')
    })
  })

  describe('removeFile', () => {
    it('uses rm with shell-quoted path', async () => {
      const sandbox = new TestShellSandbox()
      await sandbox.removeFile('/tmp/file.txt')
      expect(sandbox.commands[0]).toBe("rm '/tmp/file.txt'")
    })

    it('throws on non-zero exit code', async () => {
      const sandbox = new TestShellSandbox()
      sandbox.exitCode = 1
      sandbox.stderr = 'No such file'

      await expect(sandbox.removeFile('/nope')).rejects.toThrow('No such file')
    })
  })

  describe('listFiles', () => {
    it('parses ls -1aF output into FileInfo entries', async () => {
      const sandbox = new TestShellSandbox()
      sandbox.stdout = '.\n..\nfile.txt\ndir/\nscript.sh*\nlink@\n'

      const entries = await sandbox.listFiles('/tmp')
      expect(entries).toStrictEqual([
        { name: 'file.txt', isDir: false },
        { name: 'dir', isDir: true },
        { name: 'script.sh', isDir: false },
        { name: 'link', isDir: false },
      ])
    })

    it('throws on non-zero exit code', async () => {
      const sandbox = new TestShellSandbox()
      sandbox.exitCode = 1
      sandbox.stderr = 'No such directory'

      await expect(sandbox.listFiles('/nope')).rejects.toThrow('No such directory')
    })
  })
})
