import { describe, it, expect } from 'vitest'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
// eslint-disable-next-line no-restricted-imports
import { Agent, BedrockModel } from '../src/index.js'
// eslint-disable-next-line no-restricted-imports
import type { AgentStreamEvent, AgentResult } from '../src/index.js'
import { notebook } from '../vended_tools/notebook/index.js'
// eslint-disable-next-line no-restricted-imports
import { collectGenerator } from '../src/__fixtures__/model-test-helpers.js'

// Check if we should run AWS-dependent tests
const shouldRunAWSTests = await (async () => {
  if (process.env.CI) {
    console.log('✅ Running in CI environment, Bedrock integration tests will run.')
    return true
  }

  try {
    const credentialProvider = fromNodeProviderChain()
    await credentialProvider()
    console.log('✅ AWS credentials found locally, Bedrock integration tests will run.')
    return true
  } catch {
    console.log('⚠️ No AWS credentials found. Skipping Bedrock integration tests.')
    return false
  }
})()

describe.skipIf(!shouldRunAWSTests)('Notebook Tool Integration', () => {
  it('should persist notebook state across tool invocations', async () => {
    // Create agent with notebook tool
    const agent = new Agent({
      model: new BedrockModel({
        region: 'us-east-1',
      }),
      tools: [notebook],
    })

    // Step 1: Create a notebook
    const { items: _events1 } = await collectGenerator<AgentStreamEvent, AgentResult>(
      agent.invoke('Create a notebook called "test" with content "# Test Notebook"')
    )

    // Verify notebook was created
    expect(agent.invocationState).toHaveProperty('notebooks')
    expect(agent.invocationState.notebooks).toHaveProperty('test')
    expect((agent.invocationState.notebooks as any).test).toContain('# Test Notebook')

    // Step 2: Add content to the notebook
    const { items: _events2 } = await collectGenerator<AgentStreamEvent, AgentResult>(
      agent.invoke('Add "- First item" to the test notebook')
    )

    // Verify content was added
    expect((agent.invocationState.notebooks as any).test).toContain('- First item')

    // Step 3: Read the notebook
    const { items: events3 } = await collectGenerator<AgentStreamEvent, AgentResult>(
      agent.invoke('Read the test notebook')
    )

    // Find the last text block in events to get agent's response
    const textBlocks = events3.filter((e) => e.type === 'textBlock')
    expect(textBlocks.length).toBeGreaterThan(0)

    // The notebook should still contain both pieces of content
    expect((agent.invocationState.notebooks as any).test).toContain('# Test Notebook')
    expect((agent.invocationState.notebooks as any).test).toContain('- First item')
  }, 30000) // 30 second timeout for network calls

  it('should restore state across agent instances', async () => {
    // Create first agent and add content
    const agent1 = new Agent({
      model: new BedrockModel({
        region: 'us-east-1',
      }),
      tools: [notebook],
    })

    // Create notebook with first agent
    await collectGenerator<AgentStreamEvent, AgentResult>(
      agent1.invoke('Create a notebook called "persist" with "Persistent content"')
    )

    // Verify notebook was created
    expect(agent1.invocationState).toHaveProperty('notebooks')
    expect((agent1.invocationState.notebooks as any).persist).toContain('Persistent content')

    // Save state
    const savedState = JSON.parse(JSON.stringify(agent1.invocationState))

    // Create second agent with restored state
    const agent2 = new Agent({
      model: new BedrockModel({
        region: 'us-east-1',
      }),
      tools: [notebook],
      invocationState: savedState, // Pass state in constructor
    })

    // Verify notebooks were restored
    expect(agent2.invocationState).toHaveProperty('notebooks')
    expect((agent2.invocationState.notebooks as any).persist).toContain('Persistent content')

    // Use the restored notebook - just read it
    await collectGenerator<AgentStreamEvent, AgentResult>(agent2.invoke('Read the persist notebook'))

    // Verify content still exists
    expect((agent2.invocationState.notebooks as any).persist).toContain('Persistent content')
  }, 30000)

  it('should handle errors gracefully', async () => {
    const agent = new Agent({
      model: new BedrockModel({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        region: 'us-east-1',
      }),
      tools: [notebook],
    })

    // Try to read non-existent notebook
    const { items: events } = await collectGenerator<AgentStreamEvent, AgentResult>(
      agent.invoke('Read a notebook called "nonexistent"')
    )

    // The agent should handle the error and provide a reasonable response
    // Check that we got tool result blocks (indicating tool was called)
    const toolResults = events.filter((e) => e.type === 'toolResultBlock')
    expect(toolResults.length).toBeGreaterThan(0)

    // The model should have handled the error gracefully
    const textBlocks = events.filter((e) => e.type === 'textBlock')
    expect(textBlocks.length).toBeGreaterThan(0)
  }, 30000)
})
