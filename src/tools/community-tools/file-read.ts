import { FunctionTool } from '../function-tool.js'
import type { JSONValue } from '../../types/json.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

/** Encoding string accepted by Node fs.readFileSync when returning string. */
type FileEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'utf-16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex'

interface FileReadInput {
  path: string
  encoding?: string
}

function successResult(text: string): JSONValue {
  return { status: 'success', content: [{ text }] }
}

function errorResult(text: string): JSONValue {
  return { status: 'error', content: [{ text }] }
}

const MAX_FILE_SIZE = 1_000_000

function runFileRead(input: FileReadInput): JSONValue {
  const filePath = input.path
  if (!filePath) {
    return errorResult('Missing required field: path')
  }

  const resolved = path.resolve(filePath)

  if (!fs.existsSync(resolved)) {
    return errorResult(`File not found: ${resolved}`)
  }

  const stats = fs.statSync(resolved)
  if (!stats.isFile()) {
    return errorResult(`Not a file: ${resolved}`)
  }

  if (stats.size > MAX_FILE_SIZE) {
    return errorResult(`File too large (${stats.size} bytes). Maximum is ${MAX_FILE_SIZE} bytes`)
  }

  const encoding = (input.encoding ?? 'utf-8') as FileEncoding
  const content = fs.readFileSync(resolved, encoding)
  return successResult(content)
}

export const fileRead = new FunctionTool({
  name: 'file_read',
  description: 'Read the contents of a file. Returns the file content as text.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to read' },
      encoding: { type: 'string', description: 'File encoding (default: utf-8)' },
    },
    required: ['path'],
  },
  callback: (input: unknown): JSONValue => runFileRead((input ?? {}) as FileReadInput),
})
