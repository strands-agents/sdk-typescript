import { useQueryClient } from '@tanstack/react-query'
import type { DonePayload, RunPayload } from '../lib/types'
import { fetchRun } from '../api/api'
import { useRunStore } from '../store/runStore'

const USER_CANCEL_MESSAGE = 'Run canceled by user.'
let activeRunController: AbortController | null = null

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException) return err.name === 'AbortError'
  return err instanceof Error && err.name === 'AbortError'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

let lastStreamChunkByNode = new Map<string, string>()
let seenDeltaStreamByNode = new Set<string>()

function resetStreamDedupState(): void {
  lastStreamChunkByNode = new Map<string, string>()
  seenDeltaStreamByNode = new Set<string>()
}

type StreamChunkKind = 'delta' | 'block' | 'raw'

interface StreamChunk {
  text: string
  kind: StreamChunkKind
}

function getNestedMultiAgentEvent(
  event: unknown,
  fallbackNodeId?: string
): { type: string; data: Record<string, unknown> } | null {
  const ev = asRecord(event)
  if (!ev) return null

  if (ev.type === 'modelStreamEventHook') {
    return getNestedMultiAgentEvent(ev.event, fallbackNodeId)
  }

  if (ev.type !== 'toolStreamEvent') return null
  const data = asRecord(ev.data)
  if (!data || typeof data.type !== 'string') return null
  if (data.type.startsWith('multiAgent')) {
    const nested = { ...data }
    const missingNodeId = typeof nested.nodeId !== 'string' || nested.nodeId.trim() === ''
    if (missingNodeId) {
      // Do not attribute nested stream events to the parent; use a placeholder so
      // sub-agent content is not merged into the orchestrator segment.
      nested.nodeId =
        data.type === 'multiAgentNodeStreamEvent' ? '__swarm_nested__' : (fallbackNodeId ?? '')
    }
    return { type: data.type, data: nested }
  }
  return null
}

function getStreamChunkFromEvent(event: unknown): StreamChunk | null {
  const ev = asRecord(event)
  if (!ev) return null

  if (ev.type === 'modelStreamEventHook') {
    return getStreamChunkFromEvent(ev.event)
  }

  if (ev.type === 'toolStreamEvent') {
    const nested = getNestedMultiAgentEvent(ev)
    if (nested != null) {
      return getStreamChunkFromEvent(nested.data.event)
    }
    if (typeof ev.data === 'string') return { text: ev.data, kind: 'raw' }
    return null
  }

  if (ev.type === 'modelContentBlockDeltaEvent' && ev.delta != null) {
    const d = asRecord(ev.delta)
    if (!d) return null
    if (d.type === 'textDelta' && typeof d.text === 'string') {
      return { text: d.text, kind: 'delta' }
    }
    if (d.type === 'reasoningContentDelta' && typeof d.text === 'string') {
      return { text: d.text ? `💭 ${d.text}` : '💭 ', kind: 'delta' }
    }
    return null
  }

  if (ev.type === 'textBlock' && typeof ev.text === 'string') {
    return { text: ev.text, kind: 'block' }
  }

  if (ev.type === 'reasoningBlock' && typeof ev.text === 'string') {
    return { text: ev.text ? `💭 ${ev.text}` : '💭 ', kind: 'block' }
  }

  return null
}

function buildEventDetail(eventType: string, data: Record<string, unknown>): string {
  let detail = ''
  if (eventType === 'multiAgentNodeInputEvent' && data.input !== undefined) {
    detail = typeof data.input === 'string' ? data.input : JSON.stringify(data.input).slice(0, 80) + '…'
  }
  if (eventType === 'multiAgentHandoffEvent' && data.message) {
    detail = String(data.message)
  }
  if (eventType === 'multiAgentNodeStopEvent' && data.nodeResult) {
    const r = data.nodeResult as { result?: { toString?: () => string }; status?: string }
    const out = typeof r.result?.toString === 'function' ? r.result.toString() : ''
    detail = r.status ?? (out ? (out.length > 120 ? out.slice(0, 120) + '…' : out) : '')
  }
  if (eventType === 'multiAgentResultEvent' && data.result) {
    const r = data.result as { status?: string; toString?: () => string }
    const out = typeof r.toString === 'function' ? r.toString() : ''
    detail = r.status ?? (out.length > 150 ? out.slice(0, 150) + '…' : out)
  }
  if (eventType === 'multiAgentNodeStreamEvent') {
    const chunk = getStreamChunkFromEvent(data.event)
    if (chunk?.text) {
      detail = chunk.text.length > 60 ? chunk.text.slice(0, 60) + '…' : chunk.text
    }
  }
  return detail
}

function processEvent(eventType: string, data: Record<string, unknown>): void {
  const get = useRunStore.getState
  const nodeId = (data.nodeId ?? (Array.isArray(data.fromNodeIds) ? data.fromNodeIds[0] : null)) as string | null
  const fromIds = Array.isArray(data.fromNodeIds)
    ? data.fromNodeIds.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    : []
  const toIds = Array.isArray(data.toNodeIds)
    ? data.toNodeIds.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    : []
  const nodeLabel =
    typeof data.nodeId === 'string' && data.nodeId.trim() !== ''
      ? data.nodeId
      : fromIds.length > 0 || toIds.length > 0
      ? `${fromIds.join(' + ') || '?'} → ${toIds.join(' + ') || '?'}`
      : ''

  if (typeof nodeId === 'string' && nodeId.trim() !== '') {
    get().registerNode(nodeId)
  }

  if (eventType === 'multiAgentNodeStreamEvent') {
    const fallbackNodeId = typeof data.nodeId === 'string' ? data.nodeId : undefined
    const nested = getNestedMultiAgentEvent(data.event, fallbackNodeId)
    if (nested != null) {
      processEvent(nested.type, nested.data)
      return
    }
  }

  const shortType = eventType.replace('multiAgent', '').replace('Event', '')
  let detail = buildEventDetail(eventType, data)

  if (eventType === 'multiAgentNodeStreamEvent') {
    const chunk = getStreamChunkFromEvent(data.event)
    if (chunk?.text) {
      const nid = (data.nodeId as string) ?? undefined
      const dedupeKey = typeof nid === 'string' && nid.trim() !== '' ? nid : '__unknown__'

      if (chunk.kind === 'block' && seenDeltaStreamByNode.has(dedupeKey)) {
        // Ignore full snapshot blocks once a node is already streaming deltas.
        return
      }
      if (chunk.kind === 'delta') {
        seenDeltaStreamByNode.add(dedupeKey)
      }

      const lastChunk = lastStreamChunkByNode.get(dedupeKey)
      if (lastChunk === chunk.text) {
        return
      }
      lastStreamChunkByNode.set(dedupeKey, chunk.text)
      // Register node when we first see stream content so the agent pill appears and grouping is consistent.
      if (typeof nid === 'string' && nid.trim() !== '' && nid !== '__swarm_nested__') {
        get().registerNode(nid)
      }
      get().appendStreamChunk(chunk.text, nid)
    }
  }

  if (eventType === 'multiAgentNodeStartEvent' && nodeId) {
    get().registerNode(nodeId)
    get().setCurrentNodeId(nodeId)
    get().addTimelineEntry(nodeId, 'node-start', 'executing', 'Started')
    if (get().streamSegments.length > 0) {
      get().appendStreamChunk('\n\n', nodeId)
    }
  }
  if (eventType === 'multiAgentNodeStopEvent' && nodeId) {
    get().registerNode(nodeId)
    const status = (data.nodeResult as { status?: string })?.status ?? 'completed'
    if (status === 'failed' || status === 'error') get().failNode(nodeId)
    else get().completeNode(nodeId)
    get().addTimelineEntry(nodeId, 'node-stop', status, detail || status)
  }
  if (eventType === 'multiAgentHandoffEvent') {
    const from = (data.fromNodeIds as string[])?.[0]
    const to = (data.toNodeIds as string[])?.[0]
    if (typeof from === 'string' && from.trim() !== '') get().registerNode(from)
    if (typeof to === 'string' && to.trim() !== '') get().registerNode(to)
    if (from) get().addTimelineEntry(from, 'handoff', 'completed', `hand off → ${to ?? '?'}`)
    if (to) get().addTimelineEntry(to, 'handoff', 'executing', `← from ${from ?? '?'}`)
  }

  if (eventType === 'multiAgentNodeStreamEvent' && !detail) return

  let className = 'event'
  if (eventType === 'multiAgentNodeStartEvent') className += ' node-start'
  if (eventType === 'multiAgentNodeStopEvent') className += ' node-stop'
  if (eventType === 'multiAgentHandoffEvent') className += ' handoff'
  if (eventType === 'multiAgentResultEvent') className += ' result'
  if (eventType === 'error') className += ' error'

  get().appendEvent({ type: shortType, nodeLabel, detail, className })
}

export function useRun(): {
  startRun: (payload: RunPayload) => Promise<void>
  cancelRun: () => void
  clearRun: () => void
  isRunning: boolean
} {
  const queryClient = useQueryClient()
  const isRunning = useRunStore((s) => s.status) === 'running'
  const clearRun = useRunStore((s) => s.clearRun)

  function refreshRelatedQueries(): void {
    queryClient.invalidateQueries({ queryKey: ['telemetry'] })
    queryClient.invalidateQueries({ queryKey: ['run-history'] })
    queryClient.invalidateQueries({ queryKey: ['run-history-stats'] })
  }

  async function startRun(payload: RunPayload): Promise<void> {
    const get = useRunStore.getState
    if (activeRunController != null && !activeRunController.signal.aborted) return

    const controller = new AbortController()
    activeRunController = controller
    resetStreamDedupState()
    get().setRunning(payload.agents.map((a) => a.name), payload.structuredOutputSchema)

    try {
      const res = await fetchRun(payload, controller.signal)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        get().setRunError((err as { error?: string }).error ?? res.statusText)
        refreshRelatedQueries()
        return
      }
      refreshRelatedQueries()

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) {
        get().setRunError('No response body')
        return
      }

      let buffer = ''
      let result: unknown = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const block of parts) {
          let eventType = 'message'
          let dataStr = ''
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim()
            else if (line.startsWith('data: ')) dataStr = line.slice(6)
          }
          if (!dataStr) continue
          try {
            const data = JSON.parse(dataStr) as Record<string, unknown>
            if (eventType === 'done') {
              result = data
              break
            }
            if (eventType === 'error') {
              const runId = typeof data.runId === 'string' ? data.runId.trim() : ''
              if (runId !== '') {
                get().setMetrics({ runId })
              }
              get().setRunError(String(data.message ?? 'Unknown error'))
              refreshRelatedQueries()
              return
            }
            if (typeof data.type === 'string') {
              processEvent(data.type, data)
            }
          } catch {
            // ignore parse errors
          }
        }
      }

      if (result != null) {
        const r = result as DonePayload & { text?: string; result?: unknown }
        const modelId = (result as { modelId?: string }).modelId
        const structuredOutput = (result as { structuredOutput?: unknown }).structuredOutput
        get().setMetrics({
          ...r,
          modelId,
          estimatedCostUsd: r.estimatedCostUsd,
          structuredOutput,
        })
        const text =
          structuredOutput != null
            ? JSON.stringify(structuredOutput, null, 2)
            : r.text ?? (r.result != null ? JSON.stringify(r.result, null, 2) : null)
        get().setResult(text ?? 'No result')
      } else {
        get().setRunError('Run ended before a completion payload was received.')
        refreshRelatedQueries()
        return
      }

      get().setDone()
      refreshRelatedQueries()
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) {
        if (activeRunController === controller && get().status === 'running') {
          get().setInterrupted(USER_CANCEL_MESSAGE)
        }
        refreshRelatedQueries()
        return
      }
      get().setRunError(err instanceof Error ? err.message : String(err))
      refreshRelatedQueries()
    } finally {
      if (activeRunController === controller) activeRunController = null
    }
  }

  function cancelRun(): void {
    const get = useRunStore.getState
    if (activeRunController == null || activeRunController.signal.aborted) return
    if (get().status !== 'running') return
    activeRunController.abort()
    get().appendEvent({
      type: 'Run',
      nodeLabel: 'system',
      detail: USER_CANCEL_MESSAGE,
      className: 'event',
    })
    get().setInterrupted(USER_CANCEL_MESSAGE)
    refreshRelatedQueries()
  }

  return { startRun, cancelRun, clearRun, isRunning }
}
