import { Agent } from '@strands-agents/sdk'
import { AnthropicModel } from '@strands-agents/sdk/anthropic'

const model = new AnthropicModel({ modelId: 'claude-sonnet-4-20250514' })
const agent = new Agent({ model })

const result = await agent.invoke('Hello! What model are you?')
console.log('Stop reason:', result.stopReason)
