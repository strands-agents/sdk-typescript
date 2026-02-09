import { FunctionTool } from '../function-tool.js'
import type { JSONValue } from '../../types/json.js'

interface StopInput {
  message?: string
}

function runStop(input: StopInput): JSONValue {
  const message = input.message ?? 'Agent stopped'
  return { status: 'success', content: [{ text: message }] }
}

export const stop = new FunctionTool({
  name: 'stop',
  description:
    'Signal that the agent should stop and return a final message. Use when the task is complete or no further action is needed.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Final message to return (default: "Agent stopped")' },
    },
  },
  callback: (input: unknown): JSONValue => runStop((input ?? {}) as StopInput),
})
