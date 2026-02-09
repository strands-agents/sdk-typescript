export type RunRiskLevel = 'ok' | 'warn' | 'error'

export interface RunSummarySnapshot {
  riskLevel: RunRiskLevel
  hasAnomaly: boolean
  anomalyCount: number
  issueCodes: string[]
  issueMessages: string[]
  eventCount: number
  nodeCount: number
  handoffCount: number
  streamCount: number
  errorEventCount: number
  startCount: number
  stopCount: number
  resultCount: number
  interruptCount: number
  cancelCount: number
  totalTokens?: number
  tokenBudgetPct?: number
  topNodes: Array<{ nodeId: string; count: number }>
}

interface SummaryEventLike {
  eventType: string
  nodeId: string | null
}

interface SummaryNodeMetricLike {
  nodeId: string
}

function countByType(events: SummaryEventLike[], type: string): number {
  let total = 0
  for (const event of events) {
    if (event.eventType === type) total += 1
  }
  return total
}

const MAX_RUN_TOTAL_TOKENS = 100_000

export function buildRunSummarySnapshot(input: {
  status?: string | null
  errorMessage?: string | null
  events: SummaryEventLike[]
  nodeMetrics: SummaryNodeMetricLike[]
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}): RunSummarySnapshot {
  const normalizedStatus = (input.status ?? 'unknown').toLowerCase()
  const startCount = countByType(input.events, 'multiAgentNodeStartEvent')
  const stopCount = countByType(input.events, 'multiAgentNodeStopEvent')
  const streamCount = countByType(input.events, 'multiAgentNodeStreamEvent')
  const handoffCount = countByType(input.events, 'multiAgentHandoffEvent')
  const interruptCount = countByType(input.events, 'multiAgentNodeInterruptEvent')
  const cancelCount = countByType(input.events, 'multiAgentNodeCancelEvent')
  const resultCount = countByType(input.events, 'multiAgentResultEvent')
  const errorEventCount = countByType(input.events, 'error')

  const touchedNodes = new Set<string>()
  const nodeEventCounts = new Map<string, number>()
  for (const metric of input.nodeMetrics) {
    if (metric.nodeId.trim() !== '') touchedNodes.add(metric.nodeId)
  }
  for (const event of input.events) {
    if (!event.nodeId || event.nodeId.trim() === '') continue
    touchedNodes.add(event.nodeId)
    nodeEventCounts.set(event.nodeId, (nodeEventCounts.get(event.nodeId) ?? 0) + 1)
  }
  const topNodes = [...nodeEventCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nodeId, count]) => ({ nodeId, count }))

  const totalTokens =
    input.totalTokens ??
    ((input.inputTokens != null || input.outputTokens != null)
      ? (input.inputTokens ?? 0) + (input.outputTokens ?? 0)
      : undefined)
  const tokenBudgetPct =
    totalTokens != null && Number.isFinite(totalTokens)
      ? Math.max(0, Math.min(100, (totalTokens / MAX_RUN_TOTAL_TOKENS) * 100))
      : undefined

  const issueCodes: string[] = []
  const issueMessages: string[] = []
  const addIssue = (code: string, message: string): void => {
    if (!issueCodes.includes(code)) {
      issueCodes.push(code)
      issueMessages.push(message)
    }
  }

  if (normalizedStatus === 'running') {
    addIssue('RUN_STILL_RUNNING', 'Run is still marked running.')
  }
  if (normalizedStatus === 'interrupted') {
    addIssue('RUN_INTERRUPTED', 'Run ended in interrupted status.')
  }
  if (normalizedStatus === 'failed' || normalizedStatus === 'error') {
    addIssue('RUN_FAILED', 'Run ended in failed status.')
  }
  if (startCount > 0 && stopCount === 0 && normalizedStatus !== 'running') {
    addIssue('MISSING_NODE_STOPS', 'Nodes started but no stop events were captured.')
  }
  if (startCount > stopCount + interruptCount + cancelCount + 1 && normalizedStatus !== 'running') {
    addIssue('NODE_LIFECYCLE_IMBALANCE', 'Node lifecycle events are imbalanced.')
  }
  if (resultCount === 0 && normalizedStatus === 'completed') {
    addIssue('MISSING_RESULT_EVENT', 'Run is completed but no result event was captured.')
  }
  if (errorEventCount > 0) {
    addIssue('ERROR_EVENTS_PRESENT', `Captured ${errorEventCount} error event(s).`)
  }
  if (input.errorMessage != null && input.errorMessage.trim() !== '') {
    addIssue('ERROR_MESSAGE_RECORDED', 'Run has a recorded error message.')
  }
  if (totalTokens != null && totalTokens >= MAX_RUN_TOTAL_TOKENS * 0.8) {
    addIssue('HIGH_TOKEN_USAGE', 'Token usage is near budget limit.')
  }
  if (normalizedStatus === 'completed' && handoffCount >= 18) {
    addIssue('EXCESSIVE_HANDOFFS', 'High handoff volume detected; orchestration may be looping.')
  }

  let riskLevel: RunRiskLevel = 'ok'
  if (
    issueCodes.includes('RUN_FAILED') ||
    issueCodes.includes('MISSING_RESULT_EVENT') ||
    issueCodes.includes('ERROR_EVENTS_PRESENT') ||
    issueCodes.includes('ERROR_MESSAGE_RECORDED')
  ) {
    riskLevel = 'error'
  } else if (issueCodes.length > 0) {
    riskLevel = 'warn'
  }

  return {
    riskLevel,
    hasAnomaly: issueCodes.length > 0,
    anomalyCount: issueCodes.length,
    issueCodes,
    issueMessages,
    eventCount: input.events.length,
    nodeCount: touchedNodes.size,
    handoffCount,
    streamCount,
    errorEventCount,
    startCount,
    stopCount,
    resultCount,
    interruptCount,
    cancelCount,
    totalTokens,
    tokenBudgetPct,
    topNodes,
  }
}
