import { describe, it, expect } from 'vitest'
import { NoOpSandbox } from '../noop.js'
import { Sandbox } from '../base.js'

describe('NoOpSandbox', () => {
  const sandbox = new NoOpSandbox()

  it('extends Sandbox', () => {
    expect(sandbox).toBeInstanceOf(Sandbox)
  })

  it('throws on executeStreaming', async () => {
    const gen = sandbox.executeStreaming('echo hello')
    await expect(gen.next()).rejects.toThrow('Sandbox is disabled (NoOpSandbox)')
  })

  it('throws on executeCodeStreaming', async () => {
    const gen = sandbox.executeCodeStreaming('print(1)', 'python')
    await expect(gen.next()).rejects.toThrow('Sandbox is disabled (NoOpSandbox)')
  })

  it('throws on execute', async () => {
    await expect(sandbox.execute('echo hello')).rejects.toThrow('Sandbox is disabled (NoOpSandbox)')
  })

  it('throws on executeCode', async () => {
    await expect(sandbox.executeCode('print(1)', 'python')).rejects.toThrow('Sandbox is disabled (NoOpSandbox)')
  })

  it('throws on readFile', async () => {
    await expect(sandbox.readFile('test.txt')).rejects.toThrow('Sandbox is disabled (NoOpSandbox)')
  })

  it('throws on writeFile', async () => {
    await expect(sandbox.writeFile('test.txt', new Uint8Array())).rejects.toThrow('Sandbox is disabled (NoOpSandbox)')
  })

  it('throws on removeFile', async () => {
    await expect(sandbox.removeFile('test.txt')).rejects.toThrow('Sandbox is disabled (NoOpSandbox)')
  })

  it('throws on listFiles', async () => {
    await expect(sandbox.listFiles('.')).rejects.toThrow('Sandbox is disabled (NoOpSandbox)')
  })

  it('throws on readText', async () => {
    await expect(sandbox.readText('test.txt')).rejects.toThrow('Sandbox is disabled (NoOpSandbox)')
  })

  it('throws on writeText', async () => {
    await expect(sandbox.writeText('test.txt', 'content')).rejects.toThrow('Sandbox is disabled (NoOpSandbox)')
  })
})
