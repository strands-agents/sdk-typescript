import { Agent } from '@strands-agents/sdk'
import { OpenAIModel } from '@strands-agents/sdk/openai'

const model = new OpenAIModel({ modelId: 'gpt-4o' })
const agent = new Agent({ model })

const result = await agent.invoke('Hello! What model are you?')
console.log('Stop reason:', result.stopReason)
