import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { buildRunSummarySnapshot } from './history-summary.js'
import type {
  CompleteRunInput,
  FailRunInput,
  HistoryRunDetail,
  HistoryRunSummary,
  HistoryStats,
  ListRunsOptions,
  RunAgentRecord,
  RunEventRecord,
  RunNodeMetricRecord,
  RunRiskLevel,
  RunSummarySnapshot,
  StartRunInput,
} from './history-db-types.js'
import {
  boolFromDb,
  mapDailyStatsRows,
  mapHistoryRunSummaryRows,
  mapRunAgentsForDetail,
  mapRunEdgesForDetail,
  mapRunEventRows,
  mapRunEventsForDetail,
  mapRunNodeMetricRows,
  mapRunNodeMetricsForDetail,
  mapTelemetryRows,
  num,
  parseJson,
  str,
  toRiskLevel,
} from './history-db-mappers.js'
import {
  BACKFILL_SUMMARIES_QUERY,
  buildListRunsQuery,
  CREATE_SCHEMA_SQL,
  DAILY_STATS_QUERY,
  RUN_AGENTS_QUERY,
  RUN_DETAIL_QUERY,
  RUN_EDGES_QUERY,
  RUN_EVENTS_BY_RUN_QUERY,
  RUN_NODE_METRICS_BY_RUN_QUERY,
  RUN_TELEMETRY_BY_RUN_QUERY,
  TOTALS_STATS_QUERY,
} from './history-db-queries.js'

interface DbRow {
  [key: string]: unknown
}

interface StatementResult {
  changes: number
  lastInsertRowid: number | bigint
}

interface DbStatement {
  run: (...params: unknown[]) => StatementResult
  get: (...params: unknown[]) => DbRow | undefined
  all: (...params: unknown[]) => DbRow[]
}

interface Db {
  exec: (sql: string) => void
  prepare: (sql: string) => DbStatement
}

function openDatabase(filename: string): Db {
  return new Database(filename) as unknown as Db
}
export type {
  CompleteRunInput,
  FailRunInput,
  HistoryRunDetail,
  HistoryRunSummary,
  HistoryStats,
  ListRunsOptions,
  RunAgentRecord,
  RunEventRecord,
  RunNodeMetricRecord,
  RunRiskLevel,
  RunSummarySnapshot,
  StartRunInput,
} from './history-db-types.js'

function safeJson(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(value ?? null, (_key, current: unknown) => {
      if (typeof current === 'bigint') return current.toString()
      if (typeof current === 'function') return `[Function ${(current as () => unknown).name || 'anonymous'}]`
      if (typeof current === 'symbol') return current.toString()
      if (current instanceof Error) {
        return {
          name: current.name,
          message: current.message,
          stack: current.stack,
        }
      }
      if (current !== null && typeof current === 'object') {
        if (seen.has(current as object)) return '[Circular]'
        seen.add(current as object)
      }
      return current
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return JSON.stringify({
      serializationError: message,
      fallback: String(value),
    })
  }
}


function createDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = openDatabase(dbPath)
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA synchronous = NORMAL;')
  db.exec(CREATE_SCHEMA_SQL)

  const runColumns = new Set(
    db
      .prepare(`PRAGMA table_info(runs)`)
      .all()
      .map((row) => str(row.name) ?? '')
      .filter(Boolean)
  )
  if (!runColumns.has('risk_level')) {
    db.exec(`ALTER TABLE runs ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'ok';`)
  }
  if (!runColumns.has('anomaly_count')) {
    db.exec(`ALTER TABLE runs ADD COLUMN anomaly_count INTEGER NOT NULL DEFAULT 0;`)
  }
  if (!runColumns.has('has_anomaly')) {
    db.exec(`ALTER TABLE runs ADD COLUMN has_anomaly INTEGER NOT NULL DEFAULT 0;`)
  }
  if (!runColumns.has('run_summary_json')) {
    db.exec(`ALTER TABLE runs ADD COLUMN run_summary_json TEXT;`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_has_anomaly_created ON runs(has_anomaly, created_at DESC);`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_risk_level_created ON runs(risk_level, created_at DESC);`)
  return db
}

export class HistoryStore {
  private readonly db: Db

  private readonly insertRunStmt: DbStatement
  private readonly insertAgentStmt: DbStatement
  private readonly insertEdgeStmt: DbStatement
  private readonly updateRunSuccessStmt: DbStatement
  private readonly updateRunFailureStmt: DbStatement
  private readonly updateRunSummaryOnlyStmt: DbStatement
  private readonly insertEventStmt: DbStatement
  private readonly insertNodeMetricStmt: DbStatement
  private readonly insertTelemetryStmt: DbStatement
  private readonly recoverRunningStmt: DbStatement

  constructor(dbPath: string) {
    this.db = createDatabase(dbPath)
    this.insertRunStmt = this.db.prepare(`
      INSERT INTO runs (
        run_id, created_at, mode, status, prompt, request_json
      ) VALUES (?, ?, ?, 'running', ?, ?)
    `)
    this.insertAgentStmt = this.db.prepare(`
      INSERT INTO run_agents (
        run_id, position, name, system_prompt, tools_json, is_entry_point
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    this.insertEdgeStmt = this.db.prepare(`
      INSERT INTO run_edges (
        run_id, position, from_node, to_node
      ) VALUES (?, ?, ?, ?)
    `)
    this.updateRunSuccessStmt = this.db.prepare(`
      UPDATE runs
      SET
        completed_at = ?,
        status = ?,
        result_text = ?,
        model_id = ?,
        input_tokens = ?,
        output_tokens = ?,
        total_tokens = ?,
        execution_time_ms = ?,
        estimated_cost_usd = ?,
        response_json = ?,
        risk_level = ?,
        anomaly_count = ?,
        has_anomaly = ?,
        run_summary_json = ?
      WHERE run_id = ?
    `)
    this.updateRunFailureStmt = this.db.prepare(`
      UPDATE runs
      SET
        completed_at = ?,
        status = 'failed',
        error_message = ?,
        response_json = ?,
        risk_level = ?,
        anomaly_count = ?,
        has_anomaly = ?,
        run_summary_json = ?
      WHERE run_id = ?
    `)
    this.updateRunSummaryOnlyStmt = this.db.prepare(`
      UPDATE runs
      SET
        risk_level = ?,
        anomaly_count = ?,
        has_anomaly = ?,
        run_summary_json = ?
      WHERE run_id = ?
    `)
    this.insertEventStmt = this.db.prepare(`
      INSERT INTO run_events (
        run_id, sequence, event_type, node_id, status, detail, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.insertNodeMetricStmt = this.db.prepare(`
      INSERT INTO run_node_metrics (
        run_id, node_id, status, input_tokens, output_tokens, total_tokens, execution_time_ms, cost_usd, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.insertTelemetryStmt = this.db.prepare(`
      INSERT INTO run_telemetry (
        run_id, span_name, start_time_ms, end_time_ms, duration_ms, status_code, status_message, attributes_json, events_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.recoverRunningStmt = this.db.prepare(`
      UPDATE runs
      SET
        status = 'interrupted',
        completed_at = COALESCE(completed_at, ?),
        error_message = COALESCE(error_message, ?),
        risk_level = 'warn',
        anomaly_count = CASE WHEN anomaly_count > 0 THEN anomaly_count ELSE 1 END,
        has_anomaly = 1,
        run_summary_json = COALESCE(run_summary_json, ?)
      WHERE status = 'running'
    `)
    this.backfillSummaries()
  }

  private backfillSummaries(): void {
    const rows = this.db
      .prepare(BACKFILL_SUMMARIES_QUERY)
      .all()
    if (rows.length === 0) return

    this.db.exec('BEGIN')
    try {
      for (const row of rows) {
        const runId = str(row.run_id)
        if (runId == null || runId.trim() === '') continue

        const eventRows = this.db.prepare(RUN_EVENTS_BY_RUN_QUERY).all(runId)
        const events: RunEventRecord[] = mapRunEventRows(eventRows)

        const nodeMetricRows = this.db.prepare(RUN_NODE_METRICS_BY_RUN_QUERY).all(runId)
        const nodeMetrics: RunNodeMetricRecord[] = mapRunNodeMetricRows(nodeMetricRows)

        const summary = buildRunSummarySnapshot({
          status: str(row.status),
          errorMessage: str(row.error_message),
          events,
          nodeMetrics,
          inputTokens: num(row.input_tokens),
          outputTokens: num(row.output_tokens),
          totalTokens: num(row.total_tokens),
        })
        this.updateRunSummaryOnlyStmt.run(
          summary.riskLevel,
          summary.anomalyCount,
          summary.hasAnomaly ? 1 : 0,
          safeJson(summary),
          runId
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`Failed to backfill run summaries: ${message}`)
    }
  }

  startRun(input: StartRunInput): void {
    this.db.exec('BEGIN')
    try {
      this.insertRunStmt.run(
        input.runId,
        input.createdAt,
        input.mode,
        input.prompt,
        safeJson(input.requestJson)
      )

      const entryPointSet = new Set<string>([
        ...(input.entryPoint ? [input.entryPoint] : []),
        ...(input.entryPoints ?? []),
      ])

      input.agents.forEach((agent, index) => {
        this.insertAgentStmt.run(
          input.runId,
          index,
          agent.name,
          agent.systemPrompt,
          safeJson(agent.tools ?? []),
          entryPointSet.has(agent.name) ? 1 : 0
        )
      })

      input.edges.forEach((edge, index) => {
        this.insertEdgeStmt.run(input.runId, index, edge.from, edge.to)
      })

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  completeRun(input: CompleteRunInput): void {
    this.db.exec('BEGIN')
    try {
      const summary = buildRunSummarySnapshot({
        status: input.status ?? 'completed',
        events: input.events,
        nodeMetrics: input.nodeMetrics,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        totalTokens: input.totalTokens,
      })
      this.updateRunSuccessStmt.run(
        input.completedAt,
        input.status ?? 'completed',
        input.resultText,
        input.modelId ?? null,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        input.totalTokens ?? null,
        input.executionTimeMs ?? null,
        input.costUsd ?? null,
        safeJson(input.responseJson),
        summary.riskLevel,
        summary.anomalyCount,
        summary.hasAnomaly ? 1 : 0,
        safeJson(summary),
        input.runId
      )

      for (const event of input.events) {
        this.insertEventStmt.run(
          input.runId,
          event.sequence,
          event.eventType,
          event.nodeId,
          event.status,
          event.detail,
          safeJson(event.payload),
          event.timestamp
        )
      }

      for (const metric of input.nodeMetrics) {
        this.insertNodeMetricStmt.run(
          input.runId,
          metric.nodeId,
          metric.status,
          metric.inputTokens ?? null,
          metric.outputTokens ?? null,
          metric.totalTokens ?? null,
          metric.executionTime ?? null,
          metric.costUsd ?? null,
          safeJson(metric.raw ?? null)
        )
      }

      for (const span of input.telemetry) {
        this.insertTelemetryStmt.run(
          input.runId,
          span.name,
          span.startTime,
          span.endTime,
          span.durationMs,
          span.statusCode ?? null,
          span.statusMessage ?? null,
          safeJson(span.attributes ?? {}),
          safeJson(span.events ?? [])
        )
      }

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  failRun(input: FailRunInput): void {
    this.db.exec('BEGIN')
    try {
      const summary = buildRunSummarySnapshot({
        status: 'failed',
        errorMessage: input.errorMessage,
        events: input.events,
        nodeMetrics: [],
      })
      this.updateRunFailureStmt.run(
        input.completedAt,
        input.errorMessage,
        safeJson(input.responseJson ?? { error: input.errorMessage }),
        summary.riskLevel,
        summary.anomalyCount,
        summary.hasAnomaly ? 1 : 0,
        safeJson(summary),
        input.runId
      )

      for (const event of input.events) {
        this.insertEventStmt.run(
          input.runId,
          event.sequence,
          event.eventType,
          event.nodeId,
          event.status,
          event.detail,
          safeJson(event.payload),
          event.timestamp
        )
      }

      for (const span of input.telemetry) {
        this.insertTelemetryStmt.run(
          input.runId,
          span.name,
          span.startTime,
          span.endTime,
          span.durationMs,
          span.statusCode ?? null,
          span.statusMessage ?? null,
          safeJson(span.attributes ?? {}),
          safeJson(span.events ?? [])
        )
      }

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  markRunCompletedMinimal(input: {
    runId: string
    completedAt: number
    status?: string | null
    resultText?: string | null
    responseJson?: unknown
    modelId?: string
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    executionTimeMs?: number
    costUsd?: number | null
  }): void {
    const summary = buildRunSummarySnapshot({
      status: input.status ?? 'completed',
      events: [],
      nodeMetrics: [],
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.totalTokens,
    })
    this.updateRunSuccessStmt.run(
      input.completedAt,
      input.status ?? 'completed',
      input.resultText ?? null,
      input.modelId ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.totalTokens ?? null,
      input.executionTimeMs ?? null,
      input.costUsd ?? null,
      safeJson(input.responseJson ?? null),
      summary.riskLevel,
      summary.anomalyCount,
      summary.hasAnomaly ? 1 : 0,
      safeJson(summary),
      input.runId
    )
  }

  markRunFailedMinimal(input: {
    runId: string
    completedAt: number
    errorMessage: string
    responseJson?: unknown
  }): void {
    const summary = buildRunSummarySnapshot({
      status: 'failed',
      errorMessage: input.errorMessage,
      events: [],
      nodeMetrics: [],
    })
    this.updateRunFailureStmt.run(
      input.completedAt,
      input.errorMessage,
      safeJson(input.responseJson ?? { error: input.errorMessage }),
      summary.riskLevel,
      summary.anomalyCount,
      summary.hasAnomaly ? 1 : 0,
      safeJson(summary),
      input.runId
    )
  }

  recoverRunningRuns(nowMs: number, reason: string): number {
    const summary = buildRunSummarySnapshot({
      status: 'interrupted',
      errorMessage: reason,
      events: [],
      nodeMetrics: [],
    })
    const result = this.recoverRunningStmt.run(nowMs, reason, safeJson(summary))
    return typeof result.changes === 'number' ? result.changes : 0
  }

  listRuns(limit: number, offset: number, options?: ListRunsOptions): HistoryRunSummary[] {
    const anomaliesOnly = options?.anomaliesOnly === true
    const sortMode = options?.sort === 'risk' ? 'risk' : 'recent'
    const rows = this.db
      .prepare(buildListRunsQuery({ anomaliesOnly, sortMode }))
      .all(limit, offset)

    return mapHistoryRunSummaryRows(rows)
  }

  getRun(runId: string): HistoryRunDetail | null {
    const runRow = this.db
      .prepare(RUN_DETAIL_QUERY)
      .get(runId)

    if (runRow == null) return null

    const agentRows = this.db.prepare(RUN_AGENTS_QUERY).all(runId)
    const edgeRows = this.db.prepare(RUN_EDGES_QUERY).all(runId)
    const eventRows = this.db.prepare(RUN_EVENTS_BY_RUN_QUERY).all(runId)
    const nodeMetricRows = this.db.prepare(RUN_NODE_METRICS_BY_RUN_QUERY).all(runId)
    const telemetryRows = this.db.prepare(RUN_TELEMETRY_BY_RUN_QUERY).all(runId)

    const summary: HistoryRunSummary = {
      runId: str(runRow.run_id) ?? '',
      createdAt: num(runRow.created_at) ?? 0,
      completedAt: num(runRow.completed_at),
      mode: str(runRow.mode) ?? 'unknown',
      status: str(runRow.status) ?? 'unknown',
      prompt: str(runRow.prompt) ?? '',
      modelId: str(runRow.model_id),
      inputTokens: num(runRow.input_tokens),
      outputTokens: num(runRow.output_tokens),
      totalTokens: num(runRow.total_tokens),
      executionTimeMs: num(runRow.execution_time_ms),
      estimatedCostUsd: num(runRow.estimated_cost_usd),
      errorMessage: str(runRow.error_message),
      riskLevel: toRiskLevel(runRow.risk_level),
      anomalyCount: num(runRow.anomaly_count),
      hasAnomaly: boolFromDb(runRow.has_anomaly),
      summary: parseJson<RunSummarySnapshot | undefined>(runRow.run_summary_json, undefined),
      agentNames: agentRows.map((row) => str(row.name) ?? '').filter(Boolean),
    }

    return {
      run: {
        ...summary,
        resultText: str(runRow.result_text),
        requestJson: parseJson(runRow.request_json, {}),
        responseJson: parseJson(runRow.response_json, {}),
      },
      agents: mapRunAgentsForDetail(agentRows),
      edges: mapRunEdgesForDetail(edgeRows),
      events: mapRunEventsForDetail(eventRows),
      nodeMetrics: mapRunNodeMetricsForDetail(nodeMetricRows),
      telemetry: mapTelemetryRows(telemetryRows),
    }
  }

  getStats(days: number): HistoryStats {
    const windowDays = Number.isFinite(days) ? Math.max(1, Math.min(365, Math.floor(days))) : 30
    const since = Date.now() - windowDays * 24 * 60 * 60 * 1000

    const totalsRow = this.db.prepare(TOTALS_STATS_QUERY).get(since)
    const dailyRows = this.db.prepare(DAILY_STATS_QUERY).all(since)

    return {
      totals: {
        runs: num(totalsRow?.runs) ?? 0,
        inputTokens: num(totalsRow?.input_tokens) ?? 0,
        outputTokens: num(totalsRow?.output_tokens) ?? 0,
        totalTokens: num(totalsRow?.total_tokens) ?? 0,
        totalCostUsd: num(totalsRow?.total_cost_usd) ?? 0,
        avgExecutionMs: num(totalsRow?.avg_execution_ms) ?? 0,
      },
      daily: mapDailyStatsRows(dailyRows),
    }
  }
}

export function createHistoryStore(): HistoryStore {
  const defaultPath = path.join(process.cwd(), '.data', 'browser-multi-agent-stream.sqlite')
  const dbPath = process.env.RUN_HISTORY_DB_PATH?.trim() || defaultPath
  return new HistoryStore(dbPath)
}
