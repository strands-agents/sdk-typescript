import { describe, it, expect } from 'vitest'
import { bash } from '../vended_tools/bash/bash.js'

// Environment detection - using typeof check since we can't import from fixtures in integ tests
const isNode = typeof process !== 'undefined' && typeof process.versions !== 'undefined' && !!process.versions.node

// Simple AgentState and ToolContext definition for integration tests
class AgentState {
  private _state: Record<string, unknown> = {}

  set(key: string, value: unknown): void {
    this._state[key] = value
  }

  get(key: string): unknown {
    return this._state[key]
  }
}

interface ToolContext {
  toolUse: {
    name: string
    toolUseId: string
    input: Record<string, unknown>
  }
  agent: { state: AgentState }
}

// Skip all tests if not in Node.js environment
describe.skipIf(!isNode)('bash tool integration', () => {
  // Helper to create fresh context
  const createFreshContext = (): { state: AgentState; context: ToolContext } => {
    const state = new AgentState()
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

  describe('basic execution', () => {
    it('executes simple echo command', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: 'echo "Hello from bash"' }, context)

      expect(result.output).toContain('Hello from bash')
      expect(result.error).toBe('')
    })

    it('captures stdout correctly', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: 'echo "line1"; echo "line2"' }, context)

      expect(result.output).toContain('line1')
      expect(result.output).toContain('line2')
      expect(result.error).toBe('')
    })

    it('captures stderr correctly', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: 'echo "error message" >&2' }, context)

      expect(result.error).toContain('error message')
    })

    it('executes multiple commands in sequence', async () => {
      const { context } = createFreshContext()

      const result1 = await bash.invoke({ mode: 'execute', command: 'echo "first"' }, context)
      expect(result1.output).toContain('first')

      const result2 = await bash.invoke({ mode: 'execute', command: 'echo "second"' }, context)
      expect(result2.output).toContain('second')
    })

    it('executes command with piping', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: 'echo "hello world" | wc -w' }, context)

      expect(result.output).toContain('2')
      expect(result.error).toBe('')
    })
  })

  describe('session persistence', () => {
    it('persists variables across commands', async () => {
      const { context } = createFreshContext()

      // Set a variable
      const setResult = await bash.invoke({ mode: 'execute', command: 'TEST_VAR="hello"' }, context)
      expect(setResult.error).toBe('')

      // Read the variable
      const getResult = await bash.invoke({ mode: 'execute', command: 'echo $TEST_VAR' }, context)
      expect(getResult.output).toContain('hello')
    })

    it('persists directory changes', async () => {
      const { context } = createFreshContext()

      // Change to temp directory
      await bash.invoke({ mode: 'execute', command: 'cd /tmp' }, context)

      // Check current directory
      const result = await bash.invoke({ mode: 'execute', command: 'pwd' }, context)
      expect(result.output).toContain('/tmp')
    })

    it('persists functions across commands', async () => {
      const { context } = createFreshContext()

      // Define a function
      await bash.invoke({ mode: 'execute', command: 'greet() { echo "Hello $1"; }' }, context)

      // Call the function
      const result = await bash.invoke({ mode: 'execute', command: 'greet "World"' }, context)
      expect(result.output).toContain('Hello World')
    })
  })

  describe('restart functionality', () => {
    it('clears session state on restart', async () => {
      const { context } = createFreshContext()

      // Set a variable
      await bash.invoke({ mode: 'execute', command: 'RESTART_VAR="exists"' }, context)

      // Verify it exists
      const beforeRestart = await bash.invoke({ mode: 'execute', command: 'echo $RESTART_VAR' }, context)
      expect(beforeRestart.output).toContain('exists')

      // Restart session
      const restartResult = await bash.invoke({ mode: 'restart' }, context)
      expect(restartResult).toBe('Bash session restarted')

      // Verify variable is gone
      const afterRestart = await bash.invoke({ mode: 'execute', command: 'echo $RESTART_VAR' }, context)
      expect(afterRestart.output).not.toContain('exists')
    })

    it('resets working directory on restart', async () => {
      const { context } = createFreshContext()
      const originalCwd = process.cwd()

      // Change directory
      await bash.invoke({ mode: 'execute', command: 'cd /tmp' }, context)

      // Restart
      await bash.invoke({ mode: 'restart' }, context)

      // Check directory is reset
      const result = await bash.invoke({ mode: 'execute', command: 'pwd' }, context)
      expect(result.output).toContain(originalCwd)
    })
  })

  describe('error scenarios', () => {
    it('handles command that does not exist', async () => {
      const { context } = createFreshContext()
      const result = await bash.invoke({ mode: 'execute', command: 'nonexistent_command_xyz' }, context)

      // Should capture error in stderr
      expect(result.error).toContain('not found')
    })
  })

  describe('working directory', () => {
    it('starts in process.cwd()', async () => {
      const { context } = createFreshContext()
      const expectedCwd = process.cwd()

      const result = await bash.invoke({ mode: 'execute', command: 'pwd' }, context)

      expect(result.output).toContain(expectedCwd)
    })

    it('allows cd commands', async () => {
      const { context } = createFreshContext()

      await bash.invoke({ mode: 'execute', command: 'cd /tmp' }, context)

      const result = await bash.invoke({ mode: 'execute', command: 'pwd' }, context)

      expect(result.output).toContain('/tmp')
    })
  })

  describe('isolated sessions', () => {
    it('provides separate sessions for different agents', async () => {
      const { context: context1 } = createFreshContext()
      const { context: context2 } = createFreshContext()

      // Set variable in first agent
      await bash.invoke({ mode: 'execute', command: 'AGENT_VAR="agent1"' }, context1)

      // Try to read it in second agent (should not exist)
      const result = await bash.invoke({ mode: 'execute', command: 'echo $AGENT_VAR' }, context2)

      // Variable should not be present in second agent
      expect(result.output).not.toContain('agent1')
    })
  })
})
