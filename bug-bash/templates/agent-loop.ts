import { Agent, BedrockModel, tool } from '@strands-agents/sdk'
import { z } from 'zod'

const weatherTool = tool({
  name: 'get_weather',
  description: 'Get the current weather for a location.',
  inputSchema: z.object({
    location: z.string().describe('City and state, e.g., San Francisco, CA'),
  }),
  callback: (input) => {
    return `The weather in ${input.location} is 72°F and sunny.`
  },
})

const agent = new Agent({
  model: new BedrockModel(),
  tools: [weatherTool],
  systemPrompt: 'You are a helpful weather assistant.',
})

// invoke() pattern
const result = await agent.invoke('What is the weather in Seattle?')
console.log('Result:', result.stopReason)

// stream() pattern
for await (const event of agent.stream('What about Portland?')) {
  console.log('Event:', event.type)
}
