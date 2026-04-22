import { describe, it, expect, vi, afterEach } from 'vitest'
import { pythonRepl } from '../index.js'
import type { ToolContext } from '../../../tools/tool.js'
import { createMockAgent } from '../../../__fixtures__/agent-helpers.js'
import type { ExecutionResult, StreamChunk, Sandbox } from '../../../sandbox/base.js'

function createMockSandbox(overrides?: Partial<Sandbox>): Sandbox {
  return {
    executeStreaming: vi.fn(async function* () {}),
    executeCodeStreaming: vi.fn(async function* () {
      yield { data: 'hello\n', streamType: 'stdout' } satisfies StreamChunk
      yield { exitCode: 0, stdout: 'hello\n', stderr: '', outputFiles: [] } satisfies ExecutionResult
    }),
    execute: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', outputFiles: [] })),
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
  const context: ToolContext = { toolUse: { name: 'python_repl', toolUseId: 'test-id', input: {} }, agent }
  return { context, sandbox, appState: agent.appState }
}

describe('pythonRepl tool', () => {
  afterEach(() => vi.restoreAllMocks())

  describe('basic execution', () => {
    it('executes Python code via sandbox', async () => {
      const { context, sandbox } = createTestContext()
      const result = await pythonRepl.invoke({ code: 'print("hello")' }, context)
      expect(sandbox.executeCodeStreaming).toHaveBeenCalledWith('print("hello")', 'python', { timeout: 30 })
      expect(result).toContain('hello')
    })

    it('returns (no output) for empty result', async () => {
      const { context } = createTestContext({
        executeCodeStreaming: vi.fn(async function* () {
          yield { exitCode: 0, stdout: '', stderr: '', outputFiles: [] } satisfies ExecutionResult
        }),
      })
      const result = await pythonRepl.invoke({ code: 'pass' }, context)
      expect(result).toBe('(no output)')
    })

    it('includes exit code on failure', async () => {
      const { context } = createTestContext({
        executeCodeStreaming: vi.fn(async function* () {
          yield {
            exitCode: 1,
            stdout: '',
            stderr: 'SyntaxError: invalid syntax',
            outputFiles: [],
          } satisfies ExecutionResult
        }),
      })
      const result = await pythonRepl.invoke({ code: 'def(' }, context)
      expect(result).toContain('SyntaxError')
      expect(result).toContain('Exit code: 1')
    })

    it('combines stdout and stderr', async () => {
      const { context } = createTestContext({
        executeCodeStreaming: vi.fn(async function* () {
          yield { exitCode: 0, stdout: 'out', stderr: 'warn', outputFiles: [] } satisfies ExecutionResult
        }),
      })
      const result = await pythonRepl.invoke({ code: 'code' }, context)
      expect(result).toContain('out')
      expect(result).toContain('warn')
    })
  })

  describe('output files', () => {
    it('reports generated files', async () => {
      const { context } = createTestContext({
        executeCodeStreaming: vi.fn(async function* () {
          yield {
            exitCode: 0,
            stdout: 'plot done',
            stderr: '',
            outputFiles: [{ name: 'chart.png', content: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }],
          } satisfies ExecutionResult
        }),
      })
      const result = await pythonRepl.invoke({ code: 'import matplotlib' }, context)
      expect(result).toContain('Generated files: chart.png')
    })
  })

  describe('timeout handling', () => {
    it('uses default timeout of 30s', async () => {
      const { context, sandbox } = createTestContext()
      await pythonRepl.invoke({ code: 'pass' }, context)
      expect(sandbox.executeCodeStreaming).toHaveBeenCalledWith(
        'pass',
        'python',
        expect.objectContaining({ timeout: 30 })
      )
    })

    it('uses per-call timeout', async () => {
      const { context, sandbox } = createTestContext()
      await pythonRepl.invoke({ code: 'pass', timeout: 60 }, context)
      expect(sandbox.executeCodeStreaming).toHaveBeenCalledWith(
        'pass',
        'python',
        expect.objectContaining({ timeout: 60 })
      )
    })

    it('uses config timeout', async () => {
      const { context, sandbox, appState } = createTestContext()
      appState.set('strands_python_repl_tool', { timeout: 45 })
      await pythonRepl.invoke({ code: 'pass' }, context)
      expect(sandbox.executeCodeStreaming).toHaveBeenCalledWith(
        'pass',
        'python',
        expect.objectContaining({ timeout: 45 })
      )
    })
  })

  describe('reset', () => {
    it('resets REPL state', async () => {
      const { context, appState } = createTestContext()
      appState.set('_strands_python_repl_state', { some: 'state' })
      const result = await pythonRepl.invoke({ code: '', reset: true }, context)
      expect(result).toBe('Python REPL state reset.')
      expect(appState.get('_strands_python_repl_state')).toBeUndefined()
    })

    it('resets and runs code', async () => {
      const { context } = createTestContext()
      const result = await pythonRepl.invoke({ code: 'print("hello")', reset: true }, context)
      expect(result).toContain('hello')
    })
  })

  describe('error handling', () => {
    it('handles sandbox not returning result', async () => {
      const { context } = createTestContext({
        executeCodeStreaming: vi.fn(async function* () {
          /* intentionally empty */
        }),
      })
      const result = await pythonRepl.invoke({ code: 'pass' }, context)
      expect(result).toContain('Error')
    })

    it('handles sandbox errors gracefully', async () => {
      const { context } = createTestContext({
        executeCodeStreaming: vi.fn(
          // eslint-disable-next-line require-yield
          async function* () {
            throw new Error('Sandbox disconnected')
          }
        ),
      })
      const result = await pythonRepl.invoke({ code: 'pass' }, context)
      expect(result).toContain('Error: Sandbox disconnected')
    })

    it('throws when no context provided', async () => {
      await expect(pythonRepl.invoke({ code: 'pass' })).rejects.toThrow('Tool context is required')
    })
  })

  describe('input validation', () => {
    it('rejects negative timeout', async () => {
      const { context } = createTestContext()
      await expect(pythonRepl.invoke({ code: 'pass', timeout: -1 }, context)).rejects.toThrow()
    })
  })
})
