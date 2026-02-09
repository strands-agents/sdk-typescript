import type { RunHistoryDetail } from '../lib/types'

const MAX_TOKEN_BUDGET = 100_000

type RunDetailRun = RunHistoryDetail['run']
type RunDetailEvent = RunHistoryDetail['events'][number]
type RunDetailNodeMetric = RunHistoryDetail['nodeMetrics'][number]

interface ExecutionSummaryPanelProps {
  run: RunDetailRun
  events: RunDetailEvent[]
  nodeMetrics: RunDetailNodeMetric[]
  compact?: boolean
}

function formatNumber(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString()
}

function formatCost(cost: number | undefined): string {
  if (cost == null || !Number.isFinite(cost)) return '—'
  return `$${cost.toFixed(4)}`
}

function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1_000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1_000)
  return `${minutes}m ${seconds}s`
}

function toStatusClass(status: string | undefined): 'ok' | 'warn' | 'error' {
  const normalized = (status ?? '').toLowerCase()
  if (normalized === 'completed' || normalized === 'success' || normalized === 'ok') return 'ok'
  if (normalized === 'running' || normalized === 'executing' || normalized === 'interrupted') return 'warn'
  return 'error'
}

function buildEventCounts(events: RunDetailEvent[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const event of events) {
    counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1)
  }
  return counts
}

export default function ExecutionSummaryPanel({
  run,
  events,
  nodeMetrics,
  compact = false,
}: ExecutionSummaryPanelProps): JSX.Element {
  const counts = buildEventCounts(events)
  const count = (type: string): number => counts.get(type) ?? 0

  const startCount = count('multiAgentNodeStartEvent')
  const stopCount = count('multiAgentNodeStopEvent')
  const streamCount = count('multiAgentNodeStreamEvent')
  const handoffCount = count('multiAgentHandoffEvent')
  const interruptCount = count('multiAgentNodeInterruptEvent')
  const cancelCount = count('multiAgentNodeCancelEvent')
  const resultCount = count('multiAgentResultEvent')
  const errorCount = count('error')

  const touchedNodes = new Set<string>()
  for (const metric of nodeMetrics) {
    if (metric.nodeId) touchedNodes.add(metric.nodeId)
  }
  for (const event of events) {
    if (event.nodeId) touchedNodes.add(event.nodeId)
  }

  const nodeEventCounts = new Map<string, number>()
  for (const event of events) {
    if (!event.nodeId) continue
    nodeEventCounts.set(event.nodeId, (nodeEventCounts.get(event.nodeId) ?? 0) + 1)
  }
  const topNodes = [...nodeEventCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, compact ? 3 : 5)

  const tokenTotal =
    run.totalTokens ??
    ((run.inputTokens != null || run.outputTokens != null)
      ? (run.inputTokens ?? 0) + (run.outputTokens ?? 0)
      : undefined)
  const tokenPct =
    tokenTotal != null && Number.isFinite(tokenTotal)
      ? Math.max(0, Math.min(100, (tokenTotal / MAX_TOKEN_BUDGET) * 100))
      : undefined

  const issues: string[] = []
  const normalizedStatus = run.status.toLowerCase()
  if (normalizedStatus === 'running') {
    issues.push('Run is still marked running. If output is done, this indicates persistence finalization failed.')
  }
  if (startCount > 0 && stopCount === 0 && normalizedStatus !== 'running') {
    issues.push('Nodes started but no stop events were captured; stream may have ended prematurely.')
  }
  if (startCount > stopCount + interruptCount + cancelCount + 1 && normalizedStatus !== 'running') {
    issues.push('Node lifecycle events are imbalanced (more starts than stops).')
  }
  if (resultCount === 0 && normalizedStatus === 'completed') {
    issues.push('Run marked completed but no final result event was captured.')
  }
  if (errorCount > 0) {
    issues.push(`Captured ${errorCount} error event${errorCount === 1 ? '' : 's'} in this run trace.`)
  }
  if (tokenTotal != null && tokenTotal >= MAX_TOKEN_BUDGET * 0.8) {
    issues.push(`Token usage is high (${formatNumber(tokenTotal)} of ${formatNumber(MAX_TOKEN_BUDGET)} cap).`)
  }
  if (normalizedStatus === 'completed' && handoffCount >= 18) {
    issues.push('High handoff volume detected; orchestration may be over-iterating.')
  }

  return (
    <section className={`history-block execution-summary ${compact ? 'compact' : ''}`}>
      <div className="execution-summary-head">
        <h3>Execution Summary</h3>
        <span className={`execution-summary-status ${toStatusClass(run.status)}`}>
          {run.status.toUpperCase()}
        </span>
      </div>

      <div className="execution-summary-grid">
        <div className="execution-summary-card">
          <span>Agents Active</span>
          <strong>{formatNumber(touchedNodes.size)}</strong>
        </div>
        <div className="execution-summary-card">
          <span>Events Captured</span>
          <strong>{formatNumber(events.length)}</strong>
        </div>
        <div className="execution-summary-card">
          <span>Duration</span>
          <strong>{formatDuration(run.executionTimeMs)}</strong>
        </div>
        <div className="execution-summary-card">
          <span>Cost</span>
          <strong>{formatCost(run.estimatedCostUsd)}</strong>
        </div>
      </div>

      <div className="execution-summary-flow">
        <span>Start {formatNumber(startCount)}</span>
        <span>Stop {formatNumber(stopCount)}</span>
        <span>Stream {formatNumber(streamCount)}</span>
        <span>Handoff {formatNumber(handoffCount)}</span>
        <span>Interrupt {formatNumber(interruptCount)}</span>
        <span>Cancel {formatNumber(cancelCount)}</span>
        <span>Result {formatNumber(resultCount)}</span>
      </div>

      <div className="execution-summary-budget">
        <span>Token Cap</span>
        <strong>
          {formatNumber(tokenTotal)} / {formatNumber(MAX_TOKEN_BUDGET)}
          {tokenPct != null ? ` (${tokenPct.toFixed(1)}%)` : ''}
        </strong>
      </div>

      {topNodes.length > 0 && (
        <div className="execution-summary-topnodes">
          <span>Most Active Agents</span>
          <div>
            {topNodes.map(([nodeId, nodeCount]) => (
              <code key={nodeId}>
                {nodeId} ({formatNumber(nodeCount)})
              </code>
            ))}
          </div>
        </div>
      )}

      <div className="execution-summary-checks">
        <h4>Checks</h4>
        {issues.length === 0 ? (
          <div className="execution-summary-ok">No structural issues detected in this run trace.</div>
        ) : (
          <ul>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
