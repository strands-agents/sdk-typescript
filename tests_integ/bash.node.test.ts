import { describe, it, expect } from 'vitest'
import { Agent, BedrockModel } from '@strands-agents/sdk'
import { bash } from '@strands-agents/sdk/vended_tools/bash'
import { getMessageText, shouldSkipBedrockTests } from './__fixtures__/model-test-helpers.js'
import { isInBrowser } from './__fixtures__/test-helpers.js'

describe.skipIf((await shouldSkipBedrockTests()) || globalThis.process.platform === 'win32')(
  'Bash Tool Integration',
  { timeout: 60000, skip: isInBrowser() },
  () => {
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
  }
)
