import { Agent, BedrockModel } from '@strands-agents/sdk'

const model = new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' })
const agent = new Agent({ model })

const result = await agent.invoke('Hello! What model are you?')
console.log('Stop reason:', result.stopReason)
