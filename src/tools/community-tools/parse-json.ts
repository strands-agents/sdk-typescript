import { FunctionTool } from '../function-tool.js'
import type { JSONValue } from '../../types/json.js'

interface ParseJsonInput {
  json: string
  path?: string
  pretty?: boolean
}

function successResult(text: string): JSONValue {
  return { status: 'success', content: [{ text }] }
}

function errorResult(text: string): JSONValue {
  return { status: 'error', content: [{ text }] }
}

/**
 * Simple path extraction: "items[0].name" or "data.user.id".
 * Does not support full JSONPath; supports dot notation and [index].
 */
function getByPath(obj: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let current: unknown = obj
  for (const part of parts) {
    if (current == null) return undefined
    if (typeof current !== 'object') return undefined
    const key = /^\d+$/.test(part) ? Number(part) : part
    current = (current as Record<string, unknown>)[key as string]
  }
  return current
}

function runParseJson(input: ParseJsonInput): JSONValue {
  const raw = input.json
  if (raw == null || typeof raw !== 'string') {
    return errorResult('Missing required field: json (string)')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return errorResult(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }

  const path = input.path?.trim()
  const value = path ? getByPath(parsed, path) : parsed

  if (value === undefined && path) {
    return errorResult(`Path "${path}" not found or resolved to undefined`)
  }

  const pretty = input.pretty !== false
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, pretty ? 2 : undefined)
  return successResult(text)
}

export const parseJson = new FunctionTool({
  name: 'parse_json',
  description:
    'Parse a JSON string and optionally extract a value by path. Path uses dot notation and [index] (e.g. "items[0].name", "data.user.id"). Returns the value as text; objects/arrays are stringified.',
  inputSchema: {
    type: 'object',
    properties: {
      json: { type: 'string', description: 'The JSON string to parse' },
      path: {
        type: 'string',
        description: 'Optional path to extract (e.g. "items[0].name", "config.host")',
      },
      pretty: {
        type: 'boolean',
        description: 'Pretty-print extracted object/array (default true)',
      },
    },
    required: ['json'],
  },
  callback: (input: unknown): JSONValue => runParseJson((input ?? {}) as ParseJsonInput),
})
