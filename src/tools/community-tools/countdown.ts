import { FunctionTool } from '../function-tool.js'
import type { JSONValue } from '../../types/json.js'

interface CountdownInput {
  seconds?: number
  message?: string
}

const MIN_SECONDS = 1
const MAX_SECONDS = 60

async function* runCountdown(input: CountdownInput): AsyncGenerator<JSONValue, JSONValue, never> {
  const raw = input.seconds ?? 3
  const seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.floor(Number(raw))))
  const message = input.message ?? 'Done.'

  yield { status: 'success', content: [{ text: `Starting countdown from ${seconds}...` }] }
  for (let i = seconds; i >= 1; i--) {
    yield { status: 'success', content: [{ text: String(i) }] }
    await new Promise((r) => globalThis.setTimeout(r, 1000))
  }
  return { status: 'success', content: [{ text: message }] }
}

export const countdown = new FunctionTool({
  name: 'countdown',
  description:
    'Run a countdown timer that streams progress. Useful for delaying or demonstrating streaming tool output. Yields each second then returns a final message.',
  inputSchema: {
    type: 'object',
    properties: {
      seconds: {
        type: 'number',
        description: `Countdown duration in seconds (${MIN_SECONDS}–${MAX_SECONDS}, default 3)`,
      },
      message: { type: 'string', description: 'Final message when countdown completes (default: "Done.")' },
    },
  },
  callback: (input: unknown): AsyncGenerator<JSONValue, JSONValue, never> =>
    runCountdown((input ?? {}) as CountdownInput),
})
