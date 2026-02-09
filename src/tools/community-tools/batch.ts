import type { JSONValue } from '../../types/json.js'
import type { Tool, ToolContext } from '../tool.js'
import type { ToolResultBlock } from '../../types/messages.js'
import { FunctionTool } from '../function-tool.js'

interface BatchInvocation {
  name: string
  arguments: Record<string, JSONValue>
}

interface BatchInput {
  invocations?: BatchInvocation[]
}

interface BatchInvocationResult {
  name: string
  status: 'success' | 'error'
  result?: JSONValue
  error?: string
  traceback?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined
}

function parseInvocations(input: BatchInput): BatchInvocation[] | null {
  if (!Array.isArray(input.invocations)) {
    return null
  }

  const parsed: BatchInvocation[] = []
  for (const invocation of input.invocations) {
    if (!isRecord(invocation)) {
      return null
    }
    const name = invocation.name
    const args = invocation.arguments
    if (typeof name !== 'string' || !isRecord(args)) {
      return null
    }
    parsed.push({ name, arguments: args as Record<string, JSONValue> })
  }
  return parsed
}

function findToolInRegistry(agent: unknown, toolName: string): Tool | null {
  if (!isRecord(agent)) {
    return null
  }

  const toolRegistry = agent.toolRegistry

  if (isRecord(toolRegistry) && typeof toolRegistry.get === 'function') {
    const maybeTool = (toolRegistry as { get(name: string): unknown }).get(toolName)
    if (isRecord(maybeTool) && typeof maybeTool.name === 'string' && typeof maybeTool.stream === 'function') {
      return maybeTool as unknown as Tool
    }
  }

  if (isRecord(toolRegistry) && typeof toolRegistry.values === 'function') {
    const iter = (toolRegistry as { values(): Iterable<unknown> }).values()
    for (const candidate of iter) {
      if (isRecord(candidate) && candidate.name === toolName && typeof candidate.stream === 'function') {
        return candidate as unknown as Tool
      }
    }
  }

  if (isRecord(toolRegistry) && isRecord(toolRegistry.registry)) {
    const candidate = toolRegistry.registry[toolName]
    if (isRecord(candidate) && typeof candidate.name === 'string' && typeof candidate.stream === 'function') {
      return candidate as unknown as Tool
    }
  }

  return null
}

async function invokeTool(
  tool: Tool,
  input: Record<string, JSONValue>,
  agent: ToolContext['agent']
): Promise<ToolResultBlock> {
  const toolContext: ToolContext = {
    toolUse: {
      name: tool.name,
      toolUseId: `batch-${tool.name}-${Date.now()}`,
      input,
    },
    agent,
    interrupt(): unknown {
      throw new Error('interrupt() not available in batch tool execution')
    },
  }

  const stream = tool.stream(toolContext)
  let streamResult = await stream.next()
  while (!streamResult.done) {
    streamResult = await stream.next()
  }
  return streamResult.value
}

function serializeToolResult(block: ToolResultBlock): JSONValue {
  const content: JSONValue[] = []
  for (const item of block.content) {
    if (item.type === 'textBlock') {
      content.push({ text: item.text })
      continue
    }
    if (item.type === 'jsonBlock') {
      content.push({ json: item.json })
      continue
    }
  }

  return {
    toolUseId: block.toolUseId,
    status: block.status,
    content,
  } as JSONValue
}

function getResultText(block: ToolResultBlock): string {
  const texts: string[] = []
  for (const item of block.content) {
    if (item.type === 'textBlock') {
      texts.push(item.text)
      continue
    }
    if (item.type === 'jsonBlock') {
      texts.push(JSON.stringify(item.json))
    }
  }
  return texts.join('\n')
}

async function runBatch(input: BatchInput, toolContext: ToolContext): Promise<JSONValue> {
  const invocations = parseInvocations(input)
  if (invocations == null) {
    return {
      status: 'error',
      content: [{ text: 'Invalid input: invocations must be an array of {name, arguments}' }],
    }
  }

  if (!isRecord(toolContext.agent) || !('toolRegistry' in toolContext.agent)) {
    return {
      status: 'error',
      content: [{ text: "Agent does not have a valid 'toolRegistry' attribute." }],
    }
  }

  const results = await Promise.all(
    invocations.map(async (invocation): Promise<BatchInvocationResult> => {
      const tool = findToolInRegistry(toolContext.agent, invocation.name)
      if (tool == null) {
        return {
          name: invocation.name,
          status: 'error',
          error: `Tool '${invocation.name}' not found in agent`,
        }
      }

      try {
        const block = await invokeTool(tool, invocation.arguments, toolContext.agent)
        if (block.status === 'error') {
          return {
            name: invocation.name,
            status: 'error',
            error: getResultText(block) || `Tool '${invocation.name}' returned error status`,
            result: serializeToolResult(block),
          }
        }
        return {
          name: invocation.name,
          status: 'success',
          result: serializeToolResult(block),
        }
      } catch (error) {
        const traceback = toStack(error)
        return {
          name: invocation.name,
          status: 'error',
          error: `Error executing tool '${invocation.name}': ${toErrorMessage(error)}`,
          ...(traceback != null ? { traceback } : {}),
        }
      }
    })
  )

  const successful = results.filter((result) => result.status === 'success').length
  const failed = results.length - successful
  const jsonResults: JSONValue[] = results.map((result) => {
    const serialized: Record<string, JSONValue> = {
      name: result.name,
      status: result.status,
    }
    if (result.result !== undefined) {
      serialized.result = result.result
    }
    if (result.error !== undefined) {
      serialized.error = result.error
    }
    if (result.traceback !== undefined) {
      serialized.traceback = result.traceback
    }
    return serialized
  })

  const summaryLines = [`Batch execution completed with ${results.length} tool(s):`]
  for (const result of results) {
    if (result.status === 'success') {
      summaryLines.push(`[OK] ${result.name}: Success`)
    } else {
      summaryLines.push(`[ERROR] ${result.name}: Error - ${result.error ?? 'Unknown error'}`)
    }
  }

  return {
    status: 'success',
    content: [
      { text: summaryLines.join('\n') },
      {
        json: {
          batch_summary: {
            total_tools: results.length,
            successful,
            failed,
          },
          results: jsonResults,
        },
      },
    ],
  } as JSONValue
}

export const batch = new FunctionTool({
  name: 'batch',
  description: 'Invoke multiple other tool calls from one request and aggregate results.',
  inputSchema: {
    type: 'object',
    properties: {
      invocations: {
        type: 'array',
        description: 'Tool calls to invoke',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name of the tool to invoke' },
            arguments: { type: 'object', description: 'Arguments for the tool call' },
          },
          required: ['name', 'arguments'],
        },
      },
    },
    required: ['invocations'],
  },
  callback: (input: unknown, toolContext: ToolContext): Promise<JSONValue> =>
    runBatch((input ?? {}) as BatchInput, toolContext),
})
