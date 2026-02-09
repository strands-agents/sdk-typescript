import { FunctionTool } from '../function-tool.js'
import { InterruptException } from '../../interrupt.js'
import type { JSONValue } from '../../types/json.js'
import type { ToolContext } from '../tool.js'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

interface HandoffToUserInput {
  message?: string
  breakout_of_loop?: boolean
}

function successResult(text: string): JSONValue {
  return { status: 'success', content: [{ text }] }
}

function errorResult(text: string): JSONValue {
  return { status: 'error', content: [{ text }] }
}

async function promptUserInput(prompt: string): Promise<string> {
  const rl = createInterface({ input, output })
  try {
    return await rl.question(prompt)
  } finally {
    rl.close()
  }
}

function isInterruptLike(error: unknown): boolean {
  return error instanceof InterruptException
}

function isUserAbort(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return error.name === 'AbortError' || error.message.toLowerCase().includes('sigint')
}

async function runHandoffToUser(input: HandoffToUserInput, toolContext: ToolContext): Promise<JSONValue> {
  const message =
    typeof input.message === 'string' && input.message.trim() !== '' ? input.message : 'Agent requesting user handoff'
  const breakoutOfLoop = input.breakout_of_loop === true

  if (breakoutOfLoop) {
    toolContext.agent.state.set('stop_event_loop', true)
    return successResult(`Agent handoff completed. Message displayed to user: ${message}`)
  }

  try {
    const interruptResponse = toolContext.interrupt('handoff_to_user', {
      message,
      breakout_of_loop: false,
    })
    const userResponse = String(interruptResponse ?? '').trim()
    return successResult(`User response received: ${userResponse}`)
  } catch (error) {
    if (isInterruptLike(error)) {
      throw error
    }
  }

  try {
    const userResponse = (await promptUserInput(`Agent requested user input: ${message}\nYour response: `)).trim()
    return successResult(`User response received: ${userResponse}`)
  } catch (error) {
    if (isUserAbort(error)) {
      toolContext.agent.state.set('stop_event_loop', true)
      return successResult('User interrupted handoff. Execution stopped.')
    }

    const reason = error instanceof Error ? error.message : String(error)
    return errorResult(`Error during user handoff: ${reason}`)
  }
}

export const handoffToUser = new FunctionTool({
  name: 'handoff_to_user',
  description: 'Hand off control from agent to user for confirmation, input, or complete task handoff',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Message to display to the user with context and instructions',
      },
      breakout_of_loop: {
        type: 'boolean',
        description: 'Whether to stop the event loop (true) or wait for user input (false)',
        default: false,
      },
    },
    required: ['message'],
  },
  callback: (input: unknown, toolContext: ToolContext): Promise<JSONValue> =>
    runHandoffToUser((input ?? {}) as HandoffToUserInput, toolContext),
})
