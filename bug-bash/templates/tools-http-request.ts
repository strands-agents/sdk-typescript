import { Agent, BedrockModel } from '@strands-agents/sdk'
import { httpRequest } from '@strands-agents/sdk/vended-tools/http-request'

const agent = new Agent({
  model: new BedrockModel(),
  tools: [httpRequest],
  systemPrompt: 'You have an HTTP request tool. Use it to make web requests.',
})

const result = await agent.invoke('Make a GET request to https://httpbin.org/get and tell me the origin IP.')
console.log('Stop reason:', result.stopReason)
console.log('Response:', result.toString())
