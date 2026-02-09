import type { TelemetryEntry, TelemetryEvent } from './telemetry.js'
import type {
  HistoryRunSummary,
  RunEventRecord,
  RunNodeMetricRecord,
  RunRiskLevel,
  RunSummarySnapshot,
} from './history-db-types.js'

type DbRow = Record<string, unknown>

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  return undefined
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function boolFromDb(value: unknown): boolean | undefined {
  const parsed = num(value)
  if (parsed == null) return undefined
  return parsed === 1
}

export function toRiskLevel(value: unknown): RunRiskLevel | undefined {
  const raw = str(value)
  if (raw === 'ok' || raw === 'warn' || raw === 'error') return raw
  return undefined
}

export function mapRunEventRows(rows: DbRow[]): RunEventRecord[] {
  return rows.map((row) => ({
    sequence: num(row.sequence) ?? 0,
    eventType: str(row.event_type) ?? 'event',
    nodeId: str(row.node_id) ?? null,
    status: str(row.status) ?? null,
    detail: str(row.detail) ?? null,
    payload: parseJson(row.payload_json, {}),
    timestamp: num(row.created_at) ?? 0,
  }))
}

export function mapRunNodeMetricRows(rows: DbRow[]): RunNodeMetricRecord[] {
  return rows.map((row) => ({
    nodeId: str(row.node_id) ?? '',
    status: str(row.status) ?? 'unknown',
    inputTokens: num(row.input_tokens),
    outputTokens: num(row.output_tokens),
    totalTokens: num(row.total_tokens),
    executionTime: num(row.execution_time_ms),
    costUsd: num(row.cost_usd),
    raw: parseJson(row.raw_json, {}),
  }))
}

export function mapHistoryRunSummaryRows(rows: DbRow[]): HistoryRunSummary[] {
  return rows.map((row) => ({
    runId: str(row.run_id) ?? '',
    createdAt: num(row.created_at) ?? 0,
    completedAt: num(row.completed_at),
    mode: str(row.mode) ?? 'unknown',
    status: str(row.status) ?? 'unknown',
    prompt: str(row.prompt) ?? '',
    modelId: str(row.model_id),
    inputTokens: num(row.input_tokens),
    outputTokens: num(row.output_tokens),
    totalTokens: num(row.total_tokens),
    executionTimeMs: num(row.execution_time_ms),
    estimatedCostUsd: num(row.estimated_cost_usd),
    errorMessage: str(row.error_message),
    riskLevel: toRiskLevel(row.risk_level),
    anomalyCount: num(row.anomaly_count),
    hasAnomaly: boolFromDb(row.has_anomaly),
    summary: parseJson<RunSummarySnapshot | undefined>(row.run_summary_json, undefined),
    agentNames: (str(row.agent_names) ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  }))
}

export function mapRunAgentsForDetail(rows: DbRow[]): Array<{
  position: number
  name: string
  systemPrompt: string
  tools: string[]
  isEntryPoint: boolean
}> {
  return rows.map((row) => ({
    position: num(row.position) ?? 0,
    name: str(row.name) ?? '',
    systemPrompt: str(row.system_prompt) ?? '',
    tools: parseJson<string[]>(row.tools_json, []),
    isEntryPoint: num(row.is_entry_point) === 1,
  }))
}

export function mapRunEdgesForDetail(rows: DbRow[]): Array<{ position: number; from: string; to: string }> {
  return rows.map((row) => ({
    position: num(row.position) ?? 0,
    from: str(row.from_node) ?? '',
    to: str(row.to_node) ?? '',
  }))
}

export function mapRunEventsForDetail(rows: DbRow[]): Array<{
  sequence: number
  eventType: string
  nodeId: string | null
  status: string | null
  detail: string | null
  createdAt: number
  payload: unknown
}> {
  return rows.map((row) => ({
    sequence: num(row.sequence) ?? 0,
    eventType: str(row.event_type) ?? 'event',
    nodeId: str(row.node_id) ?? null,
    status: str(row.status) ?? null,
    detail: str(row.detail) ?? null,
    createdAt: num(row.created_at) ?? 0,
    payload: parseJson(row.payload_json, {}),
  }))
}

export function mapRunNodeMetricsForDetail(rows: DbRow[]): Array<{
  nodeId: string
  status: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  executionTimeMs?: number
  costUsd?: number
  raw?: unknown
}> {
  return rows.map((row) => ({
    nodeId: str(row.node_id) ?? '',
    status: str(row.status) ?? 'unknown',
    inputTokens: num(row.input_tokens),
    outputTokens: num(row.output_tokens),
    totalTokens: num(row.total_tokens),
    executionTimeMs: num(row.execution_time_ms),
    costUsd: num(row.cost_usd),
    raw: parseJson(row.raw_json, {}),
  }))
}

export function mapTelemetryRows(rows: DbRow[]): TelemetryEntry[] {
  return rows.map((row) => ({
    name: str(row.span_name) ?? '',
    startTime: num(row.start_time_ms) ?? 0,
    endTime: num(row.end_time_ms) ?? 0,
    durationMs: num(row.duration_ms) ?? 0,
    statusCode: num(row.status_code),
    statusMessage: str(row.status_message),
    attributes: parseJson<Record<string, unknown>>(row.attributes_json, {}),
    events: parseJson<TelemetryEvent[]>(row.events_json, []),
  }))
}

export function mapDailyStatsRows(rows: DbRow[]): Array<{
  day: string
  runs: number
  totalTokens: number
  totalCostUsd: number
  avgExecutionMs: number
}> {
  return rows.map((row) => ({
    day: str(row.day) ?? '',
    runs: num(row.runs) ?? 0,
    totalTokens: num(row.total_tokens) ?? 0,
    totalCostUsd: num(row.total_cost_usd) ?? 0,
    avgExecutionMs: num(row.avg_execution_ms) ?? 0,
  }))
}
