import type { TelemetryEntry } from './telemetry.js'
import type { RunRiskLevel, RunSummarySnapshot } from './history-summary.js'

export interface RunAgentRecord {
  name: string
  systemPrompt: string
  tools?: string[]
}

export interface RunEventRecord {
  sequence: number
  eventType: string
  nodeId: string | null
  status: string | null
  detail: string | null
  payload: unknown
  timestamp: number
}

export interface RunNodeMetricRecord {
  nodeId: string
  status: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  executionTime?: number
  costUsd?: number | null
  raw?: unknown
}

export type { RunRiskLevel, RunSummarySnapshot } from './history-summary.js'

export interface ListRunsOptions {
  anomaliesOnly?: boolean
  sort?: 'recent' | 'risk'
}

export interface StartRunInput {
  runId: string
  createdAt: number
  mode: 'single' | 'swarm' | 'graph'
  prompt: string
  requestJson: unknown
  agents: RunAgentRecord[]
  edges: Array<{ from: string; to: string }>
  entryPoint?: string
  entryPoints?: string[]
}

export interface CompleteRunInput {
  runId: string
  completedAt: number
  status: string | null | undefined
  resultText: string | null
  responseJson: unknown
  modelId?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  executionTimeMs?: number
  costUsd?: number | null
  events: RunEventRecord[]
  nodeMetrics: RunNodeMetricRecord[]
  telemetry: TelemetryEntry[]
}

export interface FailRunInput {
  runId: string
  completedAt: number
  errorMessage: string
  responseJson?: unknown
  events: RunEventRecord[]
  telemetry: TelemetryEntry[]
}

export interface HistoryRunSummary {
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

export interface HistoryRunDetail {
  run: HistoryRunSummary & {
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

export interface HistoryStats {
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
