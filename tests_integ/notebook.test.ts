/* eslint-disable no-restricted-imports */
import { describe, it, expect } from 'vitest'
import { Agent, BedrockModel } from '../src/index.js'
import { notebook } from '../vended_tools/notebook/index.js'
import { shouldRunTests, extractToolResults } from './__fixtures__/model-test-helpers.js'

describe.skipIf(!(await shouldRunTests()))('Notebook Tool Integration', () => {
  // Shared agent configuration for all tests
  const agentParams = {
    model: new BedrockModel({
      region: 'us-east-1',
    }),
    tools: [notebook],
  }

  it('should persist notebook state across tool invocations', async () => {
    // Create agent with notebook tool
    const agent = new Agent(agentParams)

    // Step 1: Create a notebook
    await agent.invoke('Create a notebook called "test" with content "# Test Notebook"')

    // Verify notebook was created
    const notebooks1 = agent.state.get('notebooks') as any
    expect(notebooks1).toBeTruthy()
    expect(notebooks1).toHaveProperty('test')
    expect(notebooks1.test).toContain('# Test Notebook')

    // Step 2: Add content to the notebook
    await agent.invoke('Add "- First item" to the test notebook')

    // Verify content was added
    const notebooks2 = agent.state.get('notebooks') as any
    expect(notebooks2.test).toContain('- First item')

    // Step 3: Read the notebook
    const result = await agent.invoke('Read the test notebook')

    // Verify the agent received and understood the notebook content
    const responseText = result.lastMessage.content
      .filter((block) => block.type === 'textBlock')
      .map((block) => block.text)
      .join(' ')
    expect(responseText.length).toBeGreaterThan(0)

    // The notebook should still contain both pieces of content
    const notebooks3 = agent.state.get('notebooks') as any
    expect(notebooks3.test).toContain('# Test Notebook')
    expect(notebooks3.test).toContain('- First item')
  }, 30000) // 30 second timeout for network calls

  it('should restore state across agent instances', async () => {
    // Create first agent and add content
    const agent1 = new Agent(agentParams)

    // Create notebook with first agent
    await agent1.invoke('Create a notebook called "persist" with "Persistent content"')

    // Verify notebook was created
    const notebooks1 = agent1.state.get('notebooks') as any
    expect(notebooks1).toBeTruthy()
    expect(notebooks1.persist).toContain('Persistent content')

    // Save state
    const savedState = agent1.state.getAll()

    // Create second agent with restored state
    const agent2 = new Agent({
      ...agentParams,
      state: savedState, // Pass state in constructor
    })

    // Verify notebooks were restored
    const notebooks2 = agent2.state.get('notebooks') as any
    expect(notebooks2).toBeTruthy()
    expect(notebooks2.persist).toContain('Persistent content')

    // Use the restored notebook - just read it
    await agent2.invoke('Read the persist notebook')

    // Verify content still exists
    const notebooks3 = agent2.state.get('notebooks') as any
    expect(notebooks3.persist).toContain('Persistent content')
  }, 30000)

  it('should handle errors gracefully', async () => {
    const agent = new Agent(agentParams)

    // Try to read non-existent notebook
    const result = await agent.invoke('Read a notebook called "nonexistent"')

    // Verify that tools were called
    expect(extractToolResults(agent).length).toBeGreaterThan(0)

    // The agent should handle the error and provide a reasonable response
    const responseText = result.lastMessage.content
      .filter((block) => block.type === 'textBlock')
      .map((block) => block.text)
      .join(' ')
    expect(responseText.length).toBeGreaterThan(0)
  }, 30000)
})
