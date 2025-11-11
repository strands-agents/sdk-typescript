/* eslint-disable no-restricted-imports */
import { describe, it, expect } from 'vitest'
import { Agent, BedrockModel } from '../src/index.js'
import { bash } from '../vended_tools/bash/index.js'
import { getMessageText, shouldRunTests } from './__fixtures__/model-test-helpers.js'

describe.skipIf(!(await shouldRunTests()))('Bash Tool Integration', { timeout: 60000 }, () => {
  // Shared agent configuration for all tests
  const createAgent = () =>
    new Agent({
      model: new BedrockModel({
        region: 'us-east-1',
      }),
      tools: [bash],
    })

  describe('basic execution', () => {
    it('captures stdout streams correctly', async () => {
      const agent = createAgent()
      const stdoutResult = await agent.invoke('Use bash to echo "Hello from bash"')
      expect(getMessageText(stdoutResult.lastMessage)).toContain('Hello from bash')
    })

    it('captures stderr streams correctly', async () => {
      const agent = createAgent()
      const stderrResult = await agent.invoke('Use bash to run: echo "error" >&2')
      expect(getMessageText(stderrResult.lastMessage)).toContain('error')
    })

    it('handles complex command patterns', async () => {
      const agent = createAgent()

      // Test command sequencing
      const seqResult = await agent.invoke('Use bash to: create a variable TEST=hello, then echo it')
      expect(getMessageText(seqResult.lastMessage).toLowerCase()).toContain('hello')
    })
  })

  describe('error handling', () => {
    it('handles command errors gracefully', async () => {
      const agent = createAgent()
      const result = await agent.invoke('Use bash to run: nonexistent_command_xyz')

      // Should indicate command not found or error
      const lastMessage = getMessageText(result.lastMessage).toLowerCase()
      expect(lastMessage).toMatch(/not found|error|command/)
    })
  })

  describe('isolated sessions', () => {
    it('provides separate sessions for different agents', async () => {
      const agent1 = createAgent()
      const agent2 = createAgent()

      // Set variable in agent1
      await agent1.invoke('Use bash to set: AGENT1_VAR="unique_value_1"')

      // Set different variable in agent2
      await agent2.invoke('Use bash to set: AGENT2_VAR="unique_value_2"')

      // Check agent1 variable
      const result1 = await agent1.invoke('Use bash to echo $AGENT1_VAR')
      expect(getMessageText(result1.lastMessage)).toContain('unique_value_1')

      // Check agent2 variable
      const result2 = await agent2.invoke('Use bash to echo $AGENT2_VAR')
      expect(getMessageText(result2.lastMessage)).toContain('unique_value_2')

      // Verify isolation - agent1 should not have agent2's variable
      const crossCheck = await agent1.invoke('Use bash to echo $AGENT2_VAR')
      expect(getMessageText(crossCheck.lastMessage)).not.toContain('unique_value_2')
    })
  })
})
