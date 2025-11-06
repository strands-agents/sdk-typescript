import { type Tool, type ToolResult, type ToolContext, Agent, BedrockModel } from '@strands-agents/sdk'

// Define the shape of the expected input
type WeatherToolInput = {
  location: string
}

// Type Guard: A function that performs a runtime check and informs the TS compiler.
function isValidInput(input: any): input is WeatherToolInput {
  return input && typeof input.location === 'string'
}

class WeatherTool implements Tool {
  name = 'get_weather'
  description = 'Get the current weather for a specific location.'

  toolSpec = {
    name: this.name,
    description: this.description,
    inputSchema: {
      type: 'object' as const,
      properties: {
        location: {
          type: 'string' as const,
          description: 'The city and state, e.g., San Francisco, CA',
        },
      },
      required: ['location'],
    },
  }

  async *stream(context: ToolContext): AsyncGenerator<never, ToolResult, unknown> {
    const input = context.toolUse.input

    // Use the type guard for validation
    if (!isValidInput(input)) {
      throw new Error('Tool input must be an object with a string "location" property.')
    }

    // After this check, TypeScript knows `input` is `WeatherToolInput`
    const location = input.location

    console.log(`\n[WeatherTool] Getting weather for ${location}...`)

    const fakeWeatherData = {
      temperature: '72°F',
      conditions: 'sunny',
    }

    const resultText = `The weather in ${location} is ${fakeWeatherData.temperature} and ${fakeWeatherData.conditions}.`

    return {
      toolUseId: context.toolUse.toolUseId,
      status: 'success' as const,
      content: [{ type: 'textBlock', text: resultText }],
    }
  }
}

/**
 * A helper function to run an agent scenario and handle its output stream.
 * This avoids repeating the for-await loop and logging logic.
 * @param title The title of the scenario to be logged.
 * @param agent The agent instance to use.
 * @param prompt The user prompt to invoke the agent with.
 */
async function run(title: string, agent: Agent, prompt: string) {
  console.log(`--- ${title} ---`)
  console.log(`User: ${prompt}`)

  const responseStream = agent.invoke(prompt)

  console.log('Agent response stream:')
  let result = await responseStream.next()
  while (!result.done) {
    const event = result.value
    console.log('[Event]', event)
    result = await responseStream.next()
  }

  // Clean up logging for the next scenario
  console.log('\nInvocation complete.\n')
}

async function main() {
  // 1. Initialize the components
  const model = new BedrockModel()
  const weatherTool = new WeatherTool()

  // 2. Create agents
  const defaultAgent = new Agent()
  const agentWithoutTools = new Agent({ model })
  const agentWithTools = new Agent({
    systemPrompt: 'You are a helpful assistant that provides weather information using the get_weather tool.',
    model,
    tools: [weatherTool],
  })

  await run('0: Invocation with default agent (no model or tools)', defaultAgent, 'Hello!')
  await run('1: Invocation with a model but no tools', agentWithoutTools, 'Hello!')
  await run('2: Invocation that uses a tool', agentWithTools, 'What is the weather in Toronto? Use the weather tool.')
}

main().catch(console.error)
