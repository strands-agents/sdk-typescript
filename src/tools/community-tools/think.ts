import type { JSONValue } from '../../types/json.js'
import type { Tool, ToolContext } from '../tool.js'
import { Agent } from '../../agent/agent.js'
import { FunctionTool } from '../function-tool.js'

interface ThinkInput {
  thought: string
  cycleCount?: number
  systemPrompt?: string
  tools?: string[]
}

function successResult(text: string): JSONValue {
  return { status: 'success', content: [{ text }] }
}

function errorResult(text: string): JSONValue {
  return { status: 'error', content: [{ text }] }
}

const DEFAULT_SYSTEM_PROMPT =
  'You are an expert analytical thinker. Process the thought deeply and provide clear insights.'

async function* runThink(input: ThinkInput, toolContext: ToolContext): AsyncGenerator<JSONValue, JSONValue, never> {
  const thought = input.thought ?? ''
  const cycleCount = Math.min(Math.max(1, input.cycleCount ?? 3), 10)
  const systemPrompt = input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
  const specifiedTools = input.tools

  // ToolContext.agent is typed as AgentData, but at runtime it's the Agent instance.
  // We need the Agent's model and toolRegistry to create nested agents.
  const parentAgent = toolContext.agent as unknown as Agent
  if (!(parentAgent instanceof Agent)) {
    return errorResult('Think tool requires a parent Agent instance')
  }

  const allTools: Tool[] = [...parentAgent.toolRegistry.values()]
  const filteredTools = allTools.filter((t) => {
    if (t.name === 'think') return false
    if (specifiedTools != null && specifiedTools.length > 0 && !specifiedTools.includes(t.name)) return false
    return true
  })

  let currentThought = thought
  const responses: string[] = []

  for (let cycle = 1; cycle <= cycleCount; cycle++) {
    const nestedAgent = new Agent({
      model: parentAgent.model,
      tools: filteredTools,
      systemPrompt,
      messages: [],
    })
    const prompt =
      cycle === 1
        ? currentThought
        : `Previous cycle concluded: ${responses[responses.length - 1]}\n\nContinue developing these ideas further.`
    const stream = nestedAgent.stream(prompt) as AsyncGenerator<unknown, { toString: () => string }, unknown>
    let next = await stream.next()
    while (!next.done) {
      yield next.value as unknown as JSONValue
      next = await stream.next()
    }
    const result = next.value
    const text = result.toString()
    responses.push(text)
    currentThought = text
  }

  const combined = responses.map((r, i) => `Cycle ${i + 1}/${cycleCount}:\n${r}`).join('\n\n')
  return successResult(combined)
}

export const think = new FunctionTool({
  name: 'think',
  description:
    'Run multiple reasoning cycles on a thought. Each cycle deepens the analysis. Optionally restrict to specific tools or use a custom system prompt.',
  inputSchema: {
    type: 'object',
    properties: {
      thought: { type: 'string', description: 'The thought or question to process' },
      cycleCount: { type: 'number', description: 'Number of cycles (1–10, default 3)' },
      systemPrompt: { type: 'string', description: 'System prompt for the thinking agent' },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of tool names to allow (excludes think)',
      },
    },
    required: ['thought'],
  },
  callback: (input: unknown, toolContext: ToolContext): AsyncGenerator<JSONValue, JSONValue, never> =>
    runThink((input ?? {}) as ThinkInput, toolContext),
})
