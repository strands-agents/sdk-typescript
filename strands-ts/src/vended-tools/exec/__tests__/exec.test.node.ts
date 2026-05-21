import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { exec } from '../exec.js'
import { NotASandboxLocalEnvironment } from '../../../sandbox/not-a-sandbox-local-environment.js'
import { TestSandbox } from '../../../__fixtures__/test-sandbox.node.js'
import type { Sandbox } from '../../../sandbox/base.js'
import type { ToolContext } from '../../../tools/tool.js'
import { createMockAgent } from '../../../__fixtures__/agent-helpers.js'
import { execSync } from 'child_process'
import { existsSync, realpathSync } from 'fs'

const TEST_DIR = '/tmp/strands-test-exec-tool'

function createContext(sandbox: Sandbox): ToolContext {
  const agent = createMockAgent({ sandbox })
  return {
    toolUse: { name: 'exec', toolUseId: 'test-id', input: {} },
    agent,
    invocationState: {},
    interrupt: () => {
      throw new Error('not implemented')
    },
  }
}

describe.skipIf(process.platform === 'win32')('exec tool', () => {
  beforeEach(() => {
    execSync(`rm -rf ${TEST_DIR} && mkdir -p ${TEST_DIR}`)
  })

  afterEach(() => {
    execSync(`rm -rf ${TEST_DIR}`)
  })

  describe('normal mode (NotASandboxLocalEnvironment)', () => {
    it('executes a command', async () => {
      const context = createContext(new NotASandboxLocalEnvironment())
      const result = await exec.invoke({ command: 'echo hello' }, context)
      expect(result.stdout).toBe('hello\n')
      expect(result.exitCode).toBe(0)
    })

    it('captures exit code on failure', async () => {
      const context = createContext(new NotASandboxLocalEnvironment())
      const result = await exec.invoke({ command: 'exit 99' }, context)
      expect(result.exitCode).toBe(99)
    })

    it('throws without context', async () => {
      await expect(exec.invoke({ command: 'echo hi' })).rejects.toThrow('Tool context is required')
    })
  })

  describe('sandbox mode (TestSandbox)', () => {
    it('executes command within sandbox working directory', async () => {
      const context = createContext(new TestSandbox(TEST_DIR))
      const result = await exec.invoke({ command: 'pwd -P' }, context)
      expect(result.stdout.trim()).toBe(realpathSync(TEST_DIR))
    })

    it('files created by command stay in sandbox directory', async () => {
      const context = createContext(new TestSandbox(TEST_DIR))
      await exec.invoke({ command: 'touch created-by-exec.txt' }, context)
      expect(existsSync(`${TEST_DIR}/created-by-exec.txt`)).toBe(true)
    })

    it('respects workdir within sandbox', async () => {
      execSync(`mkdir -p ${TEST_DIR}/subdir`)
      const context = createContext(new TestSandbox(TEST_DIR))
      const result = await exec.invoke({ command: 'pwd -P', workdir: `${TEST_DIR}/subdir` }, context)
      expect(result.stdout.trim()).toBe(realpathSync(`${TEST_DIR}/subdir`))
    })

    it('prevents command injection via workdir', async () => {
      const context = createContext(new TestSandbox(TEST_DIR))
      const result = await exec.invoke({ command: 'echo safe', workdir: '/tmp; echo injected' }, context)
      expect(result.stdout).not.toContain('injected')
      expect(result.exitCode).not.toBe(0)
    })

    it('passes timeout to sandbox', async () => {
      const context = createContext(new TestSandbox(TEST_DIR))
      await expect(exec.invoke({ command: 'sleep 10', timeout: 0.1 }, context)).rejects.toThrow('timed out')
    })

    it('captures stderr', async () => {
      const context = createContext(new TestSandbox(TEST_DIR))
      const result = await exec.invoke({ command: 'echo err >&2' }, context)
      expect(result.stderr).toBe('err\n')
    })
  })
})
