import { FunctionTool } from '../function-tool.js'
import type { JSONValue } from '../../types/json.js'

interface EnvironmentInput {
  key: string
}

function successResult(text: string): JSONValue {
  return { status: 'success', content: [{ text }] }
}

function errorResult(text: string): JSONValue {
  return { status: 'error', content: [{ text }] }
}

function runEnvironment(input: EnvironmentInput): JSONValue {
  const key = input.key
  if (!key) {
    return errorResult('Missing required field: key')
  }

  const value = globalThis?.process?.env?.[key]
  if (value == null) {
    return errorResult(`Environment variable not found: ${key}`)
  }

  return successResult(value)
}

export const environment = new FunctionTool({
  name: 'environment',
  description: 'Read the value of an environment variable by key.',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'The environment variable name to read' },
    },
    required: ['key'],
  },
  callback: (input: unknown): JSONValue => runEnvironment((input ?? {}) as EnvironmentInput),
})
