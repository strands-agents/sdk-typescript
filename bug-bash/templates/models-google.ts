import { Agent } from '@strands-agents/sdk'
import { GeminiModel } from '@strands-agents/sdk/gemini'

const model = new GeminiModel({ modelId: 'gemini-2.5-flash' })
const agent = new Agent({ model })

const result = await agent.invoke('Hello! What model are you?')
console.log('Stop reason:', result.stopReason)
