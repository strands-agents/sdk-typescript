import { Agent, BedrockModel, tool, FunctionTool } from '@strands-agents/sdk'
import { z } from 'zod'

// --- tool() factory: sync callback ---
const calculator = tool({
  name: 'calculator',
  description: 'Perform basic arithmetic.',
  inputSchema: z.object({
    expression: z.string().describe('A math expression like "2 + 3"'),
  }),
  callback: (input) => {
    return `Result: ${eval(input.expression)}`
  },
})

// --- tool() factory: async callback ---
const fetchData = tool({
  name: 'fetch_data',
  description: 'Fetch data from a source.',
  inputSchema: z.object({
    source: z.string().describe('Data source name'),
  }),
  callback: async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    return `Data from ${input.source}: [sample data]`
  },
})

// --- tool() factory: no parameters ---
const getTime = tool({
  name: 'get_time',
  description: 'Get the current time.',
  callback: () => {
    return new Date().toISOString()
  },
})

// --- tool() factory: complex nested schema ---
const createReport = tool({
  name: 'create_report',
  description: 'Create a report with sections.',
  inputSchema: z.object({
    title: z.string(),
    sections: z.array(
      z.object({
        heading: z.string(),
        content: z.string(),
      })
    ),
  }),
  callback: (input) => {
    return `Report "${input.title}" with ${input.sections.length} sections created.`
  },
})

// --- FunctionTool: wrap an existing function ---
const legacyTool = new FunctionTool({
  name: 'legacy_lookup',
  description: 'Look up a value by key.',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'The lookup key' },
    },
    required: ['key'],
  },
  callback: (input) => {
    const data: Record<string, string> = { color: 'blue', size: 'large' }
    return data[(input as { key: string }).key] ?? 'not found'
  },
})

// --- tool() factory: async generator (streaming tool) ---
const streamingTool = tool({
  name: 'streaming_counter',
  description: 'Count up to a number, streaming each step.',
  inputSchema: z.object({
    count: z.number().describe('Number to count to'),
  }),
  callback: async function* (input) {
    for (let i = 1; i <= input.count; i++) {
      yield `Step ${i}...`
    }
    return `Counted to ${input.count}`
  },
})

// --- tool() factory: tool that throws ---
const failingTool = tool({
  name: 'always_fails',
  description: 'A tool that always throws an error.',
  callback: () => {
    throw new Error('Something went wrong in the tool')
  },
})

const model = new BedrockModel()

// Test 1: Basic tool usage
console.log('=== Test 1: Basic tool usage ===')
const agent1 = new Agent({
  model,
  tools: [calculator, fetchData, getTime, createReport, legacyTool],
  systemPrompt: 'You are a helpful assistant. Use tools when asked.',
})
const result1 = await agent1.invoke('What time is it?')
console.log('Stop reason:', result1.stopReason)
console.log('Response:', result1.toString())

// Test 2: Streaming tool
console.log('\n=== Test 2: Streaming tool ===')
const agent2 = new Agent({ model, tools: [streamingTool] })
for await (const event of agent2.stream('Count to 3')) {
  if (event.type === 'toolStreamUpdateEvent') {
    console.log('Tool stream:', event.event.data)
  }
}

// Test 3: Tool that throws (error should be returned to model, not crash)
console.log('\n=== Test 3: Tool error handling ===')
const agent3 = new Agent({ model, tools: [failingTool] })
const result3 = await agent3.invoke('Use the always_fails tool')
console.log('Stop reason:', result3.stopReason)
console.log('Response:', result3.toString())
