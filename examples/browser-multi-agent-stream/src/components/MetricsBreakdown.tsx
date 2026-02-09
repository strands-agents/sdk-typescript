import { computeCost, hasPricing } from '../lib/pricing'

export interface MetricsBreakdownModelEntry {
  modelId: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number | null
}

export interface MetricsBreakdownNodeEntry {
  nodeId: string
  modelId?: string
  status: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number | null
  executionTime?: number
}

export interface MetricsBreakdownData {
  modelId?: string
  estimatedCostUsd?: number | null
  executionTime?: number
  perModelUsage?: MetricsBreakdownModelEntry[]
  perNode?: MetricsBreakdownNodeEntry[]
  nodeHistory?: string[]
  executionOrder?: string[]
}

function formatCostUsd(costUsd: number | null | undefined): string {
  if (costUsd == null || !Number.isFinite(costUsd)) return '—'
  return `$${costUsd.toFixed(4)}`
}

function formatTokenCount(count: number | undefined): string {
  if (count == null) return '—'
  return count.toLocaleString()
}

function parseCostStr(cost: string): number | null {
  if (!cost.startsWith('$')) return null
  const value = parseFloat(cost.slice(1))
  return Number.isFinite(value) ? value : null
}

export default function MetricsBreakdown({ data }: { data: MetricsBreakdownData }): JSX.Element {
  const hasPerModel = data.perModelUsage != null && data.perModelUsage.length > 0
  const hasPerNode = data.perNode != null && data.perNode.length > 0

  return (
    <div className="metrics">
      {data.modelId && (
        <div className="metrics-model">
          {hasPricing(data.modelId)
            ? `Model: ${data.modelId}`
            : `Model: ${data.modelId} (pricing unknown)`}
        </div>
      )}

      {data.estimatedCostUsd != null && (
        <div className="metrics-total-cost">
          Estimated run cost: {formatCostUsd(data.estimatedCostUsd)}
          {data.executionTime != null && ` · ${data.executionTime.toLocaleString()}ms`}
        </div>
      )}

      {hasPerModel && <ModelUsageTable entries={data.perModelUsage!} />}

      {hasPerNode && (
        <NodeBreakdownTable
          perNode={data.perNode!}
          modelId={data.modelId}
          nodeHistory={data.nodeHistory}
          executionOrder={data.executionOrder}
        />
      )}

      {!hasPerModel && !hasPerNode && data.estimatedCostUsd == null && (
        <div>No detailed metrics available.</div>
      )}
    </div>
  )
}

function ModelUsageTable({ entries }: { entries: MetricsBreakdownModelEntry[] }): JSX.Element {
  let grandTotalIn = 0
  let grandTotalOut = 0
  let grandTotalTokens = 0
  let grandTotalCost = 0
  let hasCost = false

  const rows = entries.map((entry) => {
    const inTokens = entry.inputTokens ?? 0
    const outTokens = entry.outputTokens ?? 0
    const total = entry.totalTokens ?? inTokens + outTokens
    grandTotalIn += inTokens
    grandTotalOut += outTokens
    grandTotalTokens += total

    let costStr: string
    if (entry.costUsd != null) {
      costStr = formatCostUsd(entry.costUsd)
      grandTotalCost += entry.costUsd
      hasCost = true
    } else if (entry.inputTokens != null || entry.outputTokens != null) {
      costStr = computeCost(inTokens, outTokens, entry.modelId)
      const parsed = parseCostStr(costStr)
      if (parsed != null) {
        grandTotalCost += parsed
        hasCost = true
      }
    } else {
      costStr = '—'
    }

    return (
      <tr key={entry.modelId}>
        <td>{entry.modelId}</td>
        <td>{formatTokenCount(entry.inputTokens)}</td>
        <td>{formatTokenCount(entry.outputTokens)}</td>
        <td>{formatTokenCount(total > 0 ? total : undefined)}</td>
        <td>{costStr}</td>
      </tr>
    )
  })

  return (
    <table>
      <thead>
        <tr>
          <th>Model</th>
          <th>Input</th>
          <th>Output</th>
          <th>Total</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows}
        {entries.length > 1 && (
          <tr className="totals-row">
            <td>Total</td>
            <td>{formatTokenCount(grandTotalIn)}</td>
            <td>{formatTokenCount(grandTotalOut)}</td>
            <td>{formatTokenCount(grandTotalTokens)}</td>
            <td>{hasCost ? formatCostUsd(grandTotalCost) : '—'}</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function NodeBreakdownTable({
  perNode,
  modelId,
  nodeHistory,
  executionOrder,
}: {
  perNode: MetricsBreakdownNodeEntry[]
  modelId: string | undefined
  nodeHistory: string[] | undefined
  executionOrder: string[] | undefined
}): JSX.Element {
  let totalIn = 0
  let totalOut = 0

  const rows = perNode.map((row) => {
    totalIn += row.inputTokens ?? 0
    totalOut += row.outputTokens ?? 0
    const rowModelId = row.modelId ?? modelId
    const cost =
      row.costUsd != null
        ? formatCostUsd(row.costUsd)
        : row.inputTokens == null && row.outputTokens == null
        ? '—'
        : computeCost(row.inputTokens ?? 0, row.outputTokens ?? 0, rowModelId)
    return (
      <tr key={row.nodeId}>
        <td>{row.nodeId}</td>
        <td>{row.modelId ?? '—'}</td>
        <td>{row.status}</td>
        <td>{formatTokenCount(row.inputTokens)}</td>
        <td>{formatTokenCount(row.outputTokens)}</td>
        <td>{cost}</td>
        <td>{row.executionTime != null ? row.executionTime.toLocaleString() : '—'}</td>
      </tr>
    )
  })

  const totalCost =
    totalIn > 0 || totalOut > 0
      ? computeCost(totalIn, totalOut, modelId)
      : '—'

  return (
    <>
      {perNode.length > 1 && <div className="metrics-section-label">Per-node breakdown</div>}
      <table>
        <thead>
          <tr>
            <th>Node</th>
            <th>Model</th>
            <th>Status</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cost</th>
            <th>Time (ms)</th>
          </tr>
        </thead>
        <tbody>
          {rows}
          {perNode.length > 1 && (
            <tr className="totals-row">
              <td>Total</td>
              <td>—</td>
              <td>—</td>
              <td>{formatTokenCount(totalIn)}</td>
              <td>{formatTokenCount(totalOut)}</td>
              <td>{totalCost}</td>
              <td>—</td>
            </tr>
          )}
          {nodeHistory?.length ? (
            <tr>
              <td colSpan={7}>Order: {nodeHistory.join(' → ')}</td>
            </tr>
          ) : null}
          {executionOrder?.length ? (
            <tr>
              <td colSpan={7}>Order: {executionOrder.join(' → ')}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  )
}
