import { Agent } from '@strands-agents/sdk'
import { VercelModel } from '@strands-agents/sdk/models/vercel'
import { bedrock } from '@ai-sdk/amazon-bedrock'

const agent = new Agent({
  model: new VercelModel({
    model: bedrock('us.anthropic.claude-sonnet-4-20250514-v1:0'),
    config: { temperature: 0.7 },
  }),
})

const result = await agent.invoke('Hello!')
