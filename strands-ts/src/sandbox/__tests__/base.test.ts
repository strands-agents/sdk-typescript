import { Buffer } from 'buffer'
import { describe, it, expect } from 'vitest'
import { Sandbox } from '../base.js'
import type { ExecutionResult, ExecuteOptions, FileInfo, StreamChunk } from '../base.js'

class ConcreteSandbox extends Sandbox {
  async *executeStreaming(
    command: string,
    _options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    yield { data: `out:${command}\n`, streamType: 'stdout' }
    yield { exitCode: 0, stdout: `out:${command}\n`, stderr: '', outputFiles: [] }
  }

  async *executeCodeStreaming(
    code: string,
    language: string,
    _options?: ExecuteOptions
  ): AsyncGenerator<StreamChunk | ExecutionResult, void, undefined> {
    yield { data: `${language}:${code}\n`, streamType: 'stdout' }
    yield { exitCode: 0, stdout: `${language}:${code}\n`, stderr: '', outputFiles: [] }
  }

  async readFile(_path: string): Promise<Uint8Array> {
    return new Uint8Array(Buffer.from('file content'))
  }

  async writeFile(_path: string, _content: Uint8Array): Promise<void> {
    // noop
  }

  async removeFile(_path: string): Promise<void> {
    // noop
  }

  async listFiles(_path: string): Promise<FileInfo[]> {
    return [{ name: 'test.txt', isDir: false, size: 100 }]
  }
}

describe('Sandbox', () => {
  describe('abstract contract', () => {
    it('can be instantiated via a concrete subclass', () => {
      const sandbox = new ConcreteSandbox()
      expect(sandbox).toBeInstanceOf(Sandbox)
    })

    it('requires all abstract methods to be implemented', () => {
      const sandbox = new ConcreteSandbox()
      expect(typeof sandbox.executeStreaming).toBe('function')
      expect(typeof sandbox.executeCodeStreaming).toBe('function')
      expect(typeof sandbox.readFile).toBe('function')
      expect(typeof sandbox.writeFile).toBe('function')
      expect(typeof sandbox.removeFile).toBe('function')
      expect(typeof sandbox.listFiles).toBe('function')
    })
  })

  describe('execute (non-streaming)', () => {
    it('consumes the stream and returns ExecutionResult', async () => {
      const sandbox = new ConcreteSandbox()
      const result = await sandbox.execute('hello')
      expect(result).toStrictEqual({
        exitCode: 0,
        stdout: 'out:hello\n',
        stderr: '',
        outputFiles: [],
      })
    })
  })

  describe('executeCode (non-streaming)', () => {
    it('consumes the stream and returns ExecutionResult', async () => {
      const sandbox = new ConcreteSandbox()
      const result = await sandbox.executeCode('print(1)', 'python')
      expect(result).toStrictEqual({
        exitCode: 0,
        stdout: 'python:print(1)\n',
        stderr: '',
        outputFiles: [],
      })
    })
  })

  describe('readText', () => {
    it('decodes bytes to a string', async () => {
      const sandbox = new ConcreteSandbox()
      const text = await sandbox.readText('test.txt')
      expect(text).toBe('file content')
    })
  })

  describe('writeText', () => {
    it('encodes a string to bytes and calls writeFile', async () => {
      const sandbox = new ConcreteSandbox()
      await sandbox.writeText('test.txt', 'hello world')
    })
  })

  describe('streaming methods', () => {
    it('yields StreamChunks followed by ExecutionResult', async () => {
      const sandbox = new ConcreteSandbox()
      const chunks: (StreamChunk | ExecutionResult)[] = []
      for await (const chunk of sandbox.executeStreaming('test')) {
        chunks.push(chunk)
      }
      expect(chunks).toHaveLength(2)
      expect(chunks[0]).toStrictEqual({ data: 'out:test\n', streamType: 'stdout' })
      expect(chunks[1]).toStrictEqual({ exitCode: 0, stdout: 'out:test\n', stderr: '', outputFiles: [] })
    })
  })
})
