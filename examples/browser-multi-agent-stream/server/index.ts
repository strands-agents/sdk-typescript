/**
 * API server: runs dynamic swarm or graph and streams events via SSE.
 * In dev, Vite proxies /api to this server. In production, also serves static client.
 * Set OTEL_ENABLED=1 to capture traces; set OTEL_CONSOLE_EXPORT=1 to print spans to stdout.
 */

import 'dotenv/config'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import {
  Agent,
  BedrockModel,
  Swarm,
  GraphBuilder,
  ModelError,
  FileSessionManager,
} from '@strands-agents/sdk-fork'
import type { MultiAgentStreamEvent } from '@strands-agents/sdk-fork'
import { getTelemetryEntries, registerTelemetry, type TelemetryEntry } from './telemetry.js'
import { createHistoryStore, type RunEventRecord, type RunNodeMetricRecord } from './history-db.js'
import { computeCostUsd } from './pricing.js'
import {
  resolveCuratedBedrockModelId,
  resolveCuratedModelRegion,
  TOP_LEVEL_PROFILE_DEFAULTS,
  DEFAULT_TOP_LEVEL_PROFILE,
} from './curated-models.js'
import { validateAndClampRunRequest, type RunRequest } from './run-request.js'
import {
  STRUCTURED_OUTPUT_SCHEMAS,
  type StructuredOutputSchemaId,
} from './structured-output.js'
import { createCommunityTools } from './community-tools.js'
import {
  buildSummaryAndMetrics,
  extractEventNodeId,
  extractEventStatus,
  extractNestedMultiAgentEvent,
  extractStructuredOutput,
  extractTokenUsageSnapshot,
  extractToolUseStartFromStreamEvent,
  registerToolUseAndCheckPolicy,
  resolveRunToolPolicy,
  summarizeEventDetail,
  type ToolUseGuardState,
} from './run-stream-utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000
const app = express()
app.use(express.json())

const MAX_AGENTS = 5
const MAX_SYSTEM_PROMPT_CHARS = 500
const MAX_HANDOFFS = 5
const MAX_ITERATIONS = 10
const MAX_EDGES = 10
const MAX_NODE_EXECUTIONS = 10
const EXECUTION_TIMEOUT_SEC = 120
const NODE_TIMEOUT_SEC = 60
const SESSION_ID_MAX_CHARS = 128
const MAX_RUN_WALL_CLOCK_MS = (() => {
  const parsed = Number.parseInt(process.env.MAX_RUN_WALL_CLOCK_MS ?? '300000', 10)
  if (Number.isFinite(parsed) && parsed >= 10000) return parsed
  return 300000
})()
const MAX_STREAM_IDLE_MS = (() => {
  const parsed = Number.parseInt(process.env.MAX_STREAM_IDLE_MS ?? '60000', 10)
  if (Number.isFinite(parsed) && parsed >= 5000) return parsed
  return 60000
})()
const MAX_RUN_TOTAL_TOKENS = (() => {
  const parsed = Number.parseInt(process.env.MAX_RUN_TOTAL_TOKENS ?? '100000', 10)
  if (Number.isFinite(parsed) && parsed >= 1000) return parsed
  return 100000
})()
const MAX_TOOL_USES_PER_RUN_DEFAULT = (() => {
  const parsed = Number.parseInt(process.env.MAX_TOOL_USES_PER_RUN ?? '24', 10)
  if (Number.isFinite(parsed) && parsed >= 1) return parsed
  return 24
})()
const MAX_TOOL_USES_PER_TOOL_DEFAULT = (() => {
  const parsed = Number.parseInt(process.env.MAX_TOOL_USES_PER_TOOL ?? '8', 10)
  if (Number.isFinite(parsed) && parsed >= 1) return parsed
  return 8
})()
const { getToolsForAgent } = createCommunityTools({
  maxRunTotalTokens: MAX_RUN_TOTAL_TOKENS,
})

const historyStore = createHistoryStore()
const SESSION_STORAGE_DIR =
  process.env.STRANDS_SESSION_STORAGE_DIR ?? path.join(__dirname, '.session-store')
const PRESET_MAX_RUN_WALL_CLOCK_MS: Record<string, number> = {
  orchestrator_factory: 120000,
  orchestrator_contract: 180000,
  agent_review_judge: 180000,
}

function resolveRunWallClockLimitMs(config: RunRequest): number {
  let limitMs = MAX_RUN_WALL_CLOCK_MS
  if (config.presetKey != null) {
    const presetLimitMs = PRESET_MAX_RUN_WALL_CLOCK_MS[config.presetKey]
    if (presetLimitMs != null) limitMs = Math.min(limitMs, presetLimitMs)
  }
  if (config.structuredOutputSchema === 'agent_review_verdict_v1') {
    limitMs = Math.min(limitMs, PRESET_MAX_RUN_WALL_CLOCK_MS.agent_review_judge)
  }
  return limitMs
}

async function readNextStreamEventWithTimeout<T>(
  stream: AsyncGenerator<T, unknown>,
  timeoutMs: number
): Promise<IteratorResult<T, unknown>> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `RUN_IDLE_TIMEOUT_EXCEEDED: no stream events for ${Math.floor(timeoutMs / 1000)}s.`
        )
      )
    }, timeoutMs)

    stream
      .next()
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_, v) => {
    if (v !== null && typeof v === 'object') {
      if (seen.has(v as object)) return undefined
      seen.add(v as object)
    }
    return v
  })
}

function sendSSE(res: express.Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`)
  res.write(`data: ${safeStringify(data)}\n\n`)
}

const MAX_PERSISTED_STREAM_EVENTS_PER_NODE = (() => {
  const parsed = Number.parseInt(process.env.MAX_PERSISTED_STREAM_EVENTS_PER_NODE ?? '120', 10)
  if (Number.isFinite(parsed) && parsed >= 1) return parsed
  return 120
})()

const MAX_PERSISTED_EVENT_DETAIL_CHARS = 240

function truncateText(value: string, maxChars = MAX_PERSISTED_EVENT_DETAIL_CHARS): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}...`
}

function sanitizeEventPayloadForHistory(eventType: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (eventType === 'multiAgentNodeStreamEvent') {
    const event = payload.event as unknown
    const nested = extractNestedMultiAgentEvent(event, typeof payload.nodeId === 'string' ? payload.nodeId : undefined)
    const streamEvent = nested?.payload.event ?? event
    const streamEventRecord = streamEvent != null && typeof streamEvent === 'object'
      ? (streamEvent as Record<string, unknown>)
      : {}
    const chunk = summarizeEventDetail(eventType, payload)
    return {
      type: eventType,
      nodeId: payload.nodeId ?? null,
      streamEventType:
        typeof streamEventRecord.type === 'string'
          ? streamEventRecord.type
          : typeof nested?.eventType === 'string'
          ? nested.eventType
          : null,
      detail: chunk != null ? truncateText(chunk) : null,
    }
  }

  const detail = summarizeEventDetail(eventType, payload)
  if (detail == null || detail === '') {
    return payload
  }
  return {
    ...payload,
    detail: truncateText(detail),
  }
}

function filterRunTelemetry(
  allTelemetry: TelemetryEntry[],
  startedAtMs: number,
  completedAtMs: number
): TelemetryEntry[] {
  const lowerBound = startedAtMs - 1000
  const upperBound = completedAtMs + 1000
  return allTelemetry
    .filter((entry) => entry.startTime >= lowerBound && entry.startTime <= upperBound)
    .sort((a, b) => {
      if (a.startTime !== b.startTime) return a.startTime - b.startTime
      if (a.durationMs !== b.durationMs) return b.durationMs - a.durationMs
      if (a.endTime !== b.endTime) return b.endTime - a.endTime
      return a.name.localeCompare(b.name)
    })
}

function asInt(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

app.get('/api/telemetry', (_req, res) => {
  const entries = getTelemetryEntries()
  res.json({ entries })
})

app.get('/api/history', (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, asInt(req.query.limit, 50)))
    const offset = Math.max(0, asInt(req.query.offset, 0))
    const anomaliesOnly = asBool(req.query.anomaliesOnly, false)
    const sort = req.query.sort === 'risk' ? 'risk' : 'recent'
    const runs = historyStore.listRuns(limit, offset, { anomaliesOnly, sort })
    res.json({ runs, limit, offset, anomaliesOnly, sort })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: `Failed to load history: ${message}` })
  }
})

app.get('/api/history/stats', (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, asInt(req.query.days, 30)))
    const stats = historyStore.getStats(days)
    res.json({ days, stats })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: `Failed to load history stats: ${message}` })
  }
})

app.get('/api/history/:runId', (req, res) => {
  try {
    const runId = req.params.runId
    if (!runId) {
      res.status(400).json({ error: 'Missing run ID' })
      return
    }
    const detail = historyStore.getRun(runId)
    if (!detail) {
      res.status(404).json({ error: `Run not found: ${runId}` })
      return
    }
    res.json(detail)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: `Failed to load run detail: ${message}` })
  }
})

app.post('/api/run', async (req, res) => {
  const config = validateAndClampRunRequest(req.body, {
    maxAgents: MAX_AGENTS,
    maxSystemPromptChars: MAX_SYSTEM_PROMPT_CHARS,
    maxHandoffs: MAX_HANDOFFS,
    maxEdges: MAX_EDGES,
    sessionIdMaxChars: SESSION_ID_MAX_CHARS,
    validStructuredSchemaIds: Object.keys(STRUCTURED_OUTPUT_SCHEMAS) as StructuredOutputSchemaId[],
  })
  if (!config) {
    res.status(400).json({ error: 'Missing or invalid prompt/agents' })
    return
  }
  if (config.structuredOutputSchema != null && config.mode !== 'single') {
    res.status(400).json({
      error: 'Structured output is configured for single-agent mode in this demo. Switch mode to Single.',
    })
    return
  }
  const isAgentReviewRun =
    config.presetKey === 'agent_review_judge' || config.structuredOutputSchema === 'agent_review_verdict_v1'
  const runWallClockLimitMs = resolveRunWallClockLimitMs(config)

  const topLevelModelResolution = resolveCuratedBedrockModelId({
    requestedModelId: config.modelId,
    requestedProfile: config.modelProfile,
    defaultProfile: DEFAULT_TOP_LEVEL_PROFILE,
    profileDefaults: TOP_LEVEL_PROFILE_DEFAULTS,
  })
  const model = new BedrockModel({
    region: resolveCuratedModelRegion(
      topLevelModelResolution.modelId,
      process.env.AWS_REGION ?? 'us-west-2'
    ),
    modelId: topLevelModelResolution.modelId,
  })

  if (config.modelId != null && topLevelModelResolution.reason !== 'requested_model') {
    console.warn(
      `Top-level model '${config.modelId}' is not curated; using '${topLevelModelResolution.modelId}' (${topLevelModelResolution.profile} profile).`
    )
  }

  const runId = randomUUID()
  const runStartedAt = Date.now()
  const capturedEvents: RunEventRecord[] = []
  const nodeUsageTotals = new Map<
    string,
    { inputTokens: number; outputTokens: number; totalTokens: number }
  >()
  const nodeModelIds = new Map<string, string>()
  const modelUsageTotals = new Map<
    string,
    { inputTokens: number; outputTokens: number; totalTokens: number }
  >()
  const modelDisplayIdByKey = new Map<string, string>()
  let observedTotalTokens = 0
  const toolPolicy = resolveRunToolPolicy(config, {
    maxTotalToolUsesDefault: MAX_TOOL_USES_PER_RUN_DEFAULT,
    defaultPerToolLimitDefault: MAX_TOOL_USES_PER_TOOL_DEFAULT,
  })
  const toolUseGuard: ToolUseGuardState = {
    totalToolUses: 0,
    perToolUses: new Map<string, number>(),
    seenToolUseIds: new Set<string>(),
  }
  let persistenceFinalized = false
  let clientDisconnected = false
  let activeStream: AsyncGenerator<MultiAgentStreamEvent, unknown> | null = null
  let observedNodeStartEvents = 0
  const persistedStreamEventCounts = new Map<string, number>()
  const streamEventCapNotedNodeIds = new Set<string>()
  const captureEvent = (eventType: string, payload: Record<string, unknown>): void => {
    if (eventType === 'multiAgentNodeStreamEvent') {
      const nodeId = extractEventNodeId(payload) ?? '__unknown__'
      const seen = persistedStreamEventCounts.get(nodeId) ?? 0
      if (seen >= MAX_PERSISTED_STREAM_EVENTS_PER_NODE) {
        if (!streamEventCapNotedNodeIds.has(nodeId)) {
          streamEventCapNotedNodeIds.add(nodeId)
          capturedEvents.push({
            sequence: capturedEvents.length + 1,
            eventType: 'multiAgentNodeStreamEventCapped',
            nodeId,
            status: null,
            detail: `Stream event persistence capped at ${MAX_PERSISTED_STREAM_EVENTS_PER_NODE} chunks for node '${nodeId}'.`,
            payload: {
              type: 'multiAgentNodeStreamEventCapped',
              nodeId,
              maxPersistedChunks: MAX_PERSISTED_STREAM_EVENTS_PER_NODE,
            },
            timestamp: Date.now(),
          })
        }
        return
      }
      persistedStreamEventCounts.set(nodeId, seen + 1)
    }

    capturedEvents.push({
      sequence: capturedEvents.length + 1,
      eventType,
      nodeId: extractEventNodeId(payload),
      status: extractEventStatus(eventType, payload),
      detail: summarizeEventDetail(eventType, payload),
      payload: sanitizeEventPayloadForHistory(eventType, payload),
      timestamp: Date.now(),
    })
  }
  const sendSSESafe = (event: string, data: unknown): boolean => {
    if (clientDisconnected || res.destroyed) return false
    try {
      sendSSE(res, event, data)
      return true
    } catch (error) {
      clientDisconnected = true
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`SSE write failed for run ${runId}: ${message}`)
      return false
    }
  }
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null
  const readModelId = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  const normalizeModelKey = (value: string): string => {
    const trimmed = value.trim()
    const match = trimmed.match(/^(us|eu|apac|global)\.(.+)$/i)
    return match ? match[2] : trimmed
  }
  const setNodeModelId = (nodeId: string | undefined, modelId: string | undefined): void => {
    if (nodeId == null || modelId == null || nodeId.trim() === '' || modelId.trim() === '') return
    nodeModelIds.set(nodeId.trim(), modelId.trim())
    const key = normalizeModelKey(modelId)
    if (!modelDisplayIdByKey.has(key)) modelDisplayIdByKey.set(key, modelId.trim())
  }
  const captureModelIdFromEventPayload = (payload: Record<string, unknown>): void => {
    const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId : undefined
    const directModelId = readModelId(payload.modelId)
    const nodeResultModelId = readModelId(asRecord(payload.nodeResult)?.modelId)
    const resultModelId = readModelId(asRecord(payload.result)?.modelId)
    setNodeModelId(nodeId, directModelId ?? nodeResultModelId ?? resultModelId)
  }
  const applyCounterDelta = (
    currentValue: number | undefined,
    previousValue: number
  ): { delta: number; next: number } => {
    if (currentValue == null || !Number.isFinite(currentValue)) {
      return { delta: 0, next: previousValue }
    }
    const normalizedCurrent = Math.max(0, Math.floor(currentValue))
    if (normalizedCurrent >= previousValue) {
      return { delta: normalizedCurrent - previousValue, next: normalizedCurrent }
    }
    // Some providers reset counters across retries/cycles; treat this as a new additive window.
    return { delta: normalizedCurrent, next: previousValue + normalizedCurrent }
  }
  const accumulateModelUsage = (
    modelId: string | undefined,
    deltaInputTokens: number,
    deltaOutputTokens: number,
    deltaTotalTokens: number
  ): void => {
    if (modelId == null || modelId.trim() === '') return
    if (deltaInputTokens <= 0 && deltaOutputTokens <= 0 && deltaTotalTokens <= 0) return
    const key = normalizeModelKey(modelId)
    if (!modelDisplayIdByKey.has(key)) modelDisplayIdByKey.set(key, modelId.trim())
    const previous = modelUsageTotals.get(key) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    modelUsageTotals.set(key, {
      inputTokens: previous.inputTokens + Math.max(0, deltaInputTokens),
      outputTokens: previous.outputTokens + Math.max(0, deltaOutputTokens),
      totalTokens: previous.totalTokens + Math.max(0, deltaTotalTokens),
    })
  }
  const updateObservedTokenBudget = (eventType: string, payload: Record<string, unknown>): number => {
    captureModelIdFromEventPayload(payload)
    const snapshot = extractTokenUsageSnapshot(eventType, payload)
    if (snapshot == null) return observedTotalTokens

    if (snapshot.scope === 'run') {
      observedTotalTokens = Math.max(observedTotalTokens, snapshot.totalTokens)
      return observedTotalTokens
    }

    const nodeId = snapshot.nodeId
    if (nodeId == null || nodeId.trim() === '') {
      observedTotalTokens = Math.max(observedTotalTokens, snapshot.totalTokens)
      return observedTotalTokens
    }

    setNodeModelId(nodeId, snapshot.modelId)
    const previousCounters = nodeUsageTotals.get(nodeId) ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    }
    const inputCounter = applyCounterDelta(snapshot.inputTokens, previousCounters.inputTokens)
    const outputCounter = applyCounterDelta(snapshot.outputTokens, previousCounters.outputTokens)
    const totalCounter = applyCounterDelta(snapshot.totalTokens, previousCounters.totalTokens)

    observedTotalTokens += totalCounter.delta
    nodeUsageTotals.set(nodeId, {
      inputTokens: inputCounter.next,
      outputTokens: outputCounter.next,
      totalTokens: totalCounter.next,
    })

    const modelIdForNode = snapshot.modelId ?? nodeModelIds.get(nodeId)
    accumulateModelUsage(modelIdForNode, inputCounter.delta, outputCounter.delta, totalCounter.delta)
    return observedTotalTokens
  }
  const persistInterruptedMinimal = (reason: string): void => {
    if (persistenceFinalized) return
    try {
      historyStore.markRunCompletedMinimal({
        runId,
        completedAt: Date.now(),
        status: 'interrupted',
        resultText: null,
        responseJson: { runId, status: 'interrupted', message: reason },
      })
      persistenceFinalized = true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`Failed to persist interrupted run ${runId}: ${message}`)
    }
  }
  const stopActiveStream = (): void => {
    if (activeStream == null) return
    const stream = activeStream
    activeStream = null
    void stream
      .return(undefined as unknown)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`Failed to stop stream for run ${runId}: ${message}`)
      })
  }

  res.on('close', () => {
    clientDisconnected = true
    stopActiveStream()
    persistInterruptedMinimal('Client disconnected before run finalized.')
  })

  try {
    historyStore.startRun({
      runId,
      createdAt: runStartedAt,
      mode: config.mode,
      prompt: config.prompt,
      requestJson: config,
      agents: config.agents.map((agent) => ({
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        tools: agent.tools,
      })),
      edges: config.edges ?? [],
      entryPoint: config.entryPoint,
      entryPoints: config.entryPoints,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Failed to start history record for run ${runId}: ${message}`)
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const structuredOutputSchema =
      config.structuredOutputSchema != null ? STRUCTURED_OUTPUT_SCHEMAS[config.structuredOutputSchema] : undefined

    const getAllowedToolsForAgent = (requestedToolNames: string[] | undefined, agentName: string) => {
      const selectedTools = getToolsForAgent(requestedToolNames)
      if (toolPolicy.blockedTools.size === 0) return selectedTools
      const allowedTools = selectedTools.filter((tool) => !toolPolicy.blockedTools.has(tool.name))
      const blockedConfigured = selectedTools.filter((tool) => toolPolicy.blockedTools.has(tool.name))
      if (blockedConfigured.length > 0) {
        console.warn(
          `Blocked tools stripped from agent '${agentName}' for mode '${config.mode}': ${blockedConfigured
            .map((tool) => tool.name)
            .join(', ')}`
        )
      }
      return allowedTools
    }

    const agents = config.agents.map((a) => {
      const sessionManager =
        config.sessionId != null
          ? new FileSessionManager({
              sessionId: config.sessionId,
              storageDir: SESSION_STORAGE_DIR,
            })
          : undefined
      return new Agent({
        name: a.name,
        model,
        systemPrompt: a.systemPrompt,
        tools: getAllowedToolsForAgent(a.tools, a.name),
        ...(sessionManager != null ? { sessionManager } : {}),
        ...(config.mode === 'single' && config.singleAgent === a.name && structuredOutputSchema !== undefined
          ? { structuredOutput: structuredOutputSchema }
          : {}),
        printer: false,
      })
    })
    for (const agent of agents) {
      const configuredModelId = agent.model.getConfig?.()?.modelId
      if (typeof configuredModelId === 'string' && configuredModelId.trim() !== '') {
        setNodeModelId(agent.name, configuredModelId)
      }
    }
    const agentByName = new Map(agents.map((x) => [x.name, x]))

    let stream: AsyncGenerator<MultiAgentStreamEvent, unknown>
    if (config.mode === 'single') {
      const selected = (config.singleAgent ? agentByName.get(config.singleAgent) : undefined) ?? agents[0]
      if (!selected) throw new Error('No single agent selected')

      stream = (async function* runSingleAgent(): AsyncGenerator<Record<string, unknown>, unknown> {
        const nodeId = selected.name
        const startTime = Date.now()
        yield { type: 'multiAgentNodeStartEvent', nodeId, nodeType: 'agent' }
        yield {
          type: 'multiAgentNodeInputEvent',
          nodeId,
          input: [{ type: 'textBlock', text: config.prompt }],
        }

        const gen = selected.stream(config.prompt)
        let next = await gen.next()
        while (!next.done) {
          yield { type: 'multiAgentNodeStreamEvent', nodeId, event: next.value }
          next = await gen.next()
        }

        const agentResult = next.value as {
          stopReason?: string
          metrics?: {
            accumulatedUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
            accumulatedMetrics?: { latencyMs?: number }
          }
          structuredOutput?: unknown
        }
        const usage = agentResult.metrics?.accumulatedUsage ?? {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        }
        const selectedModelId = selected.model.getConfig?.()?.modelId
        const accumulatedMetrics = agentResult.metrics?.accumulatedMetrics ?? {
          latencyMs: Date.now() - startTime,
        }
        const status = agentResult.stopReason === 'interrupt' ? 'interrupted' : 'completed'
        const nodeResult = {
          result: agentResult,
          executionTime: Date.now() - startTime,
          status,
          accumulatedUsage: usage,
          accumulatedMetrics,
          executionCount: 1,
          modelId: typeof selectedModelId === 'string' ? selectedModelId : undefined,
        }

        yield { type: 'multiAgentNodeStopEvent', nodeId, nodeResult }

        const multiLikeResult = {
          status,
          results: { [nodeId]: nodeResult },
          accumulatedUsage: usage,
          executionTime: nodeResult.executionTime,
          nodeHistory: [{ nodeId }],
          executionOrder: [{ nodeId }],
          structuredOutput: agentResult.structuredOutput,
        }
        yield { type: 'multiAgentResultEvent', result: multiLikeResult }
        return multiLikeResult
      })() as unknown as AsyncGenerator<MultiAgentStreamEvent, unknown>
    } else if (config.mode === 'graph') {
      const builder = new GraphBuilder()
      for (const a of agents) builder.addNode(a, a.name)
      if (config.sessionId != null) {
        builder.setSessionManager(
          new FileSessionManager({
            sessionId: `${config.sessionId}:graph`,
            storageDir: SESSION_STORAGE_DIR,
          })
        )
      }
      for (const e of config.edges ?? []) builder.addEdge(e.from, e.to)
      for (const id of config.entryPoints ?? []) {
        if (typeof id === 'string' && id) builder.setEntryPoint(id)
      }
      builder.setMaxNodeExecutions(MAX_NODE_EXECUTIONS)
      builder.setExecutionTimeout(EXECUTION_TIMEOUT_SEC)
      builder.setNodeTimeout(NODE_TIMEOUT_SEC)
      const graph = builder.build()
      stream = graph.stream(config.prompt) as AsyncGenerator<MultiAgentStreamEvent, unknown>
    } else {
      const entryAgent = (config.entryPoint ? agentByName.get(config.entryPoint) : undefined) ?? agents[0]
      if (!entryAgent) throw new Error('No entry agent')
      const swarm = new Swarm({
        nodes: agents,
        entryPoint: entryAgent,
        maxHandoffs: config.maxHandoffs,
        maxIterations: MAX_ITERATIONS,
        executionTimeout: EXECUTION_TIMEOUT_SEC,
        nodeTimeout: NODE_TIMEOUT_SEC,
      })
      stream = swarm.stream(config.prompt) as AsyncGenerator<MultiAgentStreamEvent, unknown>
    }

    activeStream = stream
    let result: unknown = null
    while (true) {
      if (Date.now() - runStartedAt > runWallClockLimitMs) {
        throw new Error(
          `RUN_TIMEOUT_EXCEEDED: exceeded max wall-clock time (${Math.floor(runWallClockLimitMs / 1000)}s).`
        )
      }
      const next = await readNextStreamEventWithTimeout(stream, MAX_STREAM_IDLE_MS)
      if (next.done) break
      const event = next.value
      const payload = event as unknown as Record<string, unknown>
      const eventType = typeof payload.type === 'string' ? payload.type : 'event'
      if (eventType === 'multiAgentNodeStreamEvent') {
        const toolUse = extractToolUseStartFromStreamEvent(
          payload.event,
          typeof payload.nodeId === 'string' ? payload.nodeId : undefined
        )
        if (toolUse != null) {
          const violation = registerToolUseAndCheckPolicy(toolPolicy, toolUseGuard, toolUse)
          if (violation != null) {
            throw new Error(`TOOL_POLICY_EXCEEDED: ${violation}`)
          }
        }
      }
      if (!sendSSESafe(eventType, payload)) {
        throw new Error('Client disconnected while streaming run events.')
      }
      captureEvent(eventType, payload)
      if (eventType === 'multiAgentNodeStartEvent') observedNodeStartEvents += 1
      if (updateObservedTokenBudget(eventType, payload) > MAX_RUN_TOTAL_TOKENS) {
        throw new Error(
          `TOKEN_BUDGET_EXCEEDED: observed ${observedTotalTokens.toLocaleString()} tokens (limit ${MAX_RUN_TOTAL_TOKENS.toLocaleString()}).`
        )
      }
      if (eventType === 'multiAgentNodeStreamEvent') {
        const fallbackNodeId = typeof payload.nodeId === 'string' ? payload.nodeId : undefined
        const nested = extractNestedMultiAgentEvent(payload.event, fallbackNodeId)
        if (nested != null) {
          captureEvent(nested.eventType, nested.payload)
          if (nested.eventType === 'multiAgentNodeStartEvent') observedNodeStartEvents += 1
          if (updateObservedTokenBudget(nested.eventType, nested.payload) > MAX_RUN_TOTAL_TOKENS) {
            throw new Error(
              `TOKEN_BUDGET_EXCEEDED: observed ${observedTotalTokens.toLocaleString()} tokens (limit ${MAX_RUN_TOTAL_TOKENS.toLocaleString()}).`
            )
          }
        }
      }
      if (isAgentReviewRun && observedNodeStartEvents > 20) {
        throw new Error(
          `AGENT_REVIEW_NODE_BUDGET_EXCEEDED: observed ${observedNodeStartEvents} node starts (limit 20).`
        )
      }
      if (payload.type === 'multiAgentResultEvent' && payload.result !== undefined) {
        result = payload.result
      }
      const resWithFlush = res as express.Response & { flush?: () => void }
      if (typeof resWithFlush.flush === 'function') resWithFlush.flush()
    }

    const { status, text, usage, executionTime, nodeHistory, executionOrder, perNode } = buildSummaryAndMetrics(result)
    if (isAgentReviewRun && (toolUseGuard.perToolUses.get('swarm') ?? 0) !== 2) {
      throw new Error(
        `AGENT_REVIEW_CONTRACT_VIOLATION: expected exactly two swarm calls (builder + judge), observed ${toolUseGuard.perToolUses.get('swarm') ?? 0}.`
      )
    }
    const finalTotalTokens =
      usage?.totalTokens ??
      ((usage?.inputTokens != null || usage?.outputTokens != null)
        ? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
        : undefined)
    if (finalTotalTokens != null && finalTotalTokens > MAX_RUN_TOTAL_TOKENS) {
      throw new Error(
        `TOKEN_BUDGET_EXCEEDED: final usage ${finalTotalTokens.toLocaleString()} tokens (limit ${MAX_RUN_TOTAL_TOKENS.toLocaleString()}).`
      )
    }
    const structuredOutput = extractStructuredOutput(result)
    const resolvedText = structuredOutput !== undefined ? JSON.stringify(structuredOutput, null, 2) : (text ?? '')
    const modelId = model.getConfig?.()?.modelId
    const runCompletedAt = Date.now()
    const perModelUsageFromEvents = [...modelUsageTotals.entries()]
      .map(([modelKey, totals]) => {
        const displayModelId = modelDisplayIdByKey.get(modelKey) ?? modelKey
        const inputTokens = totals.inputTokens > 0 ? totals.inputTokens : undefined
        const outputTokens = totals.outputTokens > 0 ? totals.outputTokens : undefined
        const totalTokens =
          totals.totalTokens > 0
            ? totals.totalTokens
            : inputTokens != null || outputTokens != null
            ? (inputTokens ?? 0) + (outputTokens ?? 0)
            : undefined
        return {
          modelId: displayModelId,
          inputTokens,
          outputTokens,
          totalTokens,
          costUsd: computeCostUsd(inputTokens, outputTokens, displayModelId),
        }
      })
      .filter((entry) => entry.totalTokens != null && entry.totalTokens > 0)
      .sort((a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0))

    const perModelUsage =
      perModelUsageFromEvents.length > 0
        ? perModelUsageFromEvents
        : modelId != null
        ? [
            {
              modelId,
              inputTokens: usage?.inputTokens,
              outputTokens: usage?.outputTokens,
              totalTokens:
                usage?.totalTokens ??
                ((usage?.inputTokens != null || usage?.outputTokens != null)
                  ? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
                  : undefined),
              costUsd: computeCostUsd(usage?.inputTokens, usage?.outputTokens, modelId),
            },
          ]
        : []

    const knownPerModelCosts = perModelUsage
      .map((entry) => entry.costUsd)
      .filter((value): value is number => value != null && Number.isFinite(value))
    const totalCostUsd =
      knownPerModelCosts.length > 0
        ? Number(knownPerModelCosts.reduce((sum, value) => sum + value, 0).toFixed(8))
        : computeCostUsd(usage?.inputTokens, usage?.outputTokens, modelId)

    const perNodeWithModelAndCost = (perNode ?? []).map((metric) => {
      const resolvedModelId = metric.modelId ?? nodeModelIds.get(metric.nodeId) ?? modelId
      const totalTokens =
        metric.totalTokens ??
        (metric.inputTokens != null || metric.outputTokens != null
          ? (metric.inputTokens ?? 0) + (metric.outputTokens ?? 0)
          : undefined)
      return {
        ...metric,
        modelId: resolvedModelId,
        totalTokens,
        costUsd: computeCostUsd(metric.inputTokens, metric.outputTokens, resolvedModelId),
      }
    })

    const nodeMetrics: RunNodeMetricRecord[] = perNodeWithModelAndCost.map((metric) => ({
      nodeId: metric.nodeId,
      status: metric.status,
      inputTokens: metric.inputTokens,
      outputTokens: metric.outputTokens,
      totalTokens: metric.totalTokens,
      executionTime: metric.executionTime,
      costUsd: metric.costUsd,
      raw: metric,
    }))

    const telemetryForRun = filterRunTelemetry(getTelemetryEntries(), runStartedAt, runCompletedAt)

    const donePayload = {
      runId,
      status,
      text: resolvedText,
      structuredOutput,
      usage,
      executionTime,
      nodeHistory,
      executionOrder,
      perNode: perNodeWithModelAndCost,
      perModelUsage,
      modelId,
      estimatedCostUsd: totalCostUsd,
    }

    try {
      historyStore.completeRun({
        runId,
        completedAt: runCompletedAt,
        status,
        resultText: resolvedText || null,
        responseJson: donePayload,
        modelId,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
        executionTimeMs: executionTime,
        costUsd: totalCostUsd,
        events: capturedEvents,
        nodeMetrics,
        telemetry: telemetryForRun,
      })
      persistenceFinalized = true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`Failed to persist completed run ${runId}: ${message}`)
      try {
        historyStore.markRunCompletedMinimal({
          runId,
          completedAt: runCompletedAt,
          status,
          resultText: resolvedText || null,
          responseJson: donePayload,
          modelId,
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          totalTokens: usage?.totalTokens,
          executionTimeMs: executionTime,
          costUsd: totalCostUsd,
        })
        persistenceFinalized = true
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        console.error(`Fallback persistence failed for completed run ${runId}: ${fallbackMessage}`)
      }
    }
    sendSSESafe('done', {
      ...donePayload,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isTokenBudgetExceeded = message.includes('TOKEN_BUDGET_EXCEEDED')
    const isRunTimeoutExceeded = message.includes('RUN_TIMEOUT_EXCEEDED')
    const isRunIdleTimeoutExceeded = message.includes('RUN_IDLE_TIMEOUT_EXCEEDED')
    const isToolPolicyExceeded = message.includes('TOOL_POLICY_EXCEEDED')
    const isAgentReviewContractViolation = message.includes('AGENT_REVIEW_CONTRACT_VIOLATION')
    const isAgentReviewNodeBudgetExceeded = message.includes('AGENT_REVIEW_NODE_BUDGET_EXCEEDED')
    const isStreamIncomplete = err instanceof ModelError && message.includes('Stream ended without completing')
    const isClientDisconnect =
      clientDisconnected ||
      /client disconnected/i.test(message) ||
      /aborted/i.test(message) ||
      /premature close/i.test(message)
    const errorPayload = {
      message: isTokenBudgetExceeded
        ? `Run stopped after hitting token budget (${MAX_RUN_TOTAL_TOKENS.toLocaleString()} tokens).`
        : isRunTimeoutExceeded
        ? message.replace('RUN_TIMEOUT_EXCEEDED: ', '')
        : isRunIdleTimeoutExceeded
        ? message.replace('RUN_IDLE_TIMEOUT_EXCEEDED: ', '')
        : isToolPolicyExceeded
        ? message.replace('TOOL_POLICY_EXCEEDED: ', 'Run stopped by tool safety policy: ')
        : isAgentReviewContractViolation
        ? message.replace('AGENT_REVIEW_CONTRACT_VIOLATION: ', '')
        : isAgentReviewNodeBudgetExceeded
        ? message.replace('AGENT_REVIEW_NODE_BUDGET_EXCEEDED: ', 'Agent Review run stopped: ')
        : isClientDisconnect
        ? 'Run interrupted: client disconnected before completion.'
        : isStreamIncomplete
        ? 'The model stream ended before finishing. This can happen with long responses or Bedrock limits. Try a shorter prompt or run again.'
        : message,
      code: isTokenBudgetExceeded
        ? 'TOKEN_BUDGET_EXCEEDED'
        : isRunTimeoutExceeded
        ? 'RUN_TIMEOUT_EXCEEDED'
        : isRunIdleTimeoutExceeded
        ? 'RUN_IDLE_TIMEOUT_EXCEEDED'
        : isToolPolicyExceeded
        ? 'TOOL_POLICY_EXCEEDED'
        : isAgentReviewContractViolation
        ? 'AGENT_REVIEW_CONTRACT_VIOLATION'
        : isAgentReviewNodeBudgetExceeded
        ? 'AGENT_REVIEW_NODE_BUDGET_EXCEEDED'
        : isClientDisconnect
        ? 'CLIENT_DISCONNECTED'
        : isStreamIncomplete
        ? 'MODEL_STREAM_INCOMPLETE'
        : undefined,
      runId,
    }

    if (!isClientDisconnect) {
      sendSSESafe('error', errorPayload)
    }
    captureEvent('error', {
      type: 'error',
      message: errorPayload.message,
      code: errorPayload.code,
      runId,
    })

    if (isClientDisconnect) {
      persistInterruptedMinimal(String(errorPayload.message))
    } else if (!persistenceFinalized) {
      try {
        const completedAt = Date.now()
        const telemetryForRun = filterRunTelemetry(getTelemetryEntries(), runStartedAt, completedAt)
        historyStore.failRun({
          runId,
          completedAt,
          errorMessage: String(errorPayload.message),
          responseJson: errorPayload,
          events: capturedEvents,
          telemetry: telemetryForRun,
        })
        persistenceFinalized = true
      } catch (error) {
        const persistenceError = error instanceof Error ? error.message : String(error)
        console.error(`Failed to persist failed run ${runId}: ${persistenceError}`)
        try {
          historyStore.markRunFailedMinimal({
            runId,
            completedAt: Date.now(),
            errorMessage: String(errorPayload.message),
            responseJson: errorPayload,
          })
          persistenceFinalized = true
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          console.error(`Fallback persistence failed for failed run ${runId}: ${fallbackMessage}`)
        }
      }
    }
  } finally {
    activeStream = null
    if (!res.writableEnded) {
      try {
        res.end()
      } catch {
        // ignore socket-close race conditions during shutdown
      }
    }
  }
})

if (process.env.NODE_ENV !== 'development') {
  const staticDir = path.join(__dirname, '..')
  app.use(express.static(staticDir))
  app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')))
}

;(async () => {
  await registerTelemetry()
  const recoveredRuns = historyStore.recoverRunningRuns(
    Date.now(),
    'Recovered on server start: previous run did not finalize.'
  )
  if (recoveredRuns > 0) {
    console.warn(`Recovered ${recoveredRuns} run(s) stuck in running state.`)
  }
  app.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`)
    if (process.env.OTEL_ENABLED) {
      console.log(
        process.env.OTEL_CONSOLE_EXPORT
          ? 'OTel enabled: telemetry captured and spans are printed to this terminal.'
          : 'OTel enabled: telemetry captured in memory (set OTEL_CONSOLE_EXPORT=1 for stdout spans).'
      )
    }
  })
})()
