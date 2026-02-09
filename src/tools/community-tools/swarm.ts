import { Agent } from '../../agent/agent.js'
import { BedrockModel } from '../../models/bedrock.js'
import { Swarm } from '../../multiagent/swarm.js'
import type { MultiAgentStreamEvent } from '../../multiagent/types.js'
import type { Model } from '../../models/model.js'
import type { JSONValue } from '../../types/json.js'
import { FunctionTool } from '../function-tool.js'
import type { Tool, ToolContext } from '../tool.js'
import { getParentModel, getParentTools, resolveParentTools } from './multiagent-utils.js'

interface DynamicSwarmAgentSpec {
  name?: string
  system_prompt?: string
  tools?: string[]
  model_provider?: string
  model_profile?: string
  model_settings?: Record<string, unknown>
  inherit_parent_prompt?: boolean
}

interface DynamicSwarmInput {
  task?: string
  agents?: DynamicSwarmAgentSpec[]
  max_handoffs?: number
  max_iterations?: number
  execution_timeout?: number
  node_timeout?: number
  repetitive_handoff_detection_window?: number
  repetitive_handoff_min_unique_agents?: number
}

interface DynamicSwarmResult {
  status?: string
  executionTime?: number
  executionCount?: number
  nodeHistory?: Array<{ nodeId?: string }>
  results?: Record<
    string,
    {
      result?: { toString?: () => string }
      getAgentResults?: () => Array<{ toString: () => string }>
    }
  >
  accumulatedUsage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
}

const SAFE_DEFAULT_SUBAGENT_TOOLS = ['calculator', 'current_time', 'file_read', 'parse_json', 'retrieve']
const BLOCKED_SUBAGENT_TOOLS = new Set(['file_write', 'journal', 'swarm'])
const MAX_DYNAMIC_SWARM_RESULT_CHARS = 12000
const SWARM_TOKEN_BUDGET = ((): number => {
  const parsed = Number.parseInt(process.env.STRANDS_SWARM_MAX_TOKENS ?? '100000', 10)
  if (Number.isFinite(parsed) && parsed >= 1000) return parsed
  return 100000
})()

function clampInt(value: unknown, fallback: number, minValue: number, maxValue: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.floor(value)
  return Math.min(maxValue, Math.max(minValue, rounded))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function extractTotalTokensFromUsage(usage: unknown): number | null {
  const data = asRecord(usage)
  if (!data) return null
  if (typeof data.totalTokens === 'number' && Number.isFinite(data.totalTokens)) {
    return Math.max(0, Math.floor(data.totalTokens))
  }
  const input = typeof data.inputTokens === 'number' && Number.isFinite(data.inputTokens) ? data.inputTokens : 0
  const output = typeof data.outputTokens === 'number' && Number.isFinite(data.outputTokens) ? data.outputTokens : 0
  if (input > 0 || output > 0) return Math.max(0, Math.floor(input + output))
  return null
}

function extractTokenUsageSnapshot(
  event: unknown
): { scope: 'node' | 'run'; nodeId: string | null; totalTokens: number } | null {
  const payload = asRecord(event)
  if (!payload || typeof payload.type !== 'string') return null

  if (payload.type === 'multiAgentNodeStopEvent') {
    const nodeResult = asRecord(payload.nodeResult)
    const direct = extractTotalTokensFromUsage(nodeResult?.accumulatedUsage)
    if (direct != null) {
      return {
        scope: 'node',
        nodeId: typeof payload.nodeId === 'string' ? payload.nodeId : null,
        totalTokens: direct,
      }
    }

    const result = asRecord(nodeResult?.result)
    const metrics = asRecord(result?.metrics)
    const nested = extractTotalTokensFromUsage(metrics?.accumulatedUsage)
    if (nested != null) {
      return {
        scope: 'node',
        nodeId: typeof payload.nodeId === 'string' ? payload.nodeId : null,
        totalTokens: nested,
      }
    }
  }

  if (payload.type === 'multiAgentResultEvent') {
    const result = asRecord(payload.result)
    const total = extractTotalTokensFromUsage(result?.accumulatedUsage)
    if (total != null) return { scope: 'run', nodeId: null, totalTokens: total }
  }

  return null
}

function getParentPromptText(toolContext: ToolContext): string | undefined {
  const agentLike = toolContext.agent as { systemPrompt?: unknown }
  if (typeof agentLike.systemPrompt === 'string') return agentLike.systemPrompt
  const prompt = asRecord(agentLike.systemPrompt)?.prompt
  return typeof prompt === 'string' ? prompt : undefined
}

function getResultTexts(nodeResult: unknown): string[] {
  const out: string[] = []
  const entry = asRecord(nodeResult)
  if (!entry) return out

  if (typeof entry.getAgentResults === 'function') {
    const raw = entry.getAgentResults()
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (
          item != null &&
          typeof item === 'object' &&
          typeof (item as { toString?: () => string }).toString === 'function'
        ) {
          const text = (item as { toString: () => string }).toString().trim()
          if (text !== '') out.push(text)
        }
      }
    }
    if (out.length > 0) return out
  }

  const direct = entry.result
  if (
    direct != null &&
    typeof direct === 'object' &&
    typeof (direct as { toString?: () => string }).toString === 'function'
  ) {
    const text = (direct as { toString: () => string }).toString().trim()
    if (text !== '') out.push(text)
  }

  return out
}

function resolveSubAgentTools(spec: DynamicSwarmAgentSpec, parentAgent: unknown): Tool[] {
  if (Array.isArray(spec.tools)) {
    const requested = resolveParentTools(parentAgent, spec.tools)
    const out: Tool[] = []
    const seen = new Set<string>()
    for (const tool of requested) {
      if (seen.has(tool.name)) continue
      if (BLOCKED_SUBAGENT_TOOLS.has(tool.name)) continue
      out.push(tool)
      seen.add(tool.name)
    }
    return out
  }

  const defaults = new Set(SAFE_DEFAULT_SUBAGENT_TOOLS)
  return getParentTools(parentAgent).filter((tool) => !BLOCKED_SUBAGENT_TOOLS.has(tool.name) && defaults.has(tool.name))
}

function resolveBedrockModelId(spec: DynamicSwarmAgentSpec, parentModel: Model | undefined): string | undefined {
  const settings = asRecord(spec.model_settings)
  const fromCamel = readString(settings?.modelId)
  const fromSnake = readString(settings?.model_id)
  const configured = fromCamel || fromSnake
  if (configured != null && configured !== '') return configured

  const envDefault = process.env.STRANDS_SUBAGENT_MODEL_ID?.trim()
  if (envDefault != null && envDefault !== '') return envDefault

  if (parentModel instanceof BedrockModel) {
    const parentId = parentModel.getConfig?.().modelId
    if (typeof parentId === 'string' && parentId.trim() !== '') return parentId.trim()
  }

  return undefined
}

function createDynamicSubAgentModel(spec: DynamicSwarmAgentSpec, parentModel: Model | undefined): Model {
  const provider = readString(spec.model_provider)?.toLowerCase()
  if (provider != null && provider !== '' && provider !== 'bedrock') {
    console.warn(`Swarm tool only supports bedrock sub-agents; ignoring model_provider '${provider}'.`)
  }

  if (spec.model_profile != null && spec.model_profile.trim() !== '') {
    console.warn(`Swarm tool ignores model_profile '${spec.model_profile}' unless mapped by caller.`)
  }

  const settings = asRecord(spec.model_settings)
  const region = readString(settings?.region) || process.env.AWS_REGION || 'us-west-2'
  const modelId = resolveBedrockModelId(spec, parentModel)
  if (modelId != null) {
    return new BedrockModel({ region, modelId })
  }

  if (parentModel != null) return parentModel
  throw new Error('No sub-agent model could be resolved. Set model_settings.model_id or STRANDS_SUBAGENT_MODEL_ID.')
}

export const swarm = new FunctionTool({
  name: 'swarm',
  description: 'Create and coordinate a custom team of AI agents for collaborative task solving with live events.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Primary task for the agent team' },
      agents: {
        type: 'array',
        description: 'Agent specifications. Use agents[].model_settings.model_id for explicit sub-agent models.',
        items: { type: 'object' },
      },
      max_handoffs: { type: 'number', description: 'Maximum number of handoffs' },
      max_iterations: { type: 'number', description: 'Maximum total iterations' },
      execution_timeout: { type: 'number', description: 'Maximum execution time in seconds' },
      node_timeout: { type: 'number', description: 'Maximum per-agent execution time in seconds' },
      repetitive_handoff_detection_window: {
        type: 'number',
        description: 'Window size for repetitive handoff detection',
      },
      repetitive_handoff_min_unique_agents: {
        type: 'number',
        description: 'Minimum unique agents in handoff detection window',
      },
    },
    required: ['task', 'agents'],
  },
  callback: async function* (rawInput: unknown, toolContext: ToolContext): AsyncGenerator<JSONValue, JSONValue, never> {
    const input = (asRecord(rawInput) ?? {}) as DynamicSwarmInput
    const task = typeof input.task === 'string' ? input.task.trim() : ''
    if (task === '') {
      return { status: 'error', content: [{ text: 'task is required' }] }
    }

    const agentSpecs = Array.isArray(input.agents) ? input.agents : []
    if (agentSpecs.length === 0) {
      return { status: 'error', content: [{ text: 'At least one agent specification is required' }] }
    }
    if (agentSpecs.length > 6) {
      return {
        status: 'error',
        content: [{ text: 'At most 6 dynamic swarm agents are allowed for cost and convergence safety.' }],
      }
    }

    const parentPrompt = getParentPromptText(toolContext)
    const parentModel = getParentModel(toolContext.agent)
    const usedNames = new Set<string>()
    const swarmAgents: Agent[] = []

    for (let i = 0; i < agentSpecs.length; i += 1) {
      const spec = asRecord(agentSpecs[i]) as DynamicSwarmAgentSpec | null
      if (!spec) continue

      const rawName =
        typeof spec.name === 'string' && spec.name.trim() !== '' ? spec.name.trim() : `swarm_agent_${i + 1}`
      let name = rawName
      let suffix = 1
      while (usedNames.has(name)) {
        name = `${rawName}_${suffix}`
        suffix += 1
      }
      usedNames.add(name)

      const defaultPrompt = 'You are a helpful AI assistant specializing in collaborative problem solving.'
      const basePrompt =
        typeof spec.system_prompt === 'string' && spec.system_prompt.trim() !== '' ? spec.system_prompt : undefined
      let systemPrompt = basePrompt ?? defaultPrompt
      if (basePrompt == null && parentPrompt != null) {
        systemPrompt = `${systemPrompt}\n\nBase Instructions:\n${parentPrompt}`
      } else if (spec.inherit_parent_prompt === true && parentPrompt != null) {
        systemPrompt = `${systemPrompt}\n\nBase Instructions:\n${parentPrompt}`
      }

      swarmAgents.push(
        new Agent({
          name,
          model: createDynamicSubAgentModel(spec, parentModel),
          systemPrompt,
          tools: resolveSubAgentTools(spec, toolContext.agent),
          printer: false,
        })
      )
    }

    if (swarmAgents.length === 0) {
      return { status: 'error', content: [{ text: 'No valid agent specifications were provided' }] }
    }

    const dynamicSwarm = new Swarm({
      nodes: swarmAgents,
      maxHandoffs: clampInt(input.max_handoffs, 6, 1, 12),
      maxIterations: clampInt(input.max_iterations, 10, 1, 16),
      executionTimeout: clampInt(input.execution_timeout, 180, 30, 300),
      nodeTimeout: clampInt(input.node_timeout, 45, 10, 90),
      repetitiveHandoffDetectionWindow: clampInt(input.repetitive_handoff_detection_window, 8, 3, 12),
      repetitiveHandoffMinUniqueAgents: clampInt(input.repetitive_handoff_min_unique_agents, 3, 2, 6),
    })

    let result: DynamicSwarmResult | null = null
    const stream = dynamicSwarm.stream(task) as AsyncGenerator<MultiAgentStreamEvent, unknown>
    const nodeTokenTotals = new Map<string, number>()
    let observedTotalTokens = 0
    let next = await stream.next()
    while (!next.done) {
      const snapshot = extractTokenUsageSnapshot(next.value)
      if (snapshot != null) {
        if (snapshot.scope === 'run') {
          observedTotalTokens = Math.max(observedTotalTokens, snapshot.totalTokens)
        } else if (snapshot.nodeId != null && snapshot.nodeId.trim() !== '') {
          const previous = nodeTokenTotals.get(snapshot.nodeId) ?? 0
          if (snapshot.totalTokens >= previous) {
            observedTotalTokens += snapshot.totalTokens - previous
            nodeTokenTotals.set(snapshot.nodeId, snapshot.totalTokens)
          } else {
            observedTotalTokens += snapshot.totalTokens
            nodeTokenTotals.set(snapshot.nodeId, previous + snapshot.totalTokens)
          }
        } else {
          observedTotalTokens = Math.max(observedTotalTokens, snapshot.totalTokens)
        }
      }

      if (observedTotalTokens > SWARM_TOKEN_BUDGET) {
        return {
          status: 'error',
          content: [
            {
              text: `Dynamic swarm aborted after hitting token budget (${SWARM_TOKEN_BUDGET.toLocaleString()} tokens).`,
            },
          ],
        }
      }

      yield next.value as unknown as JSONValue
      next = await stream.next()
    }

    result = (next.value as DynamicSwarmResult) ?? null
    if (result == null) {
      return { status: 'error', content: [{ text: 'Custom swarm execution ended without a result' }] }
    }

    const finalTotalTokens =
      result.accumulatedUsage?.totalTokens ??
      (result.accumulatedUsage?.inputTokens != null || result.accumulatedUsage?.outputTokens != null
        ? (result.accumulatedUsage?.inputTokens ?? 0) + (result.accumulatedUsage?.outputTokens ?? 0)
        : undefined)

    if (finalTotalTokens != null && finalTotalTokens > SWARM_TOKEN_BUDGET) {
      return {
        status: 'error',
        content: [
          {
            text: `Dynamic swarm exceeded token budget (${finalTotalTokens.toLocaleString()} > ${SWARM_TOKEN_BUDGET.toLocaleString()}).`,
          },
        ],
      }
    }

    const parts: string[] = []
    parts.push('Custom Agent Team Execution Complete')
    parts.push(`Status: ${result.status ?? 'unknown'}`)
    parts.push(`Execution Time: ${result.executionTime ?? 0}ms`)
    parts.push(`Team Size: ${swarmAgents.length} agents`)
    parts.push(`Iterations: ${result.executionCount ?? 0}`)

    const nodeHistory = Array.isArray(result.nodeHistory) ? result.nodeHistory : []
    if (nodeHistory.length > 0) {
      const chain = nodeHistory
        .map((node) => (node != null && typeof node === 'object' ? ((node as { nodeId?: string }).nodeId ?? '?') : '?'))
        .join(' -> ')
      parts.push(`Collaboration Chain: ${chain}`)
    }

    const results = result.results ?? {}
    const resultEntries = Object.entries(results)
    if (resultEntries.length > 0) {
      parts.push('')
      parts.push('Individual Agent Contributions:')
      for (const [agentName, nodeResult] of resultEntries) {
        const texts = getResultTexts(nodeResult)
        if (texts.length > 0) {
          parts.push(`${agentName}:`)
          parts.push(...texts)
        }
      }
    }

    if (nodeHistory.length > 0 && resultEntries.length > 0) {
      const lastNode = nodeHistory[nodeHistory.length - 1]
      const lastNodeId =
        lastNode != null && typeof lastNode === 'object' ? ((lastNode as { nodeId?: string }).nodeId ?? '') : ''
      const finalTexts = lastNodeId !== '' ? getResultTexts(results[lastNodeId]) : []
      if (finalTexts.length > 0) {
        parts.push('')
        parts.push('Final Team Result:')
        parts.push(...finalTexts)
      }
    }

    const usage = result.accumulatedUsage ?? {}
    parts.push('')
    parts.push('Team Resource Usage:')
    parts.push(`Input tokens: ${usage.inputTokens ?? 0}`)
    parts.push(`Output tokens: ${usage.outputTokens ?? 0}`)
    parts.push(`Total tokens: ${usage.totalTokens ?? 0}`)

    const fullText = parts.join('\n')
    const text =
      fullText.length > MAX_DYNAMIC_SWARM_RESULT_CHARS
        ? `${fullText.slice(0, MAX_DYNAMIC_SWARM_RESULT_CHARS)}\n\n[dynamic swarm output truncated due size limits]`
        : fullText

    return { status: 'success', content: [{ text }] }
  },
})
