import { Agent, BedrockModel } from '@strands-agents/sdk'
import { notebook } from '@strands-agents/sdk/vended-tools/notebook'

const agent = new Agent({
  model: new BedrockModel(),
  tools: [notebook],
  systemPrompt: 'You have a notebook tool. Use it to store and retrieve information.',
})

const result = await agent.invoke('Create a notebook entry titled "Shopping List" with content "milk, eggs, bread". Then read it back.')
console.log('Stop reason:', result.stopReason)
console.log('Response:', result.toString())
