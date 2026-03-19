import { Agent, BedrockModel } from '@strands-agents/sdk'
import { bash } from '@strands-agents/sdk/vended-tools/bash'

const agent = new Agent({
  model: new BedrockModel(),
  tools: [bash],
  systemPrompt: 'You have a bash tool. Use it to run shell commands.',
})

const result = await agent.invoke('Run "echo hello world" in the shell, then set MY_VAR=42 and echo it.')
console.log('Stop reason:', result.stopReason)
console.log('Response:', result.toString())
