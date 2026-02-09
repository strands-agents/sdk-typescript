import { useRunStore } from '../store/runStore'
import MetricsBreakdown from './MetricsBreakdown'

export default function MetricsPanel(): JSX.Element {
  const metrics = useRunStore((s) => s.metrics)
  const status = useRunStore((s) => s.status)

  if (status === 'running' && !metrics) {
    return (
      <div className="panel-section">
        <h2 className="panel-heading">Metrics</h2>
        <div className="metrics">Running…</div>
      </div>
    )
  }

  if (!metrics?.perModelUsage?.length && !metrics?.perNode?.length && !metrics?.usage && metrics?.executionTime == null) {
    return (
      <div className="panel-section">
        <h2 className="panel-heading">Metrics</h2>
        <div className="metrics">No metrics yet.</div>
      </div>
    )
  }

  return (
    <div className="panel-section">
      <h2 className="panel-heading">Metrics</h2>
      <MetricsBreakdown data={metrics} />
    </div>
  )
}
