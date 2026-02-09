import { useQuery } from '@tanstack/react-query'
import React, { useCallback, useState } from 'react'
import { fetchRunDetail } from '../api/api'
import type { TelemetryEntry } from '../lib/types'

interface LogsPanelProps {
  entries?: TelemetryEntry[]
  runId?: string
  title?: string
  emptyMessage?: string
  onRefresh?: () => void | Promise<unknown>
  showRefresh?: boolean
  compact?: boolean
}

function telemetryStatusLabel(code: number | undefined): string {
  if (code === undefined) return '—'
  if (code === 0) return 'unset'
  if (code === 1) return 'ok'
  if (code === 2) return 'error'
  return `code ${code}`
}

function telemetrySummary(e: TelemetryEntry): string {
  const parts: string[] = []
  if (e.statusMessage) parts.push(e.statusMessage)
  const exceptionEvent = (e.events ?? []).find((ev) => ev.name === 'exception')
  const msg = exceptionEvent?.attributes?.['exception.message']
  if (msg && String(msg) !== e.statusMessage) parts.push(String(msg))
  if (parts.length === 0) return '—'
  return parts.join(' | ')
}

function sortTelemetryEntries(entries: TelemetryEntry[]): TelemetryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime - b.startTime
    if (a.durationMs !== b.durationMs) return b.durationMs - a.durationMs
    if (a.endTime !== b.endTime) return b.endTime - a.endTime
    return a.name.localeCompare(b.name)
  })
}

function truncateText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…`
}

function parseJsonLikeString(value: string): unknown | null {
  const trimmed = value.trim()
  if (trimmed.length < 2) return null
  if (
    !(
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    )
  ) {
    return null
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function summarizeJson(value: unknown): string {
  if (Array.isArray(value)) return `json array(${value.length})`
  if (value != null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    const preview = keys.slice(0, 3).join(', ')
    return keys.length > 3 ? `json object(${preview}, +${keys.length - 3})` : `json object(${preview || 'empty'})`
  }
  return 'json value'
}

function summarizeValue(value: unknown, maxChars = 40): string {
  if (value == null) return 'null'
  if (typeof value === 'string') {
    const parsed = parseJsonLikeString(value)
    if (parsed != null) return summarizeJson(parsed)
    return truncateText(value.replace(/\s+/g, ' '), maxChars)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return summarizeJson(value)
}

function summarizeAttributes(attributes: Record<string, unknown>): string {
  const entries = Object.entries(attributes)
  if (entries.length === 0) return '—'
  const parts = entries.slice(0, 2).map(([key, value]) => `${key}=${summarizeValue(value, 28)}`)
  if (entries.length > 2) parts.push(`+${entries.length - 2} more`)
  return parts.join(' · ')
}

function ValueCell({ value }: { value: unknown }): JSX.Element {
  if (value == null) return <code>null</code>
  if (typeof value === 'string') {
    const parsed = parseJsonLikeString(value)
    if (parsed != null) {
      return (
        <details className="logs-json-value">
          <summary>
            <code>{summarizeJson(parsed)}</code>
          </summary>
          <pre>{JSON.stringify(parsed, null, 2)}</pre>
        </details>
      )
    }
    if (value.length > 220) {
      return (
        <details className="logs-json-value">
          <summary>
            <code>{truncateText(value.replace(/\s+/g, ' '), 200)}</code>
          </summary>
          <pre>{value}</pre>
        </details>
      )
    }
    return <code>{value}</code>
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <code>{String(value)}</code>
  }
  return (
    <details className="logs-json-value">
      <summary>
        <code>{summarizeJson(value)}</code>
      </summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  )
}

function AttributesList({ attributes }: { attributes: Record<string, unknown> }): JSX.Element {
  const entries = Object.entries(attributes)
  if (entries.length === 0) return <p className="logs-empty-note">No attributes.</p>

  return (
    <div className="logs-kv-list">
      {entries.map(([key, value]) => (
        <div className="logs-kv-row" key={key}>
          <span className="logs-kv-key">{key}</span>
          <div className="logs-kv-value">
            <ValueCell value={value} />
          </div>
        </div>
      ))}
    </div>
  )
}

function EventsList({ events }: { events: TelemetryEntry['events'] }): JSX.Element {
  if (!events || events.length === 0) return <p className="logs-empty-note">No events.</p>
  return (
    <div className="logs-events-list">
      {events.map((event, idx) => (
        <details className="logs-event-card" key={`${event.name}-${event.timeMs}-${idx}`} open={idx === 0}>
          <summary>
            <span className="logs-event-name">{event.name}</span>
            <span className="logs-event-time">{event.timeMs.toFixed(2)} ms</span>
          </summary>
          <AttributesList attributes={event.attributes ?? {}} />
        </details>
      ))}
    </div>
  )
}

export default function LogsPanel({
  entries: providedEntries,
  runId,
  title = 'OpenTelemetry',
  emptyMessage,
  onRefresh,
  showRefresh = true,
  compact = false,
}: LogsPanelProps): JSX.Element {
  const [logsFilter, setLogsFilter] = useState<'all' | 'errors'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copyLabel, setCopyLabel] = useState('Copy')
  const resolvedRunId = runId?.trim()
  const isRunScopeMode = providedEntries == null && resolvedRunId != null && resolvedRunId !== ''

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['run-detail', resolvedRunId],
    queryFn: () => fetchRunDetail(resolvedRunId ?? ''),
    retry: false,
    enabled: isRunScopeMode,
  })

  const entries = sortTelemetryEntries(providedEntries ?? data?.telemetry ?? [])
  const filtered =
    logsFilter === 'errors' ? entries.filter((e) => e.statusCode === 2) : entries

  const handleCopy = useCallback(async () => {
    if (filtered.length === 0) return
    const text = JSON.stringify(filtered, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setCopyLabel('Copied')
      setTimeout(() => setCopyLabel('Copy'), 1500)
    } catch {
      setCopyLabel('Copy failed')
      setTimeout(() => setCopyLabel('Copy'), 1500)
    }
  }, [filtered])

  async function handleRefresh(): Promise<void> {
    if (onRefresh != null) {
      await onRefresh()
      return
    }
    if (isRunScopeMode) await refetch()
  }

  function toggleExpand(id: string): void {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const rootClassName = compact ? 'logs-panel logs-panel-compact' : 'panel-section logs-panel'
  const resolvedEmptyMessage =
    emptyMessage ??
    (providedEntries != null
      ? 'No persisted telemetry logs for this run.'
      : isRunScopeMode
      ? 'No telemetry logs were recorded for this run.'
      : 'Run logs appear here after a run completes.')
  const canRefresh = showRefresh && (isRunScopeMode || onRefresh != null)

  if (isRunScopeMode && isLoading) {
    return (
      <div className={rootClassName}>
        <div className="logs-header">
          <h2 className="panel-heading">{title}</h2>
        </div>
        <div className="logs-list">Loading…</div>
      </div>
    )
  }

  if (isRunScopeMode && isError) {
    return (
      <div className={rootClassName}>
        <div className="logs-header">
          <h2 className="panel-heading">{title}</h2>
        </div>
        <div className="logs-list">
          {error instanceof Error ? error.message : 'Failed to load telemetry'}
        </div>
      </div>
    )
  }

  return (
    <div className={rootClassName}>
      <div className="logs-header">
        <h2 className="panel-heading">{title}</h2>
        <div className="logs-actions">
          <select
            className="logs-filter"
            aria-label="Filter by status"
            value={logsFilter}
            onChange={(e) => setLogsFilter(e.target.value === 'errors' ? 'errors' : 'all')}
          >
            <option value="all">All</option>
            <option value="errors">Errors only</option>
          </select>
          <button type="button" className="secondary-btn" onClick={handleCopy}>
            {copyLabel}
          </button>
          {canRefresh && (
            <button type="button" className="secondary-btn" onClick={() => void handleRefresh()}>
              Refresh
            </button>
          )}
        </div>
      </div>
      <div className="logs-list">
        {filtered.length === 0 ? (
          entries.length === 0 ? resolvedEmptyMessage : 'No spans match the filter.'
        ) : (
          <table className="logs-table">
            <thead>
              <tr>
                <th className="logs-col-toggle" />
                <th>Span</th>
                <th>Status</th>
                <th>Start (ms)</th>
                <th>Duration (ms)</th>
                <th>Details</th>
                <th>Attributes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, idx) => {
                const rowId = `${e.name}-${e.startTime}-${idx}`
                const isExpanded = expandedId === rowId
                const status = telemetryStatusLabel(e.statusCode)
                const details = telemetrySummary(e)
                const attrs = summarizeAttributes(e.attributes ?? {})
                return (
                  <React.Fragment key={rowId}>
                    <tr
                      className={`logs-main-row ${e.statusCode === 2 ? 'logs-row-error' : ''}`}
                      onClick={() => toggleExpand(rowId)}
                    >
                      <td className="logs-col-toggle">
                        <button
                          type="button"
                          className="logs-expand-btn"
                          aria-expanded={isExpanded}
                          aria-label="Expand details"
                          onClick={(ev) => {
                            ev.stopPropagation()
                            toggleExpand(rowId)
                          }}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </td>
                      <td>{e.name}</td>
                      <td>{status}</td>
                      <td>{e.startTime.toFixed(2)}</td>
                      <td>{e.durationMs.toFixed(2)}</td>
                      <td className="logs-details">{details}</td>
                      <td className="logs-attrs-preview">
                        <code>{attrs}</code>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="logs-detail-row">
                        <td colSpan={7}>
                          <div className="logs-expanded">
                            <section className="logs-expanded-section">
                              <h4>Attributes</h4>
                              <AttributesList attributes={e.attributes ?? {}} />
                            </section>
                            <section className="logs-expanded-section">
                              <h4>Events</h4>
                              <EventsList events={e.events ?? []} />
                            </section>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
