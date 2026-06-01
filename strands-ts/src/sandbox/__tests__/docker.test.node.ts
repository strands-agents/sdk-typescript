import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DockerSandbox } from '../docker.js'
import { streamProcess } from '../stream-process.js'
import type { ExecutionResult } from '../types.js'

const OK: ExecutionResult = { type: 'executionResult', exitCode: 0, stdout: '', stderr: '', outputFiles: [] }

vi.mock('../stream-process.js', () => ({
  streamProcess: vi.fn(async function* () {
    yield OK
  }),
}))

describe('DockerSandbox', () => {
  beforeEach(() => {
    vi.mocked(streamProcess).mockClear()
  })

  it('defaults user to 1000:1000', async () => {
    const sandbox = new DockerSandbox({ containerId: 'c' })
    await sandbox.execute('x')

    const args = vi.mocked(streamProcess).mock.calls[0]![1]
    expect(args[args.indexOf('--user') + 1]).toBe('1000:1000')
  })

  it('defaults workingDir to /tmp', async () => {
    const sandbox = new DockerSandbox({ containerId: 'c' })
    await sandbox.execute('x')

    const args = vi.mocked(streamProcess).mock.calls[0]![1]
    expect(args[args.indexOf('-w') + 1]).toBe('/tmp')
  })

  it('cwd option overrides workingDir', async () => {
    const sandbox = new DockerSandbox({ containerId: 'c', workingDir: '/app' })
    await sandbox.execute('x', { cwd: '/override' })

    const args = vi.mocked(streamProcess).mock.calls[0]![1]
    expect(args[args.indexOf('-w') + 1]).toBe('/override')
  })
})
