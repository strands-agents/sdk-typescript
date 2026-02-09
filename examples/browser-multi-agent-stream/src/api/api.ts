import type { RunPayload } from '../lib/types'
import type { TelemetryEntry } from '../lib/types'
import type {
  HistoryStatsResponse,
  RunHistoryDetail,
  RunHistoryResponse,
} from '../lib/types'

export async function fetchRun(payload: RunPayload, signal?: AbortSignal): Promise<Response> {
  const res = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  return res
}

export async function fetchTelemetry(): Promise<{ entries: TelemetryEntry[] }> {
  const res = await fetch('/api/telemetry')
  if (!res.ok) {
    throw new Error(`Failed to load: ${res.status}`)
  }
  const text = await res.text()
  const contentType = res.headers.get('content-type') ?? ''
  if (text.trimStart().startsWith('<') || !contentType.includes('json')) {
    throw new Error(
      'Telemetry endpoint returned HTML instead of JSON. In dev, ensure both Vite and the server are running (e.g. npm run dev).'
    )
  }
  return JSON.parse(text) as { entries: TelemetryEntry[] }
}

export async function fetchRunHistory(
  limit = 50,
  offset = 0,
  options?: {
    anomaliesOnly?: boolean
    sort?: 'recent' | 'risk'
  }
): Promise<RunHistoryResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })
  if (options?.anomaliesOnly) params.set('anomaliesOnly', '1')
  if (options?.sort === 'risk') params.set('sort', 'risk')
  const res = await fetch(`/api/history?${params.toString()}`)
  if (!res.ok) {
    throw new Error(`Failed to load run history: ${res.status}`)
  }
  return (await res.json()) as RunHistoryResponse
}

export async function fetchRunHistoryStats(
  days = 30
): Promise<HistoryStatsResponse> {
  const res = await fetch(`/api/history/stats?days=${days}`)
  if (!res.ok) {
    throw new Error(`Failed to load history stats: ${res.status}`)
  }
  return (await res.json()) as HistoryStatsResponse
}

export async function fetchRunDetail(runId: string): Promise<RunHistoryDetail> {
  const res = await fetch(`/api/history/${encodeURIComponent(runId)}`)
  if (!res.ok) {
    throw new Error(`Failed to load run detail: ${res.status}`)
  }
  return (await res.json()) as RunHistoryDetail
}
