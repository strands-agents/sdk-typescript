import { useQuery } from '@tanstack/react-query'
import { fetchRunHistory } from '../api/api'

interface RunSidebarProps {
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  onNewRun: () => void
}

const LIMIT = 120

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatCost(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `$${value.toFixed(4)}`
}

export default function RunSidebar({
  selectedRunId,
  onSelectRun,
  onNewRun,
}: RunSidebarProps): JSX.Element {
  const historyQuery = useQuery({
    queryKey: ['run-history', LIMIT, 0],
    queryFn: () => fetchRunHistory(LIMIT, 0),
    refetchInterval: 15000,
  })

  const runs = historyQuery.data?.runs ?? []

  return (
    <aside className="run-nav">
      <div className="run-nav-header">
        <h2>Runs</h2>
        <button
          type="button"
          className={`run-nav-new ${selectedRunId == null ? 'active' : ''}`}
          onClick={onNewRun}
        >
          + New Run
        </button>
      </div>
      <div className="run-nav-body">
        {historyQuery.isLoading ? (
          <div className="run-nav-empty">Loading runs…</div>
        ) : historyQuery.isError ? (
          <div className="run-nav-empty">
            {historyQuery.error instanceof Error
              ? historyQuery.error.message
              : 'Failed to load runs'}
          </div>
        ) : runs.length === 0 ? (
          <div className="run-nav-empty">No persisted runs yet.</div>
        ) : (
          runs.map((run) => (
            <button
              key={run.runId}
              type="button"
              className={`run-nav-item ${
                selectedRunId === run.runId ? 'active' : ''
              }`}
              onClick={() => onSelectRun(run.runId)}
            >
              <div className="run-nav-item-top">
                <span className={`status-dot status-${run.status}`} />
                <span className="run-nav-time">{formatDate(run.createdAt)}</span>
                <span className="run-nav-mode">{run.mode}</span>
              </div>
              <div className="run-nav-prompt">{run.prompt}</div>
              <div className="run-nav-meta">
                <span>{run.totalTokens?.toLocaleString() ?? '—'} tokens</span>
                <span>{formatCost(run.estimatedCostUsd)}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
