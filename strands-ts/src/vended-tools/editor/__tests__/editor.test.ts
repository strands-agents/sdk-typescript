import { describe, it, expect, vi, afterEach } from 'vitest'
import { editor } from '../index.js'
import type { ToolContext } from '../../../tools/tool.js'
import { createMockAgent } from '../../../__fixtures__/agent-helpers.js'
import type { Sandbox, FileInfo } from '../../../sandbox/base.js'

function createMockSandbox(overrides?: Partial<Sandbox>): Sandbox {
  return {
    executeStreaming: vi.fn(async function* () {}),

    executeCodeStreaming: vi.fn(async function* () {}),
    execute: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', outputFiles: [] })),
    executeCode: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', outputFiles: [] })),
    readFile: vi.fn(async () => new TextEncoder().encode('line1\nline2\nline3\n')),
    writeFile: vi.fn(async () => {}),
    removeFile: vi.fn(async () => {}),
    listFiles: vi.fn(async () => {
      throw new Error('ENOENT: not a directory')
    }),
    readText: vi.fn(async () => 'line1\nline2\nline3\n'),
    writeText: vi.fn(async () => {}),
    ...overrides,
  } as unknown as Sandbox
}

function createTestContext(sandboxOverrides?: Partial<Sandbox>) {
  const sandbox = createMockSandbox(sandboxOverrides)
  const agent = createMockAgent({ extra: { sandbox } as Record<string, unknown> })
  const context: ToolContext = { toolUse: { name: 'editor', toolUseId: 'test-id', input: {} }, agent }
  return { context, sandbox, appState: agent.appState }
}

describe('editor tool', () => {
  afterEach(() => vi.restoreAllMocks())

  describe('view command', () => {
    it('views file content with line numbers', async () => {
      const { context } = createTestContext()
      const result = await editor.invoke({ command: 'view', path: '/tmp/test.txt' }, context)
      expect(result).toContain('cat -n')
      expect(result).toContain('line1')
    })

    it('views file with line range', async () => {
      const { context } = createTestContext({
        readFile: vi.fn(async () => new TextEncoder().encode('a\nb\nc\nd\ne\n')),
      })
      const result = await editor.invoke({ command: 'view', path: '/tmp/test.txt', view_range: [2, 4] }, context)
      expect(result).toContain('b')
      expect(result).toContain('d')
    })

    it('views file with -1 end range', async () => {
      const { context } = createTestContext({
        readFile: vi.fn(async () => new TextEncoder().encode('a\nb\nc\nd\ne')),
      })
      const result = await editor.invoke({ command: 'view', path: '/tmp/test.txt', view_range: [3, -1] }, context)
      expect(result).toContain('c')
      expect(result).toContain('e')
    })

    it('lists directory contents', async () => {
      const { context } = createTestContext({
        listFiles: vi.fn(
          async () =>
            [
              { name: 'file.ts', isDir: false },
              { name: 'src', isDir: true },
            ] satisfies FileInfo[]
        ),
      })
      const result = await editor.invoke({ command: 'view', path: '/tmp/project' }, context)
      expect(result).toContain('file.ts')
      expect(result).toContain('src/')
    })

    it('rejects view_range on directory', async () => {
      const { context } = createTestContext({
        listFiles: vi.fn(async () => [{ name: 'file.ts' }] satisfies FileInfo[]),
      })
      const result = await editor.invoke({ command: 'view', path: '/tmp/project', view_range: [1, 5] }, context)
      expect(result).toContain('Error')
    })

    it('returns error for non-existent file', async () => {
      const { context } = createTestContext({
        readFile: vi.fn(async () => {
          throw new Error('ENOENT')
        }),
      })
      const result = await editor.invoke({ command: 'view', path: '/tmp/missing.txt' }, context)
      expect(result).toContain('Error')
      expect(result).toContain('does not exist')
    })

    it('validates view_range bounds', async () => {
      const { context } = createTestContext({
        readFile: vi.fn(async () => new TextEncoder().encode('a\nb\nc')),
      })
      const result = await editor.invoke({ command: 'view', path: '/tmp/test.txt', view_range: [0, 2] }, context)
      expect(result).toContain('Error')
    })
  })

  describe('create command', () => {
    it('creates a new file', async () => {
      const { context, sandbox } = createTestContext({
        readFile: vi.fn(async () => {
          throw new Error('ENOENT')
        }),
      })
      const result = await editor.invoke({ command: 'create', path: '/tmp/new.txt', file_text: 'hello' }, context)
      expect(result).toContain('File created successfully')
      expect(sandbox.writeFile).toHaveBeenCalled()
    })

    it('fails when file already exists', async () => {
      const { context } = createTestContext()
      const result = await editor.invoke(
        { command: 'create', path: '/tmp/existing.txt', file_text: 'content' },
        context
      )
      expect(result).toContain('Error')
      expect(result).toContain('already exists')
    })

    it('requires file_text parameter', async () => {
      const { context } = createTestContext()
      const result = await editor.invoke({ command: 'create', path: '/tmp/new.txt' }, context)
      expect(result).toContain('Error')
      expect(result).toContain('file_text')
    })
  })

  describe('str_replace command', () => {
    it('replaces unique string occurrence', async () => {
      const { context, sandbox } = createTestContext({
        readFile: vi.fn(async () => new TextEncoder().encode('hello world\n')),
      })
      const result = await editor.invoke(
        { command: 'str_replace', path: '/tmp/test.txt', old_str: 'hello', new_str: 'goodbye' },
        context
      )
      expect(result).toContain('has been edited')
      expect(sandbox.writeFile).toHaveBeenCalled()
    })

    it('fails when old_str not found', async () => {
      const { context } = createTestContext({
        readFile: vi.fn(async () => new TextEncoder().encode('hello world\n')),
      })
      const result = await editor.invoke(
        { command: 'str_replace', path: '/tmp/test.txt', old_str: 'missing', new_str: 'x' },
        context
      )
      expect(result).toContain('Error')
      expect(result).toContain('did not appear')
    })

    it('fails when old_str has multiple occurrences', async () => {
      const { context } = createTestContext({
        readFile: vi.fn(async () => new TextEncoder().encode('foo bar foo\n')),
      })
      const result = await editor.invoke(
        { command: 'str_replace', path: '/tmp/test.txt', old_str: 'foo', new_str: 'baz' },
        context
      )
      expect(result).toContain('Error')
      expect(result).toContain('Multiple occurrences')
    })

    it('requires old_str parameter', async () => {
      const { context } = createTestContext()
      const result = await editor.invoke({ command: 'str_replace', path: '/tmp/test.txt' }, context)
      expect(result).toContain('Error')
      expect(result).toContain('old_str')
    })
  })

  describe('insert command', () => {
    it('inserts text at line number', async () => {
      const { context, sandbox } = createTestContext({
        readFile: vi.fn(async () => new TextEncoder().encode('line1\nline2\n')),
      })
      const result = await editor.invoke(
        { command: 'insert', path: '/tmp/test.txt', insert_line: 1, new_str: 'inserted' },
        context
      )
      expect(result).toContain('has been edited')
      expect(sandbox.writeFile).toHaveBeenCalled()
    })

    it('validates insert_line bounds', async () => {
      const { context } = createTestContext({
        readFile: vi.fn(async () => new TextEncoder().encode('line1\nline2\n')),
      })
      const result = await editor.invoke(
        { command: 'insert', path: '/tmp/test.txt', insert_line: 99, new_str: 'text' },
        context
      )
      expect(result).toContain('Error')
      expect(result).toContain('Invalid')
    })

    it('requires insert_line parameter', async () => {
      const { context } = createTestContext()
      const result = await editor.invoke({ command: 'insert', path: '/tmp/test.txt', new_str: 'text' }, context)
      expect(result).toContain('Error')
      expect(result).toContain('insert_line')
    })
  })

  describe('undo_edit command', () => {
    it('reverts last edit', async () => {
      const { context, sandbox, appState } = createTestContext({
        readFile: vi.fn(async () => new TextEncoder().encode('modified content')),
      })
      appState.set('_strands_editor_undo', { '/tmp/test.txt': 'original content' })
      const result = await editor.invoke({ command: 'undo_edit', path: '/tmp/test.txt' }, context)
      expect(result).toContain('Successfully reverted')
      expect(sandbox.writeFile).toHaveBeenCalled()
    })

    it('returns error when no edit history', async () => {
      const { context } = createTestContext()
      const result = await editor.invoke({ command: 'undo_edit', path: '/tmp/no-history.txt' }, context)
      expect(result).toContain('Error')
      expect(result).toContain('No edit history')
    })
  })

  describe('path validation', () => {
    it('allows relative paths by default', async () => {
      const { context } = createTestContext()
      const result = await editor.invoke({ command: 'view', path: 'relative/path.txt' }, context)
      expect(result).not.toContain('not an absolute path')
    })

    it('rejects relative paths when configured', async () => {
      const { context, appState } = createTestContext()
      appState.set('strands_editor_tool', { requireAbsolutePaths: true })
      const result = await editor.invoke({ command: 'view', path: 'relative/path.txt' }, context)
      expect(result).toContain('Error')
      expect(result).toContain('not an absolute path')
    })

    it('rejects path traversal when configured', async () => {
      const { context, appState } = createTestContext()
      appState.set('strands_editor_tool', { requireAbsolutePaths: true })
      const result = await editor.invoke({ command: 'view', path: '/tmp/../etc/passwd' }, context)
      expect(result).toContain('Error')
      expect(result).toContain('Path traversal')
    })
  })

  describe('error handling', () => {
    it('throws when no context provided', async () => {
      await expect(editor.invoke({ command: 'view', path: '/tmp/test.txt' })).rejects.toThrow(
        'Tool context is required'
      )
    })
  })
})
