import { FunctionTool } from '../function-tool.js'
import type { JSONValue } from '../../types/json.js'

interface SleepInput {
  seconds?: number
  milliseconds?: number
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

async function runSleep(input: SleepInput): Promise<JSONValue> {
  const seconds = input.seconds ?? 0
  const milliseconds = input.milliseconds ?? 0
  const totalMs = seconds * 1000 + milliseconds

  if (totalMs <= 0) {
    return { status: 'error', content: [{ text: 'Sleep duration must be greater than 0' }] }
  }

  if (totalMs > 300_000) {
    return { status: 'error', content: [{ text: 'Sleep duration cannot exceed 300 seconds (5 minutes)' }] }
  }

  await delay(totalMs)
  return { status: 'success', content: [{ text: `Slept for ${totalMs}ms` }] }
}

export const sleep = new FunctionTool({
  name: 'sleep',
  description:
    'Pause execution for a specified duration. Useful for rate limiting, waiting before retries, or timed delays. Specify seconds, milliseconds, or both.',
  inputSchema: {
    type: 'object',
    properties: {
      seconds: { type: 'number', description: 'Number of seconds to sleep' },
      milliseconds: { type: 'number', description: 'Number of milliseconds to sleep (added to seconds)' },
    },
  },
  callback: (input: unknown): Promise<JSONValue> => runSleep((input ?? {}) as SleepInput),
})
