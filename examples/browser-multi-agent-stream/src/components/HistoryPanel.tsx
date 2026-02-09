import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { fetchRunDetail, fetchRunHistory, fetchRunHistoryStats } from '../api/api'
import ExecutionSummaryPanel from './ExecutionSummaryPanel'
import LogsPanel from './LogsPanel'
import MarkdownRenderer from './MarkdownRenderer'

const DEFAULT_LIMIT = 40

function formatDate(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString()
}

function formatCost(cost: number | undefined): string {
  if (cost == null || !Number.isFinite(cost)) return '—'
  return `$${cost.toFixed(4)}`
}

function formatNumber(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString()
}

export default function HistoryPanel(): JSX.Element {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [anomaliesOnly, setAnomaliesOnly] = useState(false)

  const historyQuery = useQuery({
    queryKey: ['run-history', DEFAULT_LIMIT, offset, anomaliesOnly],
    queryFn: () =>
      fetchRunHistory(DEFAULT_LIMIT, offset, {
        anomaliesOnly,
        sort: anomaliesOnly ? 'risk' : 'recent',
      }),
  })

  const statsQuery = useQuery({
    queryKey: ['run-history-stats', 30],
    queryFn: () => fetchRunHistoryStats(30),
  })

  const detailQuery = useQuery({
    queryKey: ['run-detail', selectedRunId],
    queryFn: () => fetchRunDetail(selectedRunId as string),
    enabled: selectedRunId != null,
  })

  const runs = historyQuery.data?.runs ?? []
  const totalRuns = statsQuery.data?.stats.totals.runs ?? 0
  const totalCost = statsQuery.data?.stats.totals.totalCostUsd ?? 0
  const totalTokens = statsQuery.data?.stats.totals.totalTokens ?? 0
  const daily = statsQuery.data?.stats.daily ?? []
  const anomalyRunsInPage = runs.filter((run) => run.hasAnomaly).length

  const pageLabel = useMemo(() => {
    const start = offset + 1
    const end = offset + runs.length
    return runs.length > 0 ? `${start}-${end}` : '0'
  }, [offset, runs.length])

  return (
    <div className="panel-section history-panel">
      <div className="history-header">
        <h2 className="panel-heading">Run History</h2>
        <div className="history-totals">
          <span>Runs (30d): {formatNumber(totalRuns)}</span>
          <span>Tokens: {formatNumber(totalTokens)}</span>
          <span>Cost: {formatCost(totalCost)}</span>
        </div>
      </div>

      {daily.length > 0 && (
        <div className="history-trend-strip">
          {daily.slice(-14).map((row) => (
            <div key={row.day} className="history-trend-item">
              <span>{row.day.slice(5)}</span>
              <strong>{formatCost(row.totalCostUsd)}</strong>
              <em>{formatNumber(row.runs)} runs</em>
            </div>
          ))}
        </div>
      )}

      <div className="history-grid">
        <div className="history-list">
          <div className="history-list-controls">
            <div className="history-list-controls-main">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setOffset((prev) => Math.max(0, prev - DEFAULT_LIMIT))}
                disabled={offset === 0}
              >
                Prev
              </button>
              <span>Rows {pageLabel}</span>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setOffset((prev) => prev + DEFAULT_LIMIT)}
                disabled={runs.length < DEFAULT_LIMIT}
              >
                Next
              </button>
            </div>
            <button
              type="button"
              className={`secondary-btn ${anomaliesOnly ? 'active' : ''}`}
              onClick={() => {
                setAnomaliesOnly((prev) => !prev)
                setOffset(0)
              }}
              aria-pressed={anomaliesOnly}
            >
              {anomaliesOnly ? 'Showing anomalies' : 'Show anomalies only'}
            </button>
          </div>
          <div className="history-list-subtle">
            {anomaliesOnly
              ? `${formatNumber(runs.length)} anomalous run${runs.length === 1 ? '' : 's'} on this page`
              : `${formatNumber(anomalyRunsInPage)} anomalous run${anomalyRunsInPage === 1 ? '' : 's'} on this page`}
          </div>

          {historyQuery.isLoading ? (
            <div className="history-empty">Loading history…</div>
          ) : historyQuery.isError ? (
            <div className="history-empty">
              {historyQuery.error instanceof Error ? historyQuery.error.message : 'Failed to load history'}
            </div>
          ) : runs.length === 0 ? (
            <div className="history-empty">{anomaliesOnly ? 'No anomalous runs found.' : 'No persisted runs yet.'}</div>
          ) : (
            <table className="history-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.runId}
                    className={selectedRunId === run.runId ? 'selected' : ''}
                    onClick={() => setSelectedRunId(run.runId)}
                  >
                    <td>
                      <div>{formatDate(run.createdAt)}</div>
                      <div className="history-prompt-preview">{run.prompt.slice(0, 80)}</div>
                    </td>
                    <td>{run.mode}</td>
                    <td>{run.status}</td>
                    <td>
                      <span className={`risk-badge risk-${run.riskLevel ?? 'ok'}`}>
                        {(run.riskLevel ?? 'ok').toUpperCase()}
                        {(run.anomalyCount ?? 0) > 0 ? ` · ${run.anomalyCount}` : ''}
                      </span>
                    </td>
                    <td>{formatNumber(run.totalTokens)}</td>
                    <td>{formatCost(run.estimatedCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="history-detail">
          {selectedRunId == null ? (
            <div className="history-empty">Select a run to inspect prompt, outputs, metrics, and telemetry.</div>
          ) : detailQuery.isLoading ? (
            <div className="history-empty">Loading run detail…</div>
          ) : detailQuery.isError ? (
            <div className="history-empty">
              {detailQuery.error instanceof Error ? detailQuery.error.message : 'Failed to load run detail'}
            </div>
          ) : detailQuery.data ? (
            <>
              <div className="history-detail-header">
                <strong>{detailQuery.data.run.runId}</strong>
                <span>{detailQuery.data.run.mode}</span>
                <span>{detailQuery.data.run.status}</span>
                <span>{formatCost(detailQuery.data.run.estimatedCostUsd)}</span>
              </div>

              <ExecutionSummaryPanel
                run={detailQuery.data.run}
                events={detailQuery.data.events}
                nodeMetrics={detailQuery.data.nodeMetrics}
              />

              <div className="history-block">
                <h3>Prompt</h3>
                <pre>{detailQuery.data.run.prompt}</pre>
              </div>

              <div className="history-block">
                <h3>Result</h3>
                <MarkdownRenderer
                  text={detailQuery.data.run.resultText ?? detailQuery.data.run.errorMessage ?? '—'}
                  className="markdown-result"
                />
              </div>

              <div className="history-block">
                <h3>Agents</h3>
                <ul>
                  {detailQuery.data.agents.map((agent) => (
                    <li key={`${agent.position}-${agent.name}`}>
                      {agent.name}
                      {agent.isEntryPoint ? ' (entry)' : ''} — tools: {agent.tools.length > 0 ? agent.tools.join(', ') : 'all'}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="history-block">
                <h3>Node Metrics</h3>
                {detailQuery.data.nodeMetrics.length === 0 ? (
                  <div>—</div>
                ) : (
                  <table className="history-table compact">
                    <thead>
                      <tr>
                        <th>Node</th>
                        <th>Status</th>
                        <th>In</th>
                        <th>Out</th>
                        <th>Cost</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailQuery.data.nodeMetrics.map((metric, index) => (
                        <tr key={`${metric.nodeId}-${index}`}>
                          <td>{metric.nodeId}</td>
                          <td>{metric.status}</td>
                          <td>{formatNumber(metric.inputTokens)}</td>
                          <td>{formatNumber(metric.outputTokens)}</td>
                          <td>{formatCost(metric.costUsd)}</td>
                          <td>{formatNumber(metric.executionTimeMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="history-block">
                <LogsPanel
                  entries={detailQuery.data.telemetry}
                  title={`OpenTelemetry (${detailQuery.data.telemetry.length})`}
                  emptyMessage="No persisted telemetry logs for this run."
                  onRefresh={() => detailQuery.refetch()}
                  compact
                />
              </div>
            </>
          ) : (
            <div className="history-empty">Run detail unavailable.</div>
          )}
        </div>
      </div>
    </div>
  )
}
