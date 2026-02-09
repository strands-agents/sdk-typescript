import type { RunRequest } from './run-request.js'

export interface RunToolPolicy {
  maxTotalToolUses: number
  defaultPerToolLimit: number
  perToolLimits: Record<string, number>
  blockedTools: Set<string>
}

export interface ToolUseGuardState {
  totalToolUses: number
  perToolUses: Map<string, number>
  seenToolUseIds: Set<string>
}

export interface BuildSummaryAndMetricsResult {
  status: string | undefined
  text: string
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined
  executionTime: number | undefined
  nodeHistory?: string[]
  executionOrder?: string[]
  perNode?: Array<{
    nodeId: string
    status: string
    modelId?: string
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    executionTime?: number
  }>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

export function buildSummaryAndMetrics(result: unknown): BuildSummaryAndMetricsResult {
  const status =
    result != null && typeof result === 'object' && 'status' in result
      ? String((result as { status: string }).status)
      : undefined
  const extractNodeResultText = (nodeResult: unknown): string => {
    const entry = asRecord(nodeResult)
    if (!entry) return ''

    const directResult = asRecord(entry.result)
    if (directResult != null && typeof directResult.toString === 'function') {
      const rendered = directResult.toString()
      if (rendered && rendered !== '[object Object]') return rendered
    }

    if (typeof entry.getAgentResults === 'function') {
      const raw = entry.getAgentResults()
      if (Array.isArray(raw)) {
        const parts = raw
          .map((item) =>
            item != null && typeof item === 'object' && typeof (item as { toString?: () => string }).toString === 'function'
              ? (item as { toString: () => string }).toString()
              : ''
          )
          .map((value) => value.trim())
          .filter((value) => value !== '' && value !== '[object Object]')
        if (parts.length > 0) return parts.join('\n')
      }
    }

    return ''
  }

  let text = ''
  if (result != null && typeof result === 'object' && 'results' in result) {
    const results = (
      result as { results: Record<string, { result?: { toString?: () => string }; status?: string }> }
    ).results
    const resultEntries = Object.entries(results ?? {})

    const executionOrderRaw =
      result != null && typeof result === 'object' && 'executionOrder' in result
        ? (result as { executionOrder?: Array<{ nodeId?: string }> }).executionOrder
        : undefined
    const executionOrderIds = Array.isArray(executionOrderRaw)
      ? executionOrderRaw
          .map((entry) => (entry != null && typeof entry === 'object' ? (entry as { nodeId?: string }).nodeId : undefined))
          .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      : []

    const nodeHistoryRaw =
      result != null && typeof result === 'object' && 'nodeHistory' in result
        ? (result as { nodeHistory?: Array<{ nodeId?: string }> }).nodeHistory
        : undefined
    const nodeHistoryIds = Array.isArray(nodeHistoryRaw)
      ? nodeHistoryRaw
          .map((entry) => (entry != null && typeof entry === 'object' ? (entry as { nodeId?: string }).nodeId : undefined))
          .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      : []

    const preferredOrder = executionOrderIds.length > 0 ? executionOrderIds : nodeHistoryIds
    if (preferredOrder.length > 0) {
      for (let i = preferredOrder.length - 1; i >= 0; i -= 1) {
        const nodeId = preferredOrder[i]
        if (nodeId == null) continue
        const candidate = results[nodeId]
        const rendered = extractNodeResultText(candidate)
        if (rendered !== '') {
          text = rendered
          break
        }
      }
    }

    if (text === '' && resultEntries.length > 0) {
      for (let i = resultEntries.length - 1; i >= 0; i -= 1) {
        const rendered = extractNodeResultText(resultEntries[i]?.[1])
        if (rendered !== '') {
          text = rendered
          break
        }
      }
    }
  }
  if (
    !text &&
    result != null &&
    typeof result === 'object' &&
    'toString' in result &&
    typeof (result as { toString: () => string }).toString === 'function'
  ) {
    const raw = (result as { toString: () => string }).toString()
    if (raw !== '[object Object]') text = raw
  }
  if (!text && result != null && typeof result === 'object' && 'nodeHistory' in result) {
    const arr = (result as { nodeHistory: Array<{ nodeId?: string }> }).nodeHistory
    const names = Array.isArray(arr) ? arr.map((n) => n?.nodeId ?? '?').filter(Boolean) : []
    if (names.length > 0) text = `Nodes run: ${names.join(' → ')}`
  }
  const usage =
    result != null && typeof result === 'object' && 'accumulatedUsage' in result
      ? (result as { accumulatedUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } })
          .accumulatedUsage
      : undefined
  const executionTime =
    result != null && typeof result === 'object' && 'executionTime' in result
      ? (result as { executionTime?: number }).executionTime
      : undefined
  let nodeHistory: string[] | undefined
  let executionOrder: string[] | undefined
  const perNode: Array<{
    nodeId: string
    status: string
    modelId?: string
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    executionTime?: number
  }> = []
  if (result != null && typeof result === 'object' && 'nodeHistory' in result) {
    const arr = (result as { nodeHistory: Array<{ nodeId?: string }> }).nodeHistory
    nodeHistory = arr.map((n) => n?.nodeId ?? '?').filter(Boolean)
  }
  if (result != null && typeof result === 'object' && 'executionOrder' in result) {
    const arr = (result as { executionOrder: Array<{ nodeId?: string }> }).executionOrder
    executionOrder = Array.isArray(arr) ? arr.map((n) => n?.nodeId ?? '?').filter(Boolean) : undefined
  }
  if (result != null && typeof result === 'object' && 'results' in result) {
    const results = (
      result as {
        results: Record<
          string,
          {
            status?: string
            executionTime?: number
            accumulatedUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
          }
        >
      }
    ).results
    for (const [nodeId, nr] of Object.entries(results)) {
      const statusStr = nr?.status != null ? String(nr.status) : 'unknown'
      const executionTimeMs = nr?.executionTime
      const u = nr?.accumulatedUsage
      perNode.push({
        nodeId,
        status: statusStr,
        modelId: extractNodeModelId(nr),
        inputTokens: u?.inputTokens,
        outputTokens: u?.outputTokens,
        totalTokens:
          u?.totalTokens != null
            ? u.totalTokens
            : u?.inputTokens != null || u?.outputTokens != null
            ? (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0)
            : undefined,
        executionTime: executionTimeMs,
      })
    }
  }
  return { status, text, usage, executionTime, nodeHistory, executionOrder, perNode }
}

export function summarizeEventDetail(eventType: string, payload: Record<string, unknown>): string | null {
  if (eventType === 'multiAgentHandoffEvent') {
    const from = Array.isArray(payload.fromNodeIds) ? String(payload.fromNodeIds[0] ?? '') : ''
    const to = Array.isArray(payload.toNodeIds) ? String(payload.toNodeIds[0] ?? '') : ''
    return `${from || '?'} -> ${to || '?'}`
  }

  if (eventType === 'multiAgentNodeStartEvent') {
    return 'Started'
  }

  if (eventType === 'multiAgentNodeStopEvent') {
    const nodeResult = payload.nodeResult as { status?: string } | undefined
    if (typeof nodeResult?.status === 'string') return nodeResult.status
    return 'Stopped'
  }

  if (eventType === 'multiAgentNodeStreamEvent') {
    const nested = extractNestedMultiAgentEvent(payload.event, typeof payload.nodeId === 'string' ? payload.nodeId : undefined)
    if (nested != null) {
      return summarizeEventDetail(nested.eventType, nested.payload) ?? `nested:${nested.eventType}`
    }
    const text = extractStreamChunk(payload.event)?.trim()
    if (text) {
      return text.length > 120 ? `${text.slice(0, 120)}...` : text
    }
  }

  if (eventType === 'multiAgentResultEvent') {
    return 'Result emitted'
  }

  return null
}

export function extractNestedMultiAgentEvent(
  event: unknown,
  fallbackNodeId?: string
): { eventType: string; payload: Record<string, unknown> } | null {
  const ev = asRecord(event)
  if (!ev) return null

  if (ev.type === 'modelStreamEventHook') {
    return extractNestedMultiAgentEvent(ev.event, fallbackNodeId)
  }

  if (ev.type !== 'toolStreamEvent') return null
  const nested = asRecord(ev.data)
  if (!nested || typeof nested.type !== 'string' || !nested.type.startsWith('multiAgent')) return null
  const payload: Record<string, unknown> = { ...nested }
  if (
    fallbackNodeId != null &&
    fallbackNodeId.trim() !== '' &&
    (typeof payload.nodeId !== 'string' || payload.nodeId.trim() === '')
  ) {
    payload.nodeId = fallbackNodeId
  }
  return { eventType: nested.type, payload }
}

export function extractStreamChunk(event: unknown): string | null {
  const ev = asRecord(event)
  if (!ev) return null

  if (ev.type === 'modelStreamEventHook') {
    return extractStreamChunk(ev.event)
  }

  if (ev.type === 'toolStreamEvent') {
    const nested = extractNestedMultiAgentEvent(ev)
    if (nested != null) {
      return extractStreamChunk(nested.payload.event)
    }
    if (typeof ev.data === 'string') return ev.data
    return null
  }

  if (ev.type === 'modelContentBlockDeltaEvent') {
    const delta = asRecord(ev.delta)
    if (!delta) return null
    if (delta.type === 'textDelta' && typeof delta.text === 'string') return delta.text
    if (delta.type === 'reasoningContentDelta' && typeof delta.text === 'string') {
      return delta.text ? `💭 ${delta.text}` : '💭 '
    }
    return null
  }

  if (ev.type === 'textBlock' && typeof ev.text === 'string') {
    return ev.text
  }
  if (ev.type === 'reasoningBlock' && typeof ev.text === 'string') {
    return ev.text ? `💭 ${ev.text}` : '💭 '
  }
  return null
}

export function extractStructuredOutput(result: unknown): unknown | undefined {
  if (result == null || typeof result !== 'object') return undefined
  if ('structuredOutput' in result) {
    return (result as { structuredOutput?: unknown }).structuredOutput
  }
  if (!('results' in result)) return undefined
  const results = (result as { results?: Record<string, { result?: { structuredOutput?: unknown } }> }).results
  if (!results || typeof results !== 'object') return undefined
  for (const nodeResult of Object.values(results)) {
    const structuredOutput = nodeResult?.result?.structuredOutput
    if (structuredOutput !== undefined) return structuredOutput
  }
  return undefined
}

export function extractEventStatus(eventType: string, payload: Record<string, unknown>): string | null {
  if (eventType === 'multiAgentNodeStopEvent') {
    const nodeResult = payload.nodeResult as { status?: string } | undefined
    return typeof nodeResult?.status === 'string' ? nodeResult.status : null
  }

  if (eventType === 'multiAgentResultEvent') {
    const result = payload.result as { status?: string } | undefined
    return typeof result?.status === 'string' ? result.status : null
  }

  return null
}

export function extractEventNodeId(payload: Record<string, unknown>): string | null {
  if (typeof payload.nodeId === 'string') return payload.nodeId
  if (Array.isArray(payload.fromNodeIds) && typeof payload.fromNodeIds[0] === 'string') {
    return payload.fromNodeIds[0]
  }
  if (Array.isArray(payload.toNodeIds) && typeof payload.toNodeIds[0] === 'string') {
    return payload.toNodeIds[0]
  }
  return null
}

interface UsageCounters {
  inputTokens?: number
  outputTokens?: number
  totalTokens: number
}

function extractUsageCounters(usage: unknown): UsageCounters | null {
  const data = asRecord(usage)
  if (!data) return null

  const inputTokens =
    typeof data.inputTokens === 'number' && Number.isFinite(data.inputTokens)
      ? Math.floor(data.inputTokens)
      : undefined
  const outputTokens =
    typeof data.outputTokens === 'number' && Number.isFinite(data.outputTokens)
      ? Math.floor(data.outputTokens)
      : undefined
  const totalTokensRaw =
    typeof data.totalTokens === 'number' && Number.isFinite(data.totalTokens)
      ? Math.floor(data.totalTokens)
      : undefined
  const totalTokens =
    totalTokensRaw != null
      ? Math.max(0, totalTokensRaw)
      : inputTokens != null || outputTokens != null
      ? Math.max(0, (inputTokens ?? 0) + (outputTokens ?? 0))
      : null
  if (totalTokens == null) return null
  return {
    inputTokens: inputTokens != null ? Math.max(0, inputTokens) : undefined,
    outputTokens: outputTokens != null ? Math.max(0, outputTokens) : undefined,
    totalTokens,
  }
}

function extractModelId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function extractNodeModelId(nodeResult: unknown, payload?: Record<string, unknown>): string | undefined {
  const nr = asRecord(nodeResult)
  const result = asRecord(nr?.result)
  const metrics = asRecord(result?.metrics)
  const modelDetails = asRecord(metrics?.model)
  return (
    extractModelId(payload?.modelId) ||
    extractModelId(nr?.modelId) ||
    extractModelId(result?.modelId) ||
    extractModelId(metrics?.modelId) ||
    extractModelId(modelDetails?.modelId) ||
    extractModelId(modelDetails?.id)
  )
}

export function extractTokenUsageSnapshot(
  eventType: string,
  payload: Record<string, unknown>
): {
  nodeId: string | null
  inputTokens?: number
  outputTokens?: number
  totalTokens: number
  modelId?: string
  scope: 'node' | 'run'
} | null {
  if (eventType === 'multiAgentNodeStopEvent') {
    const nodeResult = asRecord(payload.nodeResult)
    const usage = extractUsageCounters(nodeResult?.accumulatedUsage)
    const usageFromResultMetrics = usage ?? extractUsageCounters(asRecord(asRecord(nodeResult?.result)?.metrics)?.accumulatedUsage)
    if (usageFromResultMetrics == null) return null
    return {
      nodeId: extractEventNodeId(payload),
      inputTokens: usageFromResultMetrics.inputTokens,
      outputTokens: usageFromResultMetrics.outputTokens,
      totalTokens: usageFromResultMetrics.totalTokens,
      modelId: extractNodeModelId(nodeResult, payload),
      scope: 'node',
    }
  }

  if (eventType === 'multiAgentResultEvent') {
    const result = asRecord(payload.result)
    if (!result) return null
    const usage = extractUsageCounters(result.accumulatedUsage)
    if (usage == null) return null
    return {
      nodeId: null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      modelId: extractNodeModelId(result, payload),
      scope: 'run',
    }
  }

  return null
}

export function resolveRunToolPolicy(
  config: RunRequest,
  options: { maxTotalToolUsesDefault: number; defaultPerToolLimitDefault: number }
): RunToolPolicy {
  const policy: RunToolPolicy = {
    maxTotalToolUses: options.maxTotalToolUsesDefault,
    defaultPerToolLimit: options.defaultPerToolLimitDefault,
    perToolLimits: {},
    blockedTools: new Set<string>(),
  }

  const presetKey = config.presetKey
  if (presetKey === 'agent_review_judge' || config.structuredOutputSchema === 'agent_review_verdict_v1') {
    policy.maxTotalToolUses = Math.min(policy.maxTotalToolUses, 10)
    policy.perToolLimits.swarm = 2
    policy.perToolLimits.file_write = 0
    policy.perToolLimits.journal = 0
    policy.blockedTools.add('file_write')
    policy.blockedTools.add('journal')
  } else if (presetKey === 'orchestrator_factory' || presetKey === 'orchestrator_contract') {
    // Orchestrator presets often require multiple handoff cycles plus one bounded retry.
    policy.maxTotalToolUses = Math.min(policy.maxTotalToolUses, 24)
    policy.perToolLimits.swarm = 2
    policy.perToolLimits.file_write = 2
    policy.perToolLimits.journal = 4
    policy.perToolLimits.handoff_to_agent = 16
  }

  if (config.structuredOutputSchema === 'orchestration_decision_v1') {
    policy.maxTotalToolUses = Math.min(policy.maxTotalToolUses, 24)
    policy.perToolLimits.swarm = Math.min(policy.perToolLimits.swarm ?? 2, 2)
    policy.perToolLimits.file_write = Math.min(policy.perToolLimits.file_write ?? 2, 2)
    policy.perToolLimits.journal = Math.min(policy.perToolLimits.journal ?? 4, 4)
    policy.perToolLimits.handoff_to_agent = Math.min(
      policy.perToolLimits.handoff_to_agent ?? 16,
      16
    )
  }

  if (config.mode === 'swarm' || config.mode === 'graph') {
    // Prevent recursive orchestration inside graph/swarm nodes.
    policy.perToolLimits.swarm = 0
    policy.perToolLimits.graph = 0
    policy.blockedTools.add('swarm')
    policy.blockedTools.add('graph')
  }

  return policy
}

export function extractToolUseStartFromStreamEvent(
  event: unknown,
  fallbackNodeId?: string
): { toolName: string; toolUseId?: string; nodeId?: string } | null {
  const ev = asRecord(event)
  if (!ev) return null

  if (ev.type === 'modelStreamEventHook') {
    return extractToolUseStartFromStreamEvent(ev.event, fallbackNodeId)
  }

  if (ev.type === 'toolStreamEvent') {
    const nested = extractNestedMultiAgentEvent(ev, fallbackNodeId)
    if (nested != null) {
      const nestedNodeId =
        typeof nested.payload.nodeId === 'string' && nested.payload.nodeId.trim() !== ''
          ? nested.payload.nodeId
          : fallbackNodeId
      return extractToolUseStartFromStreamEvent(nested.payload.event, nestedNodeId)
    }
    return null
  }

  if (ev.type === 'messageAddedEvent') {
    const message = asRecord(ev.message)
    const content = Array.isArray(message?.content) ? message.content : []
    for (const block of content) {
      const b = asRecord(block)
      if (!b) continue
      if ((b.type === 'toolUseStart' || b.type === 'toolUseBlock') && typeof b.name === 'string') {
        return {
          toolName: b.name.trim(),
          toolUseId: typeof b.toolUseId === 'string' ? b.toolUseId : undefined,
          nodeId: fallbackNodeId,
        }
      }
    }
    return null
  }

  if (ev.type === 'modelContentBlockStartEvent') {
    const start = asRecord(ev.start)
    if (start && (start.type === 'toolUseStart' || start.type === 'toolUseBlock') && typeof start.name === 'string') {
      return {
        toolName: start.name.trim(),
        toolUseId: typeof start.toolUseId === 'string' ? start.toolUseId : undefined,
        nodeId: fallbackNodeId,
      }
    }
    return null
  }

  if ((ev.type === 'toolUseStart' || ev.type === 'toolUseBlock') && typeof ev.name === 'string') {
    return {
      toolName: ev.name.trim(),
      toolUseId: typeof ev.toolUseId === 'string' ? ev.toolUseId : undefined,
      nodeId: fallbackNodeId,
    }
  }

  return null
}

export function registerToolUseAndCheckPolicy(
  policy: RunToolPolicy,
  state: ToolUseGuardState,
  toolUse: { toolName: string; toolUseId?: string; nodeId?: string }
): string | null {
  const toolName = toolUse.toolName.trim()
  if (toolName === '') return null

  if (toolUse.toolUseId != null && toolUse.toolUseId.trim() !== '') {
    if (state.seenToolUseIds.has(toolUse.toolUseId)) return null
    state.seenToolUseIds.add(toolUse.toolUseId)
  }

  if (policy.blockedTools.has(toolName)) {
    return `Tool '${toolName}' is not allowed in this run policy.`
  }

  // Only enforce rate limits for explicitly-risky tools.
  if (!(toolName in policy.perToolLimits)) {
    return null
  }

  const perToolLimit = policy.perToolLimits[toolName] ?? 0
  if (perToolLimit <= 0) {
    return `Tool '${toolName}' is disabled for this run policy.`
  }

  const usedForTool = state.perToolUses.get(toolName) ?? 0
  if (usedForTool + 1 > perToolLimit) {
    return `Tool '${toolName}' exceeded limit (${usedForTool + 1}/${perToolLimit}).`
  }

  if (state.totalToolUses + 1 > policy.maxTotalToolUses) {
    return `Total tool usage exceeded limit (${state.totalToolUses + 1}/${policy.maxTotalToolUses}).`
  }

  state.totalToolUses += 1
  state.perToolUses.set(toolName, usedForTool + 1)
  return null
}
