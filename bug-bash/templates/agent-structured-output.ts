import { Agent, BedrockModel } from '@strands-agents/sdk'
import { z } from 'zod'

const schema = z.object({
  city: z.string(),
  population: z.number(),
  country: z.string(),
})

const agent = new Agent({
  model: new BedrockModel(),
  structuredOutputSchema: schema,
})

const result = await agent.invoke('Tell me about Tokyo')
console.log('Structured output:', result.structuredOutput)
