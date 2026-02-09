import { Agent, BedrockModel, FunctionTool, Swarm } from '@strands-agents/sdk-fork'
import type { JSONValue, MultiAgentStreamEvent, ToolContext } from '@strands-agents/sdk-fork'
import {
  calculator,
  countdown,
  currentTime,
  environment,
  fileRead,
  fileWrite,
  journal,
  parseJson,
  retrieve,
  sleep,
  stop,
  think,
} from '@strands-agents/sdk-fork/community_tools'
import { httpRequest } from '@strands-agents/sdk-fork/vended_tools/http_request'
import {
  CURATED_MODEL_PROFILE_VALUES,
  CURATED_MODEL_SELECTION_GUIDANCE,
  DEFAULT_DYNAMIC_AGENT_PROFILE,
  DYNAMIC_AGENT_MODEL_IDS,
  DYNAMIC_AGENT_PROFILE_DEFAULTS,
  resolveCuratedBedrockModelId,
  resolveCuratedModelRegion,
} from './curated-models.js'
import { extractTokenUsageSnapshot } from './run-stream-utils.js'

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
      modelId?: string
    }
  >
  accumulatedUsage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
}

const baseCommunityTools = [
  calculator,
  countdown,
  currentTime,
  environment,
  fileRead,
  fileWrite,
  httpRequest,
  journal,
  parseJson,
  retrieve,
  sleep,
  stop,
  think,
]

type CommunityTool = (typeof baseCommunityTools)[number] | FunctionTool
const SAFE_DYNAMIC_SWARM_DEFAULT_TOOL_NAMES = ['calculator', 'current_time', 'file_read', 'parse_json', 'retrieve']
const BLOCKED_DYNAMIC_SWARM_TOOL_NAMES = new Set(['file_write', 'journal', 'swarm'])
const MAX_DYNAMIC_SWARM_RESULT_CHARS = 12000
const MAX_DYNAMIC_SWARM_TASK_CONTEXT_CHARS = 1000

function clampInt(
  value: unknown,
  fallback: number,
  minValue: number,
  maxValue: number
): number {
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

function resolveDynamicSwarmModelId(spec: DynamicSwarmAgentSpec): string {
  const settings = asRecord(spec.model_settings)
  const fromCamel = readString(settings?.modelId)
  const fromSnake = readString(settings?.model_id)
  const requestedModelId = fromCamel || fromSnake
  const requestedProfileRaw =
    readString(spec.model_profile) || readString(settings?.modelProfile) || readString(settings?.model_profile)
  const requestedProfile = requestedProfileRaw?.toLowerCase()
  const resolution = resolveCuratedBedrockModelId({
    requestedModelId,
    requestedProfile,
    defaultProfile: DEFAULT_DYNAMIC_AGENT_PROFILE,
    profileDefaults: DYNAMIC_AGENT_PROFILE_DEFAULTS,
  })

  if (requestedModelId != null && requestedModelId.length > 0 && resolution.reason !== 'requested_model') {
    console.warn(
      `Dynamic swarm model '${requestedModelId}' is not curated; using '${resolution.modelId}' (${resolution.profile} profile).`
    )
  }

  if (
    requestedProfileRaw != null &&
    requestedProfileRaw.length > 0 &&
    !CURATED_MODEL_PROFILE_VALUES.includes(requestedProfile as (typeof CURATED_MODEL_PROFILE_VALUES)[number])
  ) {
    console.warn(
      `Dynamic swarm model profile '${requestedProfileRaw}' is unknown; using '${resolution.modelId}' (${resolution.profile} profile).`
    )
  }

  if (!DYNAMIC_AGENT_MODEL_IDS.has(resolution.modelId)) {
    console.warn(
      `Resolved model '${resolution.modelId}' exceeds dynamic agent cost threshold; falling back to default profile.`
    )
    return resolveCuratedBedrockModelId({
      defaultProfile: DEFAULT_DYNAMIC_AGENT_PROFILE,
      profileDefaults: DYNAMIC_AGENT_PROFILE_DEFAULTS,
    }).modelId
  }

  return resolution.modelId
}

function createDynamicSubAgentModel(spec: DynamicSwarmAgentSpec): BedrockModel {
  const provider = readString(spec.model_provider)?.toLowerCase()
  if (provider != null && provider !== '' && provider !== 'bedrock') {
    console.warn(
      `Dynamic swarm only supports bedrock in this app. Ignoring unsupported model_provider '${provider}'.`
    )
  }

  const settings = asRecord(spec.model_settings)
  const modelId = resolveDynamicSwarmModelId(spec)
  const region =
    readString(settings?.region) ||
    resolveCuratedModelRegion(modelId, process.env.AWS_REGION || 'us-west-2')
  return new BedrockModel({ region, modelId })
}

function getParentPromptText(toolContext: ToolContext): string | undefined {
  const agentLike = toolContext.agent as { systemPrompt?: unknown }
  if (typeof agentLike.systemPrompt === 'string') return agentLike.systemPrompt
  const prompt = asRecord(agentLike.systemPrompt)?.prompt
  return typeof prompt === 'string' ? prompt : undefined
}

function summarizeTaskContext(task: string): string {
  const compact = task.replace(/\s+/g, ' ').trim()
  if (compact.length <= MAX_DYNAMIC_SWARM_TASK_CONTEXT_CHARS) return compact
  return `${compact.slice(0, MAX_DYNAMIC_SWARM_TASK_CONTEXT_CHARS)}...`
}

function inferAgentSpecialty(agentName: string): string {
  const normalized = agentName.trim().toLowerCase()
  if (normalized.includes('demand') || normalized.includes('growth') || normalized.includes('market')) {
    return 'Quantify demand, growth trajectory, and business impact from the provided data.'
  }
  if (
    normalized.includes('reliability') ||
    normalized.includes('sre') ||
    normalized.includes('incident') ||
    normalized.includes('ops')
  ) {
    return 'Assess reliability posture, incident risk, and SLA/SLO compliance using concrete evidence.'
  }
  if (normalized.includes('support') || normalized.includes('capacity') || normalized.includes('service')) {
    return 'Analyze support readiness, staffing capacity, and operational load gaps.'
  }
  if (normalized.includes('finance') || normalized.includes('cost') || normalized.includes('pricing')) {
    return 'Calculate costs, unit economics, and budget tradeoffs.'
  }
  if (normalized.includes('security') || normalized.includes('risk') || normalized.includes('compliance')) {
    return 'Evaluate security and compliance risks and propose practical mitigations.'
  }
  if (normalized.includes('editor') || normalized.includes('writer') || normalized.includes('summary')) {
    return 'Synthesize findings into concise, accurate, decision-ready output.'
  }
  if (normalized.includes('planner') || normalized.includes('pm')) {
    return 'Produce a clear, sequenced plan with assumptions and decision points.'
  }
  if (normalized.includes('coder') || normalized.includes('engineer') || normalized.includes('developer')) {
    return 'Design technically correct implementation details and validate feasibility.'
  }
  return 'Provide focused analysis for your role and return concrete, verifiable findings.'
}

function buildDynamicSubAgentPrompt(options: {
  agentName: string
  task: string
  explicitPrompt?: string
  parentPrompt?: string
  inheritParentPrompt: boolean
}): string {
  const basePrompt =
    options.explicitPrompt && options.explicitPrompt.trim() !== ''
      ? options.explicitPrompt.trim()
      : `You are ${options.agentName}, a specialist in a collaborative swarm.\n${inferAgentSpecialty(options.agentName)}`

  const sections = [basePrompt, `Task context:\n${summarizeTaskContext(options.task)}`]

  if (options.inheritParentPrompt && options.parentPrompt != null && options.parentPrompt.trim() !== '') {
    sections.push(`Parent instructions:\n${options.parentPrompt.trim()}`)
  }

  sections.push(
    'Execution rules: Stay within your specialty. Do not orchestrate new teams. Do not use hidden-reasoning markup like <thinking> tags. Return concise findings with explicit numbers when calculations are required.'
  )
  return sections.join('\n\n')
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

function annotateDynamicSwarmEventWithModel(
  event: unknown,
  modelIdByAgentName: Map<string, string>
): Record<string, unknown> | null {
  const payload = asRecord(event)
  if (payload == null || typeof payload.type !== 'string') return null
  const nodeId = readString(payload.nodeId)
  if (nodeId == null) return payload
  const modelId = modelIdByAgentName.get(nodeId)
  if (modelId == null) return payload
  return {
    ...payload,
    modelId,
  }
}

function createDynamicSwarmTool(
  resolveToolByName: (name: string) => CommunityTool | undefined,
  options: { maxRunTotalTokens: number }
): FunctionTool {
  let invocationSequence = 0
  return new FunctionTool({
    name: 'swarm',
    description:
      'Create and coordinate a custom team of AI agents for collaborative task solving with live events. ' +
      CURATED_MODEL_SELECTION_GUIDANCE,
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Primary task for the agent team' },
        agents: {
          type: 'array',
          description:
            'One object per specialist; length = number of agents created. Each object must have "name" (string) and optionally "system_prompt" (string), "tools" (array of tool names), "model_profile", "model_settings". Use agents[].model_profile or agents[].model_settings.model_id for model selection. Example: [{"name":"demand_analyst","system_prompt":"..."},{"name":"reliability_analyst","system_prompt":"..."}] for two agents.',
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
    callback: async function* (
      rawInput: unknown,
      toolContext: ToolContext
    ): AsyncGenerator<JSONValue, JSONValue, never> {
      invocationSequence += 1
      const invocationTag = `swarm_${invocationSequence}`
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
      const usedNames = new Set<string>()
      const swarmAgents: Agent[] = []
      const modelIdByAgentName = new Map<string, string>()

      for (let i = 0; i < agentSpecs.length; i += 1) {
        const spec = asRecord(agentSpecs[i]) as DynamicSwarmAgentSpec | null
        if (!spec) continue

        const rawName =
          typeof spec.name === 'string' && spec.name.trim() !== ''
            ? spec.name.trim()
            : `${invocationTag}_agent_${i + 1}`
        let name = rawName
        let suffix = 1
        while (usedNames.has(name)) {
          name = `${rawName}_${suffix}`
          suffix += 1
        }
        usedNames.add(name)

        const basePrompt =
          typeof spec.system_prompt === 'string' && spec.system_prompt.trim() !== ''
            ? spec.system_prompt
            : undefined
        const systemPrompt = buildDynamicSubAgentPrompt({
          agentName: name,
          task,
          explicitPrompt: basePrompt,
          parentPrompt,
          inheritParentPrompt: spec.inherit_parent_prompt === true,
        })

        let toolsForAgent: CommunityTool[] = []
        if (Array.isArray(spec.tools)) {
          const seenToolNames = new Set<string>()
          for (const rawToolName of spec.tools) {
            if (typeof rawToolName !== 'string') continue
            const toolName = rawToolName.trim()
            if (toolName === '') continue
            if (BLOCKED_DYNAMIC_SWARM_TOOL_NAMES.has(toolName)) {
              console.warn(`Blocked high-risk tool '${toolName}' from dynamic sub-agent '${name}'`)
              continue
            }
            const tool = resolveToolByName(toolName)
            if (tool != null && !seenToolNames.has(tool.name)) {
              toolsForAgent.push(tool)
              seenToolNames.add(tool.name)
            }
          }
        } else {
          for (const toolName of SAFE_DYNAMIC_SWARM_DEFAULT_TOOL_NAMES) {
            const tool = resolveToolByName(toolName)
            if (tool != null) toolsForAgent.push(tool)
          }
        }

        const subAgentModel = createDynamicSubAgentModel(spec)
        const configuredModelId = subAgentModel.getConfig?.()?.modelId
        if (typeof configuredModelId === 'string' && configuredModelId.trim() !== '') {
          modelIdByAgentName.set(name, configuredModelId.trim())
        }

        swarmAgents.push(
          new Agent({
            name,
            model: subAgentModel,
            systemPrompt,
            tools: toolsForAgent,
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
        repetitiveHandoffDetectionWindow:
          clampInt(input.repetitive_handoff_detection_window, 8, 3, 12),
        repetitiveHandoffMinUniqueAgents:
          clampInt(input.repetitive_handoff_min_unique_agents, 3, 2, 6),
      })

      let result: DynamicSwarmResult | null = null
      const stream = dynamicSwarm.stream(task) as AsyncGenerator<MultiAgentStreamEvent, unknown>
      const nodeTokenTotals = new Map<string, number>()
      let observedTotalTokens = 0
      let next = await stream.next()
      while (!next.done) {
        const annotatedEvent =
          annotateDynamicSwarmEventWithModel(next.value, modelIdByAgentName) ?? asRecord(next.value)
        const payload = asRecord(annotatedEvent)
        if (payload != null && typeof payload.type === 'string') {
          const snapshot = extractTokenUsageSnapshot(payload.type, payload)
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
        }
        if (observedTotalTokens > options.maxRunTotalTokens) {
          return {
            status: 'error',
            content: [
              {
                text: `Dynamic swarm aborted after hitting token budget (${options.maxRunTotalTokens.toLocaleString()} tokens).`,
              },
            ],
          }
        }
        yield (annotatedEvent ?? next.value) as unknown as JSONValue
        next = await stream.next()
      }
      result = (next.value as DynamicSwarmResult) ?? null
      if (result?.results != null) {
        for (const [agentName, nodeResult] of Object.entries(result.results)) {
          if (nodeResult == null || typeof nodeResult !== 'object') continue
          const modelId = modelIdByAgentName.get(agentName)
          if (modelId == null) continue
          ;(nodeResult as { modelId?: string }).modelId = modelId
        }
      }

      if (result == null) {
        return { status: 'error', content: [{ text: 'Custom swarm execution ended without a result' }] }
      }
      const finalTotalTokens =
        result.accumulatedUsage?.totalTokens ??
        ((result.accumulatedUsage?.inputTokens != null || result.accumulatedUsage?.outputTokens != null)
          ? (result.accumulatedUsage?.inputTokens ?? 0) + (result.accumulatedUsage?.outputTokens ?? 0)
          : undefined)
      if (finalTotalTokens != null && finalTotalTokens > options.maxRunTotalTokens) {
        return {
          status: 'error',
          content: [
            {
              text: `Dynamic swarm exceeded token budget (${finalTotalTokens.toLocaleString()} > ${options.maxRunTotalTokens.toLocaleString()}).`,
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
          .map((node) => (node != null && typeof node === 'object' ? (node as { nodeId?: string }).nodeId ?? '?' : '?'))
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
          lastNode != null && typeof lastNode === 'object'
            ? ((lastNode as { nodeId?: string }).nodeId ?? '')
            : ''
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
}

export function createCommunityTools(options: { maxRunTotalTokens: number }): {
  communityTools: CommunityTool[]
  getToolsForAgent: (agentTools: string[] | undefined) => CommunityTool[]
} {
  const toolByName = new Map<string, CommunityTool>(baseCommunityTools.map((t) => [t.name, t]))
  const swarmTool = createDynamicSwarmTool((name) => toolByName.get(name), options)
  toolByName.set(swarmTool.name, swarmTool)
  const communityTools: CommunityTool[] = [...baseCommunityTools, swarmTool]

  const getToolsForAgent = (agentTools: string[] | undefined): CommunityTool[] => {
    if (agentTools == null) return []
    if (agentTools.length === 0) return []
    const out: CommunityTool[] = []
    const seen = new Set<string>()
    const missing: string[] = []
    for (const name of agentTools) {
      const t = toolByName.get(name)
      if (t && !seen.has(t.name)) {
        out.push(t)
        seen.add(t.name)
      } else if (!t) {
        missing.push(name)
      }
    }
    if (missing.length > 0) {
      console.warn(`Unknown tools requested and ignored: ${missing.join(', ')}`)
    }
    return out
  }

  return { communityTools, getToolsForAgent }
}
