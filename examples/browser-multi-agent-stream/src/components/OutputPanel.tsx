import { useEffect, useMemo, useState } from 'react'
import { useRunStore } from '../store/runStore'
import { computeCost } from '../lib/pricing'
import { STREAM_AGENT_COLORS } from '../lib/constants'
import JudgeTracePanel from './JudgeTracePanel'
import MarkdownRenderer from './MarkdownRenderer'
import { parseJudgeTraceData } from '../lib/judgeTrace'

function getAgentColorIndex(runAgentNames: string[], nodeId: string): number {
  const i = runAgentNames.indexOf(nodeId)
  return i >= 0 ? i % STREAM_AGENT_COLORS : 0
}

function formatMetricsLine(metrics: NonNullable<ReturnType<typeof useRunStore.getState>['metrics']>): string {
  const parts: string[] = []
  if (metrics.status != null) parts.push(`Status: ${metrics.status}`)
  if (metrics.usage || metrics.executionTime != null) {
    const totalCost =
      metrics.estimatedCostUsd != null
        ? `$${metrics.estimatedCostUsd.toFixed(4)}`
        : metrics.usage && metrics.modelId
        ? computeCost(metrics.usage.inputTokens ?? 0, metrics.usage.outputTokens ?? 0, metrics.modelId)
        : null
    const usageParts = [
      metrics.usage?.inputTokens != null && `in: ${metrics.usage.inputTokens}`,
      metrics.usage?.outputTokens != null && `out: ${metrics.usage.outputTokens}`,
      metrics.usage?.totalTokens != null && `total: ${metrics.usage.totalTokens}`,
      metrics.executionTime != null && `${metrics.executionTime} ms`,
      totalCost && `~${totalCost}`,
      metrics.perModelUsage != null &&
        metrics.perModelUsage.length > 1 &&
        `${metrics.perModelUsage.length} models`,
    ].filter(Boolean)
    if (usageParts.length) parts.push(usageParts.join(' · '))
  }
  return parts.join(' · ')
}

function stripStreamSegmentHeader(text: string): string {
  const withoutLeadingNewlines = text.replace(/^\n+/, '')
  if (/^--- \[[^\]]+\] ---\n/.test(withoutLeadingNewlines)) {
    return withoutLeadingNewlines.replace(/^--- \[[^\]]+\] ---\n/, '')
  }
  return withoutLeadingNewlines
}

function mergeTextWithOverlap(existingText: string, incomingText: string): string {
  if (incomingText.length === 0) return existingText
  if (existingText.length === 0) return incomingText
  if (existingText.endsWith(incomingText)) return existingText

  const maxOverlap = Math.min(existingText.length, incomingText.length, 512)
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (existingText.endsWith(incomingText.slice(0, overlap))) {
      return existingText + incomingText.slice(overlap)
    }
  }

  return existingText + incomingText
}

export default function OutputPanel(): JSX.Element {
  const runAgentNames = useRunStore((s) => s.runAgentNames)
  const currentNodeId = useRunStore((s) => s.currentNodeId)
  const completedNodeIds = useRunStore((s) => s.completedNodeIds)
  const failedNodeIds = useRunStore((s) => s.failedNodeIds)
  const streamSegments = useRunStore((s) => s.streamSegments)
  const resultText = useRunStore((s) => s.resultText)
  const resultError = useRunStore((s) => s.resultError)
  const metrics = useRunStore((s) => s.metrics)
  const requestedStructuredOutputSchema = useRunStore((s) => s.requestedStructuredOutputSchema)

  const completedSet = new Set(completedNodeIds)
  const failedSet = new Set(failedNodeIds)
  const metricsLine = metrics ? formatMetricsLine(metrics) : ''
  const judgeTrace =
    requestedStructuredOutputSchema === 'agent_review_verdict_v1'
      ? parseJudgeTraceData(metrics?.structuredOutput)
      : null
  const showJudgeTrace = judgeTrace != null && !resultError
  const [expandedSegmentIndices, setExpandedSegmentIndices] = useState<Set<number>>(() => new Set())

  const renderedSegments = useMemo(() => {
    const merged: Array<{ nodeId: string; cleanedText: string }> = []

    for (const segment of streamSegments) {
      const cleaned = stripStreamSegmentHeader(segment.text)
      if (cleaned.trim() === '') continue
      const normalizedNodeId = segment.nodeId.trim() === '' ? '__stream__' : segment.nodeId
      const previous = merged[merged.length - 1]
      if (previous != null && previous.nodeId === normalizedNodeId) {
        previous.cleanedText = mergeTextWithOverlap(previous.cleanedText, cleaned)
      } else {
        merged.push({ nodeId: normalizedNodeId, cleanedText: cleaned })
      }
    }

    const occurrenceByNodeId = new Map<string, number>()
    function ordinalSuffix(n: number): string {
      if (n % 10 === 1 && n % 100 !== 11) return `${n}st`
      if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`
      if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`
      return `${n}th`
    }
    return merged.map((segment, index) => {
      const nodeId = segment.nodeId
      const count = (occurrenceByNodeId.get(nodeId) ?? 0) + 1
      occurrenceByNodeId.set(nodeId, count)
      const ordinal = count === 1 ? '' : ` (${ordinalSuffix(count)})`
      const displayNodeId =
        nodeId === '__stream__'
          ? 'stream'
          : nodeId === '__swarm_nested__'
            ? 'swarm specialist'
            : nodeId + ordinal
      const colorNodeId = nodeId === '__stream__' ? '' : nodeId
      return {
        index,
        nodeId: segment.nodeId,
        displayNodeId,
        cleanedText: segment.cleanedText,
        colorIndex: getAgentColorIndex(runAgentNames, colorNodeId),
      }
    })
  }, [runAgentNames, streamSegments])

  useEffect(() => {
    if (renderedSegments.length === 0) {
      setExpandedSegmentIndices(new Set())
      return
    }
    setExpandedSegmentIndices((prev) => {
      const next = new Set<number>()
      for (const index of prev) {
        if (index >= 0 && index < renderedSegments.length) next.add(index)
      }
      next.add(renderedSegments.length - 1)
      return next
    })
  }, [renderedSegments.length])

  return (
    <div className="output-panel">
      <div className="agents-viz-section">
        <div className="agents-viz">
          {runAgentNames.map((name) => {
            const isActive = currentNodeId === name
            const completed = completedSet.has(name)
            const failed = failedSet.has(name)
            const state = failed ? 'failed' : completed ? 'completed' : isActive ? 'active' : 'idle'
            return (
              <div key={name} className={`agent-viz-card ${state}`} data-agent={name}>
                <span className="agent-viz-label">{name}</span>
                {isActive && !completed && !failed && (
                  <span className="agent-viz-thinking" aria-hidden="true">
                    <span /><span /><span />
                  </span>
                )}
                {completed && (
                  <span className="agent-viz-check" aria-hidden="true">✓</span>
                )}
                {failed && (
                  <span className="agent-viz-x" aria-hidden="true">✕</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      <div className="output-stream-wrap">
        {renderedSegments.length === 0 ? (
          <div className="stream empty">Waiting for streamed output…</div>
        ) : (
          <div className="stream-segments">
            {renderedSegments.map((segment) => {
              const isExpanded = expandedSegmentIndices.has(segment.index)
              const normalizedNodeId = segment.nodeId === '__stream__' ? '' : segment.nodeId
              const isActive = normalizedNodeId !== '' && currentNodeId === normalizedNodeId
              const isFailed = normalizedNodeId !== '' && failedSet.has(normalizedNodeId)
              const isCompleted = normalizedNodeId !== '' && completedSet.has(normalizedNodeId)
              const status = isFailed ? 'failed' : isActive ? 'active' : isCompleted ? 'completed' : 'idle'
              const title =
                segment.displayNodeId.trim() !== '' ? segment.displayNodeId : `agent_${segment.index + 1}`
              return (
                <article
                  key={`${segment.index}-${segment.displayNodeId}`}
                  className={`stream-card ${isExpanded ? 'open' : 'collapsed'} ${status}`}
                  data-agent-index={String(segment.colorIndex % STREAM_AGENT_COLORS)}
                >
                  <button
                    type="button"
                    className="stream-card-head"
                    onClick={() => {
                      setExpandedSegmentIndices((prev) => {
                        const next = new Set(prev)
                        if (next.has(segment.index)) next.delete(segment.index)
                        else next.add(segment.index)
                        return next
                      })
                    }}
                  >
                    <span className="stream-card-dot" />
                    <span className="stream-card-title">{title}</span>
                    <span className="stream-card-status">{status}</span>
                    <span className="stream-card-toggle">{isExpanded ? 'Hide' : 'Show'}</span>
                  </button>
                  {isExpanded && (
                    <div className="stream-card-body">
                      <MarkdownRenderer text={segment.cleanedText} className="markdown-stream" />
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>
      <div className="output-result-wrap">
        {metricsLine && (
          <div className="output-metrics" aria-label="Run metrics">
            {metricsLine}
          </div>
        )}
        <div className="output-result-scroll">
          {showJudgeTrace ? (
            <section className="judge-trace-live">
              <h3 className="panel-heading">Judge Trace</h3>
              <JudgeTracePanel trace={judgeTrace} />
              {resultText && (
                <details className="judge-raw-details">
                  <summary>Raw structured output</summary>
                  <pre>{resultText}</pre>
                </details>
              )}
            </section>
          ) : (
            <div className={`result ${resultText ? (resultError ? 'error' : '') : 'empty'}`}>
              {resultText ? (
                <MarkdownRenderer text={resultText} className="markdown-result" />
              ) : (
                'No result'
              )}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}
