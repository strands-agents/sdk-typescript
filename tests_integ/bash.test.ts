/* eslint-disable no-restricted-imports */
import { describe, it, expect } from 'vitest'
import { Agent, BedrockModel } from '../src/index.js'
import { bash } from '../vended_tools/bash/index.js'
import { shouldRunTests } from './__fixtures__/model-test-helpers.js'

describe.skipIf(!(await shouldRunTests()))('Bash Tool Integration', () => {
  // Shared agent configuration for all tests
  const createAgent = () =>
    new Agent({
      model: new BedrockModel({
        region: 'us-east-1',
      }),
      tools: [bash],
    })

  describe('basic execution', () => {
    it('executes simple echo command', async () => {
      const agent = createAgent()
      const result = await agent.invoke('Use bash to echo "Hello from bash"')

      expect(result.lastMessage).toContain('Hello from bash')
    }, 60000)

    it('captures stdout correctly', async () => {
      const agent = createAgent()
      const result = await agent.invoke('Use bash to run: echo "line1" and echo "line2"')

      const lastMessage = result.lastMessage.toLowerCase()
      expect(lastMessage).toContain('line1')
      expect(lastMessage).toContain('line2')
    }, 60000)

    it('captures stderr correctly', async () => {
      const agent = createAgent()
      const result = await agent.invoke('Use bash to run: echo "error" >&2')

      expect(result.lastMessage).toContain('error')
    }, 60000)

    it('executes multiple commands in sequence', async () => {
      const agent = createAgent()
      const result = await agent.invoke('Use bash to: create a variable TEST=hello, then echo it')

      expect(result.lastMessage.toLowerCase()).toContain('hello')
    }, 60000)

    it('executes command with piping', async () => {
      const agent = createAgent()
      const result = await agent.invoke('Use bash to count .ts files using: ls *.ts | wc -l')

      // Should return a number
      expect(result.lastMessage).toMatch(/\d+/)
    }, 60000)
  })

  describe('session persistence', () => {
    it('persists variables across commands', async () => {
      const agent = createAgent()

      // Set a variable
      await agent.invoke('Use bash to set a variable: TEST_VAR="hello"')

      // Read the variable
      const result = await agent.invoke('Use bash to echo $TEST_VAR')

      expect(result.lastMessage.toLowerCase()).toContain('hello')
    }, 60000)

    it('persists directory changes', async () => {
      const agent = createAgent()

      // Change to temp directory
      await agent.invoke('Use bash to change directory to /tmp')

      // Check current directory
      const result = await agent.invoke('Use bash to print working directory')

      expect(result.lastMessage).toContain('/tmp')
    }, 60000)

    it('persists functions across commands', async () => {
      const agent = createAgent()

      // Define a function
      await agent.invoke('Use bash to define a function: greet() { echo "Hello $1"; }')

      // Call the function
      const result = await agent.invoke('Use bash to call: greet "World"')

      expect(result.lastMessage).toContain('Hello World')
    }, 60000)
  })

  describe('restart functionality', () => {
    it('clears session state on restart', async () => {
      const agent = createAgent()

      // Set a variable
      await agent.invoke('Use bash to set: TEMP_VAR="exists"')

      // Restart the session
      await agent.invoke('Restart the bash session')

      // Try to read the variable - it should be gone
      const result = await agent.invoke('Use bash to echo $TEMP_VAR')

      // Variable should be empty or the agent should indicate it doesn't exist
      const lastMessage = result.lastMessage.toLowerCase()
      expect(lastMessage).not.toContain('exists')
    }, 60000)

    it('resets working directory on restart', async () => {
      const agent = createAgent()

      // Get initial directory
      const initialResult = await agent.invoke('Use bash to print working directory')
      const initialDir = initialResult.lastMessage

      // Change directory
      await agent.invoke('Use bash to change directory to /tmp')

      // Restart
      await agent.invoke('Restart the bash session')

      // Check directory is reset
      const result = await agent.invoke('Use bash to print working directory')

      // Should be back to initial directory, not /tmp
      expect(result.lastMessage).toContain(initialDir.trim())
    }, 60000)
  })

  describe('error scenarios', () => {
    it('handles command that does not exist', async () => {
      const agent = createAgent()
      const result = await agent.invoke('Use bash to run: nonexistent_command_xyz')

      // Should indicate command not found or error
      const lastMessage = result.lastMessage.toLowerCase()
      expect(lastMessage).toMatch(/not found|error|command/)
    }, 60000)
  })

  describe('working directory', () => {
    it('starts in process.cwd()', async () => {
      const agent = createAgent()
      const result = await agent.invoke('Use bash to print working directory')

      expect(result.lastMessage).toContain(process.cwd())
    }, 60000)

    it('allows cd commands', async () => {
      const agent = createAgent()

      // Change to /tmp
      await agent.invoke('Use bash to change directory to /tmp')

      // Verify we are in /tmp
      const result = await agent.invoke('Use bash to print working directory')

      expect(result.lastMessage).toContain('/tmp')
    }, 60000)
  })

  describe('isolated sessions', () => {
    it('provides separate sessions for different agents', async () => {
      const agent1 = createAgent()
      const agent2 = createAgent()

      // Set variable in agent1
      await agent1.invoke('Use bash to set: AGENT1_VAR="agent1"')

      // Set different variable in agent2
      await agent2.invoke('Use bash to set: AGENT2_VAR="agent2"')

      // Check agent1 variable
      const result1 = await agent1.invoke('Use bash to echo $AGENT1_VAR')
      expect(result1.lastMessage).toContain('agent1')

      // Check agent2 variable
      const result2 = await agent2.invoke('Use bash to echo $AGENT2_VAR')
      expect(result2.lastMessage).toContain('agent2')

      // Verify isolation - agent1 should not have agent2's variable
      const crossCheck = await agent1.invoke('Use bash to echo $AGENT2_VAR')
      expect(crossCheck.lastMessage.toLowerCase()).not.toContain('agent2')
    }, 60000)
  })
})
