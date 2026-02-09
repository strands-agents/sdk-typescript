import { FunctionTool } from '../function-tool.js'
import type { JSONValue } from '../../types/json.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

/** Encoding string accepted by Node fs write methods. */
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

interface FileWriteInput {
  path: string
  content: string
  encoding?: string
  append?: boolean
}

function successResult(text: string): JSONValue {
  return { status: 'success', content: [{ text }] }
}

function errorResult(text: string): JSONValue {
  return { status: 'error', content: [{ text }] }
}

function runFileWrite(input: FileWriteInput): JSONValue {
  const filePath = input.path
  if (!filePath) {
    return errorResult('Missing required field: path')
  }

  const content = input.content
  if (content == null) {
    return errorResult('Missing required field: content')
  }

  const resolved = path.resolve(filePath)
  const dir = path.dirname(resolved)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const encoding = (input.encoding ?? 'utf-8') as FileEncoding

  if (input.append) {
    fs.appendFileSync(resolved, content, encoding)
    return successResult(`Appended ${content.length} characters to ${resolved}`)
  }

  fs.writeFileSync(resolved, content, encoding)
  return successResult(`Wrote ${content.length} characters to ${resolved}`)
}

export const fileWrite = new FunctionTool({
  name: 'file_write',
  description: 'Write content to a file. Creates parent directories if needed. Supports write and append modes.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to write' },
      content: { type: 'string', description: 'Content to write to the file' },
      encoding: { type: 'string', description: 'File encoding (default: utf-8)' },
      append: { type: 'boolean', description: 'Append to file instead of overwriting (default: false)' },
    },
    required: ['path', 'content'],
  },
  callback: (input: unknown): JSONValue => runFileWrite((input ?? {}) as FileWriteInput),
})
