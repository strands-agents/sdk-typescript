import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { codeInterpreter } from '../code-interpreter.js'
import { NotASandboxLocalEnvironment } from '../../../sandbox/not-a-sandbox-local-environment.js'
import { TestSandbox } from '../../../__fixtures__/test-sandbox.node.js'
import type { Sandbox } from '../../../sandbox/base.js'
import type { ToolContext } from '../../../tools/tool.js'
import { createMockAgent } from '../../../__fixtures__/agent-helpers.js'
import { execSync } from 'child_process'
import { realpathSync } from 'fs'

const TEST_DIR = '/tmp/strands-test-code-interpreter-tool'

function createContext(sandbox: Sandbox): ToolContext {
  const agent = createMockAgent({ sandbox })
  return {
    toolUse: { name: 'codeInterpreter', toolUseId: 'test-id', input: {} },
    agent,
    invocationState: {},
    interrupt: () => {
      throw new Error('not implemented')
    },
  }
}

describe.skipIf(process.platform === 'win32')('codeInterpreter tool', () => {
  beforeEach(() => {
    execSync(`rm -rf ${TEST_DIR} && mkdir -p ${TEST_DIR}`)
  })

  afterEach(() => {
    execSync(`rm -rf ${TEST_DIR}`)
  })

  describe('normal mode (NotASandboxLocalEnvironment)', () => {
    it('executes python code', async () => {
      const context = createContext(new NotASandboxLocalEnvironment())
      const result = await codeInterpreter.invoke({ code: 'print(2 + 2)', language: 'python3' }, context)
      expect(result.stdout).toBe('4\n')
      expect(result.exitCode).toBe(0)
    })

    it('returns exit code on syntax error', async () => {
      const context = createContext(new NotASandboxLocalEnvironment())
      const result = await codeInterpreter.invoke({ code: 'def broken(', language: 'python3' }, context)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('SyntaxError')
    })

    it('returns exit code 127 for unknown language', async () => {
      const context = createContext(new NotASandboxLocalEnvironment())
      const result = await codeInterpreter.invoke({ code: 'x', language: 'nonexistent_lang_xyz' }, context)
      expect(result.exitCode).toBe(127)
    })

    it('throws without context', async () => {
      await expect(codeInterpreter.invoke({ code: 'print(1)', language: 'python3' })).rejects.toThrow(
        'Tool context is required'
      )
    })
  })

  describe('sandbox mode (TestSandbox)', () => {
    it('executes code within the sandbox working directory', async () => {
      const sandbox = new TestSandbox(TEST_DIR)
      const context = createContext(sandbox)
      const result = await codeInterpreter.invoke(
        { code: 'import os; print(os.getcwd())', language: 'python3' },
        context
      )
      expect(result.stdout.trim()).toBe(realpathSync(TEST_DIR))
    })

    it('respects workdir relative to sandbox', async () => {
      execSync(`mkdir -p ${TEST_DIR}/subdir`)
      const sandbox = new TestSandbox(TEST_DIR)
      const context = createContext(sandbox)
      const result = await codeInterpreter.invoke(
        { code: 'import os; print(os.getcwd())', language: 'python3', workdir: `${TEST_DIR}/subdir` },
        context
      )
      expect(result.stdout.trim()).toBe(realpathSync(`${TEST_DIR}/subdir`))
    })

    it('files created by code stay within sandbox directory', async () => {
      const sandbox = new TestSandbox(TEST_DIR)
      const context = createContext(sandbox)
      await codeInterpreter.invoke(
        { code: 'open("output.txt", "w").write("from sandbox")', language: 'python3' },
        context
      )
      const check = execSync(`cat ${TEST_DIR}/output.txt`, { encoding: 'utf-8' })
      expect(check).toBe('from sandbox')
    })

    it('passes timeout to sandbox', async () => {
      const sandbox = new TestSandbox(TEST_DIR)
      const context = createContext(sandbox)
      await expect(
        codeInterpreter.invoke({ code: 'import time; time.sleep(10)', language: 'python3', timeout: 0.1 }, context)
      ).rejects.toThrow('timed out')
    })
  })
})
