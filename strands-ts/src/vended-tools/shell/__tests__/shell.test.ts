import { describe, it, expect, vi, afterEach } from 'vitest'
import { shell } from '../index.js'
import type { ToolContext } from '../../../tools/tool.js'
import { createMockAgent } from '../../../__fixtures__/agent-helpers.js'
import type { ExecutionResult, StreamChunk, Sandbox } from '../../../sandbox/base.js'

function createMockSandbox(overrides?: Partial<Sandbox>): Sandbox {
  return {
    executeStreaming: vi.fn(async function* () {
      yield { data: 'output\n', streamType: 'stdout' } satisfies StreamChunk
      yield { exitCode: 0, stdout: 'output\n', stderr: '', outputFiles: [] } satisfies ExecutionResult
    }),

    executeCodeStreaming: vi.fn(async function* () {}),
    execute: vi.fn(async () => ({ exitCode: 0, stdout: '/home/user\n', stderr: '', outputFiles: [] })),
    executeCode: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', outputFiles: [] })),
    readFile: vi.fn(async () => new Uint8Array()),
    writeFile: vi.fn(async () => {}),
    removeFile: vi.fn(async () => {}),
    listFiles: vi.fn(async () => []),
    readText: vi.fn(async () => ''),
    writeText: vi.fn(async () => {}),
    ...overrides,
  } as unknown as Sandbox
}

function createTestContext(sandboxOverrides?: Partial<Sandbox>) {
  const sandbox = createMockSandbox(sandboxOverrides)
  const agent = createMockAgent({ extra: { sandbox } as Record<string, unknown> })
  const context: ToolContext = { toolUse: { name: 'shell', toolUseId: 'test-id', input: {} }, agent }
  return { context, sandbox, appState: agent.appState }
}

describe('shell tool', () => {
  afterEach(() => vi.restoreAllMocks())

  describe('basic execution', () => {
    it('executes a command via sandbox', async () => {
      const { context, sandbox } = createTestContext()
      const result = await shell.invoke({ command: 'echo hello' }, context)
      expect(sandbox.executeStreaming).toHaveBeenCalled()
      expect(result).toContain('output')
    })

    it('returns (no output) for empty result', async () => {
      const { context } = createTestContext({
        executeStreaming: vi.fn(async function* () {
          yield { exitCode: 0, stdout: '', stderr: '', outputFiles: [] } satisfies ExecutionResult
        }),
      })
      const result = await shell.invoke({ command: 'true' }, context)
      expect(result).toBe('(no output)')
    })

    it('includes exit code on failure', async () => {
      const { context } = createTestContext({
        executeStreaming: vi.fn(async function* () {
          yield { exitCode: 1, stdout: '', stderr: 'not found', outputFiles: [] } satisfies ExecutionResult
        }),
      })
      const result = await shell.invoke({ command: 'bad-cmd' }, context)
      expect(result).toContain('not found')
      expect(result).toContain('Exit code: 1')
    })

    it('combines stdout and stderr', async () => {
      const { context } = createTestContext({
        executeStreaming: vi.fn(async function* () {
          yield { exitCode: 0, stdout: 'out', stderr: 'err', outputFiles: [] } satisfies ExecutionResult
        }),
      })
      const result = await shell.invoke({ command: 'cmd' }, context)
      expect(result).toContain('out')
      expect(result).toContain('err')
    })
  })

  describe('timeout handling', () => {
    it('uses per-call timeout', async () => {
      const { context, sandbox } = createTestContext()
      await shell.invoke({ command: 'echo hi', timeout: 30 }, context)
      expect(sandbox.executeStreaming).toHaveBeenCalledWith('echo hi', expect.objectContaining({ timeout: 30 }))
    })

    it('uses config timeout when no per-call timeout', async () => {
      const { context, sandbox, appState } = createTestContext()
      appState.set('strands_shell_tool', { timeout: 60 })
      await shell.invoke({ command: 'echo hi' }, context)
      expect(sandbox.executeStreaming).toHaveBeenCalledWith('echo hi', expect.objectContaining({ timeout: 60 }))
    })

    it('per-call timeout overrides config', async () => {
      const { context, sandbox, appState } = createTestContext()
      appState.set('strands_shell_tool', { timeout: 60 })
      await shell.invoke({ command: 'echo hi', timeout: 10 }, context)
      expect(sandbox.executeStreaming).toHaveBeenCalledWith('echo hi', expect.objectContaining({ timeout: 10 }))
    })
  })

  describe('restart', () => {
    it('clears shell state on restart', async () => {
      const { context, appState } = createTestContext()
      appState.set('_strands_shell_state', { cwd: '/tmp' })
      const result = await shell.invoke({ command: '', restart: true }, context)
      expect(result).toBe('Shell state reset.')
      expect(appState.get('_strands_shell_state')).toBeUndefined()
    })

    it('clears state and runs command on restart with command', async () => {
      const { context } = createTestContext()
      const result = await shell.invoke({ command: 'ls', restart: true }, context)
      expect(result).toContain('output')
    })
  })

  describe('working directory tracking', () => {
    it('tracks cwd from pwd result', async () => {
      const { context, appState } = createTestContext()
      await shell.invoke({ command: 'cd /tmp' }, context)
      const shellState = appState.get('_strands_shell_state') as { cwd?: string }
      expect(shellState?.cwd).toBe('/home/user')
    })

    it('passes tracked cwd to execute', async () => {
      const { context, sandbox, appState } = createTestContext()
      appState.set('_strands_shell_state', { cwd: '/tmp/workspace' })
      await shell.invoke({ command: 'ls' }, context)
      expect(sandbox.executeStreaming).toHaveBeenCalledWith('ls', expect.objectContaining({ cwd: '/tmp/workspace' }))
    })
  })

  describe('error handling', () => {
    it('handles sandbox not returning result', async () => {
      const { context } = createTestContext({
        executeStreaming: vi.fn(async function* () {
          /* intentionally empty */
        }),
      })
      const result = await shell.invoke({ command: 'echo test' }, context)
      expect(result).toContain('Error')
    })

    it('handles sandbox errors gracefully', async () => {
      const { context } = createTestContext({
        executeStreaming: vi.fn(
          // eslint-disable-next-line require-yield
          async function* () {
            throw new Error('Connection refused')
          }
        ),
      })
      const result = await shell.invoke({ command: 'echo test' }, context)
      expect(result).toContain('Error: Connection refused')
    })

    it('throws when no context provided', async () => {
      await expect(shell.invoke({ command: 'echo test' })).rejects.toThrow('Tool context is required')
    })
  })

  describe('input validation', () => {
    it('accepts valid command', async () => {
      const { context } = createTestContext()
      const result = await shell.invoke({ command: 'echo "hello"' }, context)
      expect(result).toBeDefined()
    })

    it('rejects negative timeout', async () => {
      const { context } = createTestContext()
      await expect(shell.invoke({ command: 'echo test', timeout: -1 }, context)).rejects.toThrow()
    })
  })
})
