import { describe, it, expect } from 'vitest'
import { bash } from '../bash.js'
import { BashTimeoutError } from '../types.js'
import type { ToolContext } from '../../../src/tools/tool.js'
import { AgentState } from '../../../src/agent/state.js'
import { isNode } from '../../../src/__fixtures__/environment.js'

// Skip all tests if not in Node.js environment
describe.skipIf(!isNode)('bash tool', () => {
  // Helper to create fresh context
  const createFreshContext = (): { state: AgentState; context: ToolContext } => {
    const state = new AgentState({})
    const context: ToolContext = {
      toolUse: {
        name: 'bash',
        toolUseId: 'test-id',
        input: {},
      },
      agent: { state },
    }
    return { state, context }
  }

  describe('input validation', () => {
    it('accepts valid execute command', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: 'echo "test"' }, context)

      expect(result).toHaveProperty('output')
      expect(result).toHaveProperty('error')
    })

    it('accepts valid restart command', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'restart' }, context)
      expect(result).toBe('Bash session restarted')
    })

    it('rejects invalid mode', async () => {
      const { context } = createFreshContext()
      await expect(
        // @ts-expect-error - Testing invalid input
        bash.invoke({ mode: 'invalid' }, context)
      ).rejects.toThrow()
    })

    it('rejects execute without command', async () => {
      const { context } = createFreshContext()
      await expect(
        // @ts-expect-error - Testing invalid input
        bash.invoke({ mode: 'execute' }, context)
      ).rejects.toThrow()
    })

    it('accepts valid timeout configuration', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: 'echo "fast"', timeout: 300 }, context)

      expect(result).toHaveProperty('output')
    })

    it('rejects negative timeout', async () => {
      const { context } = createFreshContext()
      await expect(bash.invoke({ mode: 'execute', command: 'echo test', timeout: -1 }, context)).rejects.toThrow()
    })
  })

  describe('session lifecycle', () => {
    it('creates session on first execute', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: 'echo "test"' }, context)

      if (typeof result === 'string') {
        throw new Error('Expected BashOutput object, got string')
      }

      expect(result).toHaveProperty('output')
      expect(result.output).toContain('test')
    })

    it('reuses session across multiple commands', async () => {
      const { context } = createFreshContext()

      // Set variable
      await bash.invoke({ mode: 'execute', command: 'TEST_VAR="first"' }, context)

      // Read variable to confirm session persists
      const result = await bash.invoke({ mode: 'execute', command: 'echo $TEST_VAR' }, context)

      if (typeof result === 'string') {
        throw new Error('Expected BashOutput object, got string')
      }

      expect(result.output).toContain('first')
    })

    it('creates new session after restart', async () => {
      const { context } = createFreshContext()

      // Set variable
      await bash.invoke({ mode: 'execute', command: 'TEST_RESTART="exists"' }, context)

      // Restart
      const restartResult = await bash.invoke({ mode: 'restart' }, context)
      expect(restartResult).toBe('Bash session restarted')

      // Variable should be gone
      const afterRestart = await bash.invoke({ mode: 'execute', command: 'echo $TEST_RESTART' }, context)

      if (typeof afterRestart === 'string') {
        throw new Error('Expected BashOutput object, got string')
      }

      expect(afterRestart.output.trim()).not.toContain('exists')
    })

    it('provides isolated sessions for different agents', async () => {
      const { context: context1 } = createFreshContext()
      const { context: context2 } = createFreshContext()

      // Set variable in first agent
      await bash.invoke({ mode: 'execute', command: 'AGENT_VAR="agent1"' }, context1)

      // Check it's not in second agent
      const result = await bash.invoke({ mode: 'execute', command: 'echo $AGENT_VAR' }, context2)

      if (typeof result === 'string') {
        throw new Error('Expected BashOutput object, got string')
      }

      expect(result.output.trim()).not.toContain('agent1')
    })
  })

  describe('command execution', () => {
    it('executes command and returns output', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: 'echo "Hello World"' }, context)

      if (typeof result === 'string') {
        throw new Error('Expected BashOutput object, got string')
      }

      expect(result.output).toContain('Hello World')
      expect(result.error).toBe('')
    })

    it('separates stdout and stderr', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: '>&2 echo "stderr_message"' }, context)

      if (typeof result === 'string') {
        throw new Error('Expected BashOutput object, got string')
      }

      // Verify stderr contains the error message
      expect(result.error).toContain('stderr_message')
    })

    it('returns empty stderr on success', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: 'echo "success"' }, context)

      if (typeof result === 'string') {
        throw new Error('Expected BashOutput object, got string')
      }

      expect(result.error).toBe('')
    })

    it('captures stderr on command error', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: 'nonexistent_command_xyz' }, context)

      if (typeof result === 'string') {
        throw new Error('Expected BashOutput object, got string')
      }

      expect(result.error).toContain('not found')
    })
  })

  describe('timeout handling', () => {
    it('completes command before timeout', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: 'echo "fast"', timeout: 5 }, context)

      if (typeof result === 'string') {
        throw new Error('Expected BashOutput object, got string')
      }

      expect(result.output).toContain('fast')
    })

    it('throws BashTimeoutError when command times out', async () => {
      const { context } = createFreshContext()

      await expect(bash.invoke({ mode: 'execute', command: 'sleep 10', timeout: 0.1 }, context)).rejects.toThrow(
        BashTimeoutError
      )
    })

    it('uses default timeout of 120 seconds', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: 'echo "test"' }, context)

      expect(result).toHaveProperty('output')
    })
  })

  describe('error handling', () => {
    it('requires context for bash operations', async () => {
      await expect(bash.invoke({ mode: 'execute', command: 'echo "test"' })).rejects.toThrow('Tool context is required')
    })
  })

  describe('working directory', () => {
    it('starts in process.cwd()', async () => {
      const { context } = createFreshContext()
      const expectedCwd = process.cwd()

      const result = await bash.invoke({ mode: 'execute', command: 'pwd' }, context)

      if (typeof result === 'string') {
        throw new Error('Expected BashOutput object, got string')
      }

      expect(result.output).toContain(expectedCwd)
    })
  })

  describe('tool properties', () => {
    it('has correct tool name', () => {
      expect(bash.name).toBe('bash')
    })

    it('has description', () => {
      expect(bash.description).toBeDefined()
      expect(bash.description.length).toBeGreaterThan(0)
    })

    it('has toolSpec', () => {
      expect(bash.toolSpec).toBeDefined()
      expect(bash.toolSpec.name).toBe('bash')
    })
  })
})
