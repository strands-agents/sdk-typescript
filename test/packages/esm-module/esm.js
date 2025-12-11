/**
 * Verification script to ensure the built package can be imported without a bundler.
 * This script runs in a pure Node.js ES module environment.
 */

import { Agent, BedrockModel, tool, Tool } from '@strands-agents/sdk'

import { notebook } from '@strands-agents/sdk/vended_tools/notebook'
import { fileEditor } from '@strands-agents/sdk/vended_tools/file_editor'
import { httpRequest } from '@strands-agents/sdk/vended_tools/http_request'
import { bash } from '@strands-agents/sdk/vended_tools/bash'

import { z } from 'zod'

console.log('✓ Import from main entry point successful')

// Verify BedrockModel can be instantiated
const model = new BedrockModel({ region: 'us-west-2' })
console.log('✓ BedrockModel instantiation successful')

// Verify basic functionality
const config = model.getConfig()
if (!config) {
  throw new Error('BedrockModel config is invalid')
}
console.log('✓ BedrockModel configuration retrieval successful')

// Define a tool
const example_tool = tool({
  name: 'get_weather',
  description: 'Get the current weather for a specific location.',
  inputSchema: z.object({
    location: z.string().describe('The city and state, e.g., San Francisco, CA'),
  }),
  callback: (input) => {
    console.log(`\n[WeatherTool] Getting weather for ${input.location}...`)

    const fakeWeatherData = {
      temperature: '72°F',
      conditions: 'sunny',
    }

    return `The weather in ${input.location} is ${fakeWeatherData.temperature} and ${fakeWeatherData.conditions}.`
  },
})
console.log('✓ Tool created successful')

// Verify tool can be called
const response = await example_tool.invoke({ location: 'New York' })
if (response !== `The weather in New York is 72°F and sunny.`) {
  throw new Error('Tool returned invalid response')
}

// Verify Agent can be instantiated
const agent = new Agent({
  tools: [example_tool],
})

if (agent.tools.length == 0) {
  throw new Error('Tool was not correctly added to the agent')
}

async function validateScratchpad() {
  let context = { agent: agent }
  notebook.invoke(
    {
      mode: 'create',
      name: 'scratchpad',
      newStr: 'Content',
    },
    context
  )

  const result = await notebook.invoke(
    {
      mode: 'read',
      name: 'scratchpad',
    },
    context
  )

  if (result !== 'Content') {
    throw new Error(`Tool returned invalid response: ${result}`)
  }

  console.log('Notebook created successful')
}

const tools = {
  notebook,
  fileEditor,
  httpRequest,
  bash,
}

for (const tool of Object.values(tools)) {
  if (!(tool instanceof Tool)) {
    throw new Error(`Tool ${tool.name} isn't an instance of a tool`)
  }
}
