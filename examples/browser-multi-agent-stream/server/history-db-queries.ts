export const CREATE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    prompt TEXT NOT NULL,
    result_text TEXT,
    error_message TEXT,
    model_id TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    execution_time_ms INTEGER,
    estimated_cost_usd REAL,
    request_json TEXT,
    response_json TEXT
  );

  CREATE TABLE IF NOT EXISTS run_agents (
    run_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    tools_json TEXT NOT NULL,
    is_entry_point INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, position),
    FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS run_edges (
    run_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    from_node TEXT NOT NULL,
    to_node TEXT NOT NULL,
    PRIMARY KEY (run_id, position),
    FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    node_id TEXT,
    status TEXT,
    detail TEXT,
    payload_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS run_node_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    status TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    execution_time_ms INTEGER,
    cost_usd REAL,
    raw_json TEXT,
    FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS run_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    span_name TEXT NOT NULL,
    start_time_ms REAL NOT NULL,
    end_time_ms REAL NOT NULL,
    duration_ms REAL NOT NULL,
    status_code INTEGER,
    status_message TEXT,
    attributes_json TEXT,
    events_json TEXT,
    FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_run_events_run_sequence ON run_events(run_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_run_node_metrics_run_id ON run_node_metrics(run_id);
  CREATE INDEX IF NOT EXISTS idx_run_telemetry_run_id ON run_telemetry(run_id);
`

export const BACKFILL_SUMMARIES_QUERY = `
  SELECT run_id, status, error_message, input_tokens, output_tokens, total_tokens, run_summary_json
  FROM runs
  WHERE run_summary_json IS NULL OR run_summary_json = ''
`

export const RUN_EVENTS_BY_RUN_QUERY = `
  SELECT sequence, event_type, node_id, status, detail, payload_json, created_at
  FROM run_events
  WHERE run_id = ?
  ORDER BY sequence ASC
`

export const RUN_NODE_METRICS_BY_RUN_QUERY = `
  SELECT node_id, status, input_tokens, output_tokens, total_tokens, execution_time_ms, cost_usd, raw_json
  FROM run_node_metrics
  WHERE run_id = ?
  ORDER BY id ASC
`

export function buildListRunsQuery(options: {
  anomaliesOnly: boolean
  sortMode: 'recent' | 'risk'
}): string {
  const whereClause = options.anomaliesOnly ? 'WHERE r.has_anomaly = 1' : ''
  const orderByClause =
    options.sortMode === 'risk'
      ? `
        ORDER BY
          CASE r.risk_level
            WHEN 'error' THEN 0
            WHEN 'warn' THEN 1
            ELSE 2
          END ASC,
          r.anomaly_count DESC,
          r.created_at DESC
      `
      : `ORDER BY r.created_at DESC`

  return `
    SELECT
      r.run_id,
      r.created_at,
      r.completed_at,
      r.mode,
      r.status,
      r.prompt,
      r.model_id,
      r.input_tokens,
      r.output_tokens,
      r.total_tokens,
      r.execution_time_ms,
      r.estimated_cost_usd,
      r.error_message,
      r.risk_level,
      r.anomaly_count,
      r.has_anomaly,
      r.run_summary_json,
      COALESCE(GROUP_CONCAT(a.name, ','), '') AS agent_names
    FROM runs r
    LEFT JOIN run_agents a ON a.run_id = r.run_id
    ${whereClause}
    GROUP BY r.run_id
    ${orderByClause}
    LIMIT ? OFFSET ?
  `
}

export const RUN_DETAIL_QUERY = `
  SELECT
    run_id,
    created_at,
    completed_at,
    mode,
    status,
    prompt,
    result_text,
    model_id,
    input_tokens,
    output_tokens,
    total_tokens,
    execution_time_ms,
    estimated_cost_usd,
    risk_level,
    anomaly_count,
    has_anomaly,
    run_summary_json,
    error_message,
    request_json,
    response_json
  FROM runs
  WHERE run_id = ?
`

export const RUN_AGENTS_QUERY = `
  SELECT position, name, system_prompt, tools_json, is_entry_point
  FROM run_agents
  WHERE run_id = ?
  ORDER BY position ASC
`

export const RUN_EDGES_QUERY = `
  SELECT position, from_node, to_node
  FROM run_edges
  WHERE run_id = ?
  ORDER BY position ASC
`

export const RUN_TELEMETRY_BY_RUN_QUERY = `
  SELECT span_name, start_time_ms, end_time_ms, duration_ms, status_code, status_message, attributes_json, events_json
  FROM run_telemetry
  WHERE run_id = ?
  ORDER BY start_time_ms ASC, duration_ms DESC, end_time_ms DESC, span_name ASC
`

export const TOTALS_STATS_QUERY = `
  SELECT
    COUNT(*) AS runs,
    COALESCE(SUM(input_tokens), 0) AS input_tokens,
    COALESCE(SUM(output_tokens), 0) AS output_tokens,
    COALESCE(SUM(total_tokens), 0) AS total_tokens,
    COALESCE(SUM(estimated_cost_usd), 0) AS total_cost_usd,
    COALESCE(AVG(execution_time_ms), 0) AS avg_execution_ms
  FROM runs
  WHERE created_at >= ?
`

export const DAILY_STATS_QUERY = `
  SELECT
    strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day,
    COUNT(*) AS runs,
    COALESCE(SUM(total_tokens), 0) AS total_tokens,
    COALESCE(SUM(estimated_cost_usd), 0) AS total_cost_usd,
    COALESCE(AVG(execution_time_ms), 0) AS avg_execution_ms
  FROM runs
  WHERE created_at >= ?
  GROUP BY day
  ORDER BY day ASC
`
