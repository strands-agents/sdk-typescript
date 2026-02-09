import { Box, Tabs } from '@radix-ui/themes'
import { useQuery } from '@tanstack/react-query'
import { fetchRunDetail } from '../api/api'
import ExecutionSummaryPanel from './ExecutionSummaryPanel'
import JudgeTracePanel from './JudgeTracePanel'
import LogsPanel from './LogsPanel'
import MarkdownRenderer from './MarkdownRenderer'
import MetricsBreakdown, { type MetricsBreakdownData } from './MetricsBreakdown'
import { parseJudgeTraceData } from '../lib/judgeTrace'

interface RunRecordViewProps {
  runId: string
}

function formatDate(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString()
}

function formatNumber(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString()
}

function formatCost(cost: number | undefined): string {
  if (cost == null || !Number.isFinite(cost)) return '—'
  return `$${cost.toFixed(4)}`
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function buildMetricsBreakdownData(
  detail: { run: { modelId?: string; estimatedCostUsd?: number; executionTimeMs?: number }; nodeMetrics: Array<{ nodeId: string; status: string; inputTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number; executionTimeMs?: number }> },
  responseJson: Record<string, unknown> | null
): MetricsBreakdownData {
  const perModelUsageRaw = Array.isArray(responseJson?.perModelUsage) ? responseJson.perModelUsage : []
  const perModelUsage = perModelUsageRaw
    .map((entry) => {
      const row = asRecord(entry)
      if (!row) return null
      if (typeof row.modelId !== 'string' || row.modelId.trim() === '') return null
      return {
        modelId: row.modelId,
        inputTokens: asNumber(row.inputTokens),
        outputTokens: asNumber(row.outputTokens),
        totalTokens: asNumber(row.totalTokens),
        costUsd: asNumber(row.costUsd),
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null)

  const perNodeRaw = Array.isArray(responseJson?.perNode) ? responseJson.perNode : []
  const perNode = perNodeRaw
    .map((entry) => {
      const row = asRecord(entry)
      if (!row) return null
      const nodeId = asString(row.nodeId)
      if (!nodeId) return null
      return {
        nodeId,
        modelId: asString(row.modelId),
        status: asString(row.status) ?? 'unknown',
        inputTokens: asNumber(row.inputTokens),
        outputTokens: asNumber(row.outputTokens),
        totalTokens: asNumber(row.totalTokens),
        costUsd: asNumber(row.costUsd),
        executionTime: asNumber(row.executionTime),
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null)

  const nodeHistoryRaw = Array.isArray(responseJson?.nodeHistory) ? responseJson.nodeHistory : undefined
  const executionOrderRaw = Array.isArray(responseJson?.executionOrder) ? responseJson.executionOrder : undefined

  return {
    modelId: detail.run.modelId,
    estimatedCostUsd: detail.run.estimatedCostUsd,
    executionTime: detail.run.executionTimeMs,
    perModelUsage: perModelUsage.length > 0 ? perModelUsage : undefined,
    perNode: perNode.length > 0
      ? perNode
      : detail.nodeMetrics.length > 0
      ? detail.nodeMetrics.map((m) => ({
          nodeId: m.nodeId,
          status: m.status,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          totalTokens: m.totalTokens,
          costUsd: m.costUsd,
          executionTime: m.executionTimeMs,
        }))
      : undefined,
    nodeHistory: nodeHistoryRaw?.map((v) => String(v)).filter(Boolean),
    executionOrder: executionOrderRaw?.map((v) => String(v)).filter(Boolean),
  }
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export default function RunRecordView({
  runId,
}: RunRecordViewProps): JSX.Element {
  const detailQuery = useQuery({
    queryKey: ['run-detail', runId],
    queryFn: () => fetchRunDetail(runId),
  })

  if (detailQuery.isLoading) {
    return <div className="run-record-empty">Loading run details…</div>
  }

  if (detailQuery.isError) {
    return (
      <div className="run-record-empty">
        {detailQuery.error instanceof Error
          ? detailQuery.error.message
          : 'Failed to load run details'}
      </div>
    )
  }

  if (!detailQuery.data) {
    return <div className="run-record-empty">Run details unavailable.</div>
  }

  const detail = detailQuery.data
  const responseJson = asRecord(detail.run.responseJson)
  const requestJson = asRecord(detail.run.requestJson)
  const structuredOutput = responseJson?.structuredOutput
  const requestedSchema =
    typeof requestJson?.structuredOutputSchema === 'string' ? requestJson.structuredOutputSchema : undefined
  const judgeTrace =
    requestedSchema === 'agent_review_verdict_v1' ? parseJudgeTraceData(structuredOutput) : null

  return (
    <div className="run-record">
      <div className="run-record-header">
        <h2>Run Detail</h2>
        <div className="run-record-chips">
          <span>{detail.run.mode}</span>
          <span>{detail.run.status}</span>
          <span>{formatDate(detail.run.createdAt)}</span>
          <span>{formatNumber(detail.run.totalTokens)} tokens</span>
          <span>{formatCost(detail.run.estimatedCostUsd)}</span>
        </div>
      </div>

      <Tabs.Root defaultValue="overview" className="run-record-tabs">
        <Tabs.List>
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="metrics">Metrics</Tabs.Trigger>
          <Tabs.Trigger value="telemetry">Logs</Tabs.Trigger>
          <Tabs.Trigger value="config">Config</Tabs.Trigger>
        </Tabs.List>
        <Box pt="3" className="run-record-tab-panels">
          <Tabs.Content value="overview" className="run-record-tab">
            <ExecutionSummaryPanel run={detail.run} events={detail.events} nodeMetrics={detail.nodeMetrics} compact />

            <section className="run-record-block">
              <h3>Prompt</h3>
              <pre>{detail.run.prompt}</pre>
            </section>

            <section className="run-record-block">
              <h3>Result</h3>
              <MarkdownRenderer
                text={detail.run.resultText ?? detail.run.errorMessage ?? '—'}
                className="markdown-result"
              />
            </section>

            {judgeTrace && (
              <section className="run-record-block">
                <h3>Judge Trace</h3>
                <JudgeTracePanel trace={judgeTrace} />
              </section>
            )}
          </Tabs.Content>

          <Tabs.Content value="metrics" className="run-record-tab">
            <MetricsBreakdown data={buildMetricsBreakdownData(detail, responseJson)} />
          </Tabs.Content>

          <Tabs.Content value="telemetry" className="run-record-tab">
            <LogsPanel
              entries={detail.telemetry}
              title={`OpenTelemetry (${detail.telemetry.length})`}
              emptyMessage="No persisted telemetry logs for this run."
              onRefresh={() => detailQuery.refetch()}
            />
          </Tabs.Content>

          <Tabs.Content value="config" className="run-record-tab">
            <section className="run-record-block">
              <h3>Agents</h3>
              <ul>
                {detail.agents.map((agent) => (
                  <li key={`${agent.position}-${agent.name}`}>
                    {agent.name}
                    {agent.isEntryPoint ? ' (entry)' : ''} — tools:{' '}
                    {agent.tools.length > 0 ? agent.tools.join(', ') : 'all'}
                  </li>
                ))}
              </ul>
            </section>

            <section className="run-record-block">
              <h3>Request</h3>
              <pre>{json(detail.run.requestJson ?? null)}</pre>
            </section>

            <section className="run-record-block">
              <h3>Response</h3>
              <pre>{json(detail.run.responseJson ?? null)}</pre>
            </section>
          </Tabs.Content>
        </Box>
      </Tabs.Root>
    </div>
  )
}
