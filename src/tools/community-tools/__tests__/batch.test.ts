import { FunctionTool } from '../../function-tool.js'
import type { JSONValue } from '../../../types/json.js'
import type { ToolResultBlock } from '../../../types/messages.js'
import { describe, expect, it } from 'vitest'
import { batch } from '../batch.js'
import { createMockToolContext, getToolResultText, runToolStream } from './test-helpers.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getBatchPayload(block: ToolResultBlock): Record<string, unknown> {
  for (const item of block.content) {
    if (item.type === 'jsonBlock' && isRecord(item.json)) {
      const direct = item.json
      if (isRecord(direct.batch_summary) && Array.isArray(direct.results)) {
        return direct
      }

      const nestedContent = direct.content
      if (Array.isArray(nestedContent)) {
        for (const nested of nestedContent) {
          if (isRecord(nested) && isRecord(nested.json)) {
            const candidate = nested.json
            if (isRecord(candidate.batch_summary) && Array.isArray(candidate.results)) {
              return candidate
            }
          }
        }
      }
    }
  }
  throw new Error('Expected batch payload')
}

function makeEchoTool(name: string): FunctionTool {
  return new FunctionTool({
    name,
    description: `${name} test tool`,
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    callback: (input: unknown): JSONValue => {
      const value = isRecord(input) && typeof input.value === 'string' ? input.value : ''
      return { status: 'success', content: [{ text: `${name}:${value}` }] }
    },
  })
}

function makeFailTool(name: string): FunctionTool {
  return new FunctionTool({
    name,
    description: `${name} failure tool`,
    inputSchema: { type: 'object', properties: {} },
    callback: (): JSONValue => {
      throw new Error('Tool execution failed')
    },
  })
}

describe('batch tool', () => {
  it('has correct name and schema', () => {
    expect(batch.name).toBe('batch')
    expect(batch.toolSpec.inputSchema).toBeDefined()
  })

  it('returns error for invalid invocations input', async () => {
    const ctx = createMockToolContext(
      'batch',
      { invocations: 'not-an-array' as unknown as JSONValue },
      { toolRegistry: new Map() }
    )
    const block = await runToolStream(batch, ctx)
    const text = getToolResultText(block)
    expect(text).toContain('Invalid input')
  })

  it('returns error when agent has no toolRegistry', async () => {
    const ctx = createMockToolContext('batch', { invocations: [] }, {})
    const block = await runToolStream(batch, ctx)
    const text = getToolResultText(block)
    expect(text).toContain('toolRegistry')
  })

  it('executes multiple tools and returns aggregated summary', async () => {
    const echoOne = makeEchoTool('echo_one')
    const echoTwo = makeEchoTool('echo_two')
    const agent = {
      toolRegistry: new Map<string, unknown>([
        ['echo_one', echoOne],
        ['echo_two', echoTwo],
      ]),
    }

    const ctx = createMockToolContext(
      'batch',
      {
        invocations: [
          { name: 'echo_one', arguments: { value: 'a' } },
          { name: 'echo_two', arguments: { value: 'b' } },
        ],
      },
      agent
    )
    const block = await runToolStream(batch, ctx)
    const text = getToolResultText(block)
    expect(text).toContain('Batch execution completed with 2 tool(s)')
    expect(text).toContain('[OK] echo_one')
    expect(text).toContain('[OK] echo_two')

    const payload = getBatchPayload(block)
    const summary = payload.batch_summary
    expect(isRecord(summary)).toBe(true)
    if (!isRecord(summary)) {
      throw new Error('Summary payload missing')
    }
    expect(summary.total_tools).toBe(2)
    expect(summary.successful).toBe(2)
    expect(summary.failed).toBe(0)
  })

  it('marks missing tools as errors but keeps overall batch success', async () => {
    const echo = makeEchoTool('echo')
    const agent = { toolRegistry: new Map<string, unknown>([['echo', echo]]) }
    const ctx = createMockToolContext(
      'batch',
      {
        invocations: [{ name: 'does_not_exist', arguments: {} }],
      },
      agent
    )
    const block = await runToolStream(batch, ctx)
    const text = getToolResultText(block)
    expect(text).toContain('[ERROR] does_not_exist')

    const payload = getBatchPayload(block)
    const summary = payload.batch_summary
    expect(isRecord(summary)).toBe(true)
    if (!isRecord(summary)) {
      throw new Error('Summary payload missing')
    }
    expect(summary.total_tools).toBe(1)
    expect(summary.successful).toBe(0)
    expect(summary.failed).toBe(1)
  })

  it('captures per-invocation tool exceptions with error details', async () => {
    const failing = makeFailTool('error_tool')
    const agent = { toolRegistry: new Map<string, unknown>([['error_tool', failing]]) }
    const ctx = createMockToolContext(
      'batch',
      {
        invocations: [{ name: 'error_tool', arguments: {} }],
      },
      agent
    )

    const block = await runToolStream(batch, ctx)
    const payload = getBatchPayload(block)
    const results = payload.results
    expect(Array.isArray(results)).toBe(true)
    if (!Array.isArray(results)) {
      throw new Error('Results payload missing')
    }
    const first = results[0]
    expect(isRecord(first)).toBe(true)
    if (!isRecord(first)) {
      throw new Error('First result missing')
    }
    expect(first.status).toBe('error')
    expect(typeof first.error).toBe('string')
    expect(String(first.error)).toContain('Tool execution failed')
  })
})
