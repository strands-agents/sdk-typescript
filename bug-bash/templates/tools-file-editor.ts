import { Agent, BedrockModel } from '@strands-agents/sdk'
import { fileEditor } from '@strands-agents/sdk/vended-tools/file-editor'

const agent = new Agent({
  model: new BedrockModel(),
  tools: [fileEditor],
  systemPrompt: 'You have a file editor tool. Use it to create and read files.',
})

const result = await agent.invoke('Create a file at /tmp/strands-test.txt with "Hello from Strands". Then read it back.')
console.log('Stop reason:', result.stopReason)
console.log('Response:', result.toString())
