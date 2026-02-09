export type RunMode = 'single' | 'swarm' | 'graph'
export type CuratedModelProfile = 'speed' | 'quality' | 'cost' | 'reasoning' | 'coding' | 'balanced'

export type StructuredOutputSchemaId =
  | 'article_summary_v1'
  | 'orchestration_decision_v1'
  | 'agent_review_verdict_v1'

export interface AgentSpec {
  id: string
  name: string
  systemPrompt: string
  /** Optional tool names for this agent (e.g. calculator, current_time). When set, only these tools are available. */
  tools?: string[]
}

export interface PresetConfig {
  agents: AgentSpec[]
  mode?: RunMode
  edges?: Array<{ from: string; to: string }>
  /** Agent names that start execution (graph mode). When omitted, all agents are entry points. */
  entryPoints?: string[]
  /** Agent name used for single-agent execution mode. */
  singleAgent?: string
  /** Structured output schema to enforce for the run. */
  structuredOutputSchema?: StructuredOutputSchemaId
  /** Optional stable session ID for SDK session persistence across runs. */
  sessionId?: string
  prompt?: string
}

export interface PresetGuide {
  feature: string
  summary: string
  steps: string[]
}

export interface StreamSegment {
  nodeId: string
  text: string
}

export interface TimelineEntry {
  type: string
  status?: string
  detail?: string
  time: number
}

export interface ActivityEvent {
  type: string
  nodeLabel: string
  detail: string
  className?: string
}

export interface TelemetryEvent {
  name: string
  timeMs: number
  attributes: Record<string, unknown>
}

export interface TelemetryEntry {
  name: string
  startTime: number
  endTime: number
  durationMs: number
  attributes: Record<string, unknown>
  statusCode?: number
  statusMessage?: string
  events: TelemetryEvent[]
}

export type TabId = 'output' | 'metrics' | 'logs'

export type RunRiskLevel = 'ok' | 'warn' | 'error'

export interface RunSummarySnapshot {
  riskLevel: RunRiskLevel
  hasAnomaly: boolean
  anomalyCount: number
  issueCodes: string[]
  issueMessages: string[]
  eventCount: number
  nodeCount: number
  handoffCount: number
  streamCount: number
  errorEventCount: number
  startCount: number
  stopCount: number
  resultCount: number
  interruptCount: number
  cancelCount: number
  totalTokens?: number
  tokenBudgetPct?: number
  topNodes: Array<{ nodeId: string; count: number }>
}

export interface RunPayload {
  prompt: string
  mode: RunMode
  agents: Array<{ name: string; systemPrompt: string; tools?: string[] }>
  modelProfile?: CuratedModelProfile
  modelId?: string
  presetKey?: string
  sessionId?: string
  singleAgent?: string
  entryPoint?: string
  maxHandoffs?: number
  edges?: Array<{ from: string; to: string }>
  entryPoints?: string[]
  structuredOutputSchema?: StructuredOutputSchemaId
}

export interface MetricsPerNode {
  nodeId: string
  status: string
  modelId?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number | null
  executionTime?: number
}

export interface MetricsPerModel {
  modelId: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number | null
}

export interface DonePayload {
  runId?: string
  text?: string
  status?: string
  result?: unknown
  structuredOutput?: unknown
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  executionTime?: number
  nodeHistory?: string[]
  executionOrder?: string[]
  perNode?: MetricsPerNode[]
  perModelUsage?: MetricsPerModel[]
  modelId?: string
  estimatedCostUsd?: number | null
}

export interface RunHistorySummary {
  runId: string
  createdAt: number
  completedAt?: number
  mode: string
  status: string
  prompt: string
  modelId?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  executionTimeMs?: number
  estimatedCostUsd?: number
  errorMessage?: string
  agentNames: string[]
  riskLevel?: RunRiskLevel
  anomalyCount?: number
  hasAnomaly?: boolean
  summary?: RunSummarySnapshot
}

export interface RunHistoryResponse {
  runs: RunHistorySummary[]
  limit: number
  offset: number
  anomaliesOnly?: boolean
  sort?: 'recent' | 'risk'
}

export interface RunHistoryDetail {
  run: RunHistorySummary & {
    resultText?: string
    requestJson?: unknown
    responseJson?: unknown
  }
  agents: Array<{
    position: number
    name: string
    systemPrompt: string
    tools: string[]
    isEntryPoint: boolean
  }>
  edges: Array<{ position: number; from: string; to: string }>
  events: Array<{
    sequence: number
    eventType: string
    nodeId: string | null
    status: string | null
    detail: string | null
    createdAt: number
    payload: unknown
  }>
  nodeMetrics: Array<{
    nodeId: string
    status: string
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    executionTimeMs?: number
    costUsd?: number
    raw?: unknown
  }>
  telemetry: TelemetryEntry[]
}

export interface HistoryStatsResponse {
  days: number
  stats: {
    totals: {
      runs: number
      inputTokens: number
      outputTokens: number
      totalTokens: number
      totalCostUsd: number
      avgExecutionMs: number
    }
    daily: Array<{
      day: string
      runs: number
      totalTokens: number
      totalCostUsd: number
      avgExecutionMs: number
    }>
  }
}
