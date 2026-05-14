import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RemoteSandbox } from '../remote.js'
import * as childProcess from 'child_process'

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('child_process')
  return { ...actual, spawn: vi.fn() }
})

function createMockProcess() {
  const proc = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  }

  // Simulate immediate close with exit code 0
  proc.on.mockImplementation((event: string, cb: (code: number | null) => void) => {
    if (event === 'close') {
      // Schedule the close callback
      Promise.resolve().then(() => cb(0))
    }
  })

  return proc
}

describe('RemoteSandbox (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('stores host and workingDir', () => {
      const sandbox = new RemoteSandbox({ host: 'myhost', workingDir: '/workspace' })
      expect(sandbox.host).toBe('myhost')
      expect(sandbox.workingDir).toBe('/workspace')
    })

    it('defaults port to 22', () => {
      const sandbox = new RemoteSandbox({ host: 'myhost', workingDir: '/ws' })
      // Port is private but we can verify via the SSH args in stream()
      expect(sandbox).toBeDefined()
    })
  })

  describe('stream() SSH argument construction', () => {
    it('builds correct SSH args with defaults', async () => {
      const mockProc = createMockProcess()
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as never)

      const sandbox = new RemoteSandbox({ host: 'user@server.com', workingDir: '/remote/path' })

      // Start consuming the generator to trigger spawn
      const gen = sandbox.executeStreaming('echo hi')
      const iter = gen[Symbol.asyncIterator]()
      await iter.next()

      expect(childProcess.spawn).toHaveBeenCalledWith('ssh', [
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        'BatchMode=yes',
        '-p',
        '22',
        'user@server.com',
        "cd '/remote/path' && echo hi",
      ])
    })

    it('includes identity file when provided', async () => {
      const mockProc = createMockProcess()
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as never)

      const sandbox = new RemoteSandbox({
        host: 'server',
        workingDir: '/ws',
        identityFile: '/home/user/.ssh/key',
      })

      const gen = sandbox.executeStreaming('ls')
      const iter = gen[Symbol.asyncIterator]()
      await iter.next()

      const args = vi.mocked(childProcess.spawn).mock.calls[0]![1] as string[]
      expect(args).toContain('-i')
      expect(args).toContain('/home/user/.ssh/key')
    })

    it('uses custom port', async () => {
      const mockProc = createMockProcess()
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as never)

      const sandbox = new RemoteSandbox({
        host: 'server',
        workingDir: '/ws',
        port: 2222,
      })

      const gen = sandbox.executeStreaming('ls')
      const iter = gen[Symbol.asyncIterator]()
      await iter.next()

      const args = vi.mocked(childProcess.spawn).mock.calls[0]![1] as string[]
      expect(args).toContain('-p')
      expect(args).toContain('2222')
    })

    it('quotes cwd with single quotes', async () => {
      const mockProc = createMockProcess()
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as never)

      const sandbox = new RemoteSandbox({
        host: 'server',
        workingDir: "/path/with spaces/and'quotes",
      })

      const gen = sandbox.executeStreaming('ls')
      const iter = gen[Symbol.asyncIterator]()
      await iter.next()

      const args = vi.mocked(childProcess.spawn).mock.calls[0]![1] as string[]
      const remoteCommand = args[args.length - 1]
      expect(remoteCommand).toContain("cd '/path/with spaces/and'\\''quotes'")
    })

    it('uses cwd option when provided', async () => {
      const mockProc = createMockProcess()
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as never)

      const sandbox = new RemoteSandbox({ host: 'server', workingDir: '/default' })

      const gen = sandbox.executeStreaming('ls', { cwd: '/override' })
      const iter = gen[Symbol.asyncIterator]()
      await iter.next()

      const args = vi.mocked(childProcess.spawn).mock.calls[0]![1] as string[]
      const remoteCommand = args[args.length - 1]
      expect(remoteCommand).toContain("cd '/override'")
    })
  })

  describe('start()', () => {
    it('creates working directory with cwd: /', async () => {
      const mockProc = createMockProcess()
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as never)

      const sandbox = new RemoteSandbox({ host: 'server', workingDir: '/my/workspace' })
      await sandbox.start()

      const args = vi.mocked(childProcess.spawn).mock.calls[0]![1] as string[]
      const remoteCommand = args[args.length - 1]
      expect(remoteCommand).toContain("cd '/'")
      expect(remoteCommand).toContain("mkdir -p '/my/workspace'")
    })
  })
})
