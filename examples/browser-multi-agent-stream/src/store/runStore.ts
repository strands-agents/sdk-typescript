import { create } from 'zustand'
import type {
  ActivityEvent,
  DonePayload,
  StreamSegment,
  StructuredOutputSchemaId,
  TimelineEntry,
} from '../lib/types'

export type RunStatus = 'idle' | 'running'

interface RunState {
  status: RunStatus
  streamSegments: StreamSegment[]
  timelineNodeOrder: string[]
  timelineLanes: Record<string, TimelineEntry[]>
  currentNodeId: string | null
  runAgentNames: string[]
  completedNodeIds: string[]
  failedNodeIds: string[]
  requestedStructuredOutputSchema?: StructuredOutputSchemaId
  events: ActivityEvent[]
  resultText: string
  resultError: boolean
  metrics: DonePayload | null
}

interface RunActions {
  setRunning: (agentNames: string[], requestedStructuredOutputSchema?: StructuredOutputSchemaId) => void
  registerNode: (nodeId: string) => void
  appendStreamChunk: (text: string, nodeId?: string) => void
  setCurrentNodeId: (nodeId: string | null) => void
  addTimelineEntry: (nodeId: string, type: string, status?: string, detail?: string) => void
  appendEvent: (ev: ActivityEvent) => void
  completeNode: (nodeId: string) => void
  failNode: (nodeId: string) => void
  setResult: (text: string, isError?: boolean) => void
  setMetrics: (done: DonePayload | null) => void
  setDone: () => void
  setInterrupted: (message?: string) => void
  setRunError: (message: string) => void
  clearRun: () => void
}

const initialState: RunState = {
  status: 'idle',
  streamSegments: [],
  timelineNodeOrder: [],
  timelineLanes: {},
  currentNodeId: null,
  runAgentNames: [],
  completedNodeIds: [],
  failedNodeIds: [],
  requestedStructuredOutputSchema: undefined,
  events: [],
  resultText: '',
  resultError: false,
  metrics: null,
}

function mergeChunkWithOverlap(existingText: string, incomingText: string): string {
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

function appendStreamLogic(
  segments: StreamSegment[],
  currentNodeId: string | null,
  text: string,
  nodeId?: string
): { segments: StreamSegment[]; currentNodeId: string | null } {
  const effectiveNode = nodeId ?? currentNodeId ?? ''
  if (nodeId && nodeId !== currentNodeId) {
    const newSegments = [
      ...segments,
      {
        nodeId,
        text: (segments.length > 0 ? '\n\n' : '') + `--- [${nodeId}] ---\n` + text,
      },
    ]
    return { segments: newSegments, currentNodeId: nodeId }
  }
  if (segments.length > 0 && segments[segments.length - 1]!.nodeId === effectiveNode) {
    const last = segments[segments.length - 1]!
    const newSegments = segments.slice(0, -1).concat({
      ...last,
      text: mergeChunkWithOverlap(last.text, text),
    })
    return { segments: newSegments, currentNodeId: nodeId ?? currentNodeId }
  }
  const prefix = segments.length > 0 ? '\n\n' : ''
  const label = effectiveNode ? `--- [${effectiveNode}] ---\n` : ''
  const newSegments = [...segments, { nodeId: effectiveNode, text: prefix + label + text }]
  return { segments: newSegments, currentNodeId: nodeId ?? currentNodeId }
}

export const useRunStore = create<RunState & RunActions>()((set) => ({
  ...initialState,

  setRunning(agentNames: string[], requestedStructuredOutputSchema?: StructuredOutputSchemaId) {
    set({
      status: 'running',
      runAgentNames: Array.from(new Set(agentNames)),
      streamSegments: [],
      timelineNodeOrder: [],
      timelineLanes: {},
      currentNodeId: null,
      completedNodeIds: [],
      failedNodeIds: [],
      requestedStructuredOutputSchema,
      events: [],
      resultText: '',
      resultError: false,
      metrics: null,
    })
  },

  registerNode(nodeId: string) {
    if (nodeId.trim() === '') return
    set((state) => {
      if (state.runAgentNames.includes(nodeId)) return {}
      return { runAgentNames: [...state.runAgentNames, nodeId] }
    })
  },

  appendStreamChunk(text: string, nodeId?: string) {
    set((state) => {
      const { segments, currentNodeId } = appendStreamLogic(
        state.streamSegments,
        state.currentNodeId,
        text,
        nodeId
      )
      return { streamSegments: segments, currentNodeId }
    })
  },

  setCurrentNodeId(nodeId: string | null) {
    set({ currentNodeId: nodeId })
  },

  addTimelineEntry(nodeId: string, type: string, status?: string, detail?: string) {
    set((state) => {
      const lanes = { ...state.timelineLanes }
      if (!lanes[nodeId]) {
        lanes[nodeId] = []
      }
      lanes[nodeId] = [
        ...lanes[nodeId],
        { type, status: status ?? '', detail: detail ?? '', time: Date.now() },
      ]
      const order = state.timelineNodeOrder.includes(nodeId)
        ? state.timelineNodeOrder
        : [...state.timelineNodeOrder, nodeId]
      return { timelineLanes: lanes, timelineNodeOrder: order }
    })
  },

  appendEvent(ev: ActivityEvent) {
    set((state) => ({ events: [...state.events, ev] }))
  },

  completeNode(nodeId: string) {
    set((state) => ({
      completedNodeIds: state.completedNodeIds.includes(nodeId)
        ? state.completedNodeIds
        : [...state.completedNodeIds, nodeId],
      failedNodeIds: state.failedNodeIds.filter((id) => id !== nodeId),
    }))
  },

  failNode(nodeId: string) {
    set((state) => ({
      failedNodeIds: state.failedNodeIds.includes(nodeId)
        ? state.failedNodeIds
        : [...state.failedNodeIds, nodeId],
      completedNodeIds: state.completedNodeIds.filter((id) => id !== nodeId),
    }))
  },

  setResult(text: string, isError = false) {
    set({ resultText: text, resultError: isError })
  },

  setMetrics(done: DonePayload | null) {
    set({ metrics: done })
  },

  setDone() {
    set({ status: 'idle' })
  },

  setInterrupted(message = 'Run canceled by user.') {
    set({ resultText: message, resultError: false, status: 'idle' })
  },

  setRunError(message: string) {
    set({ resultText: message, resultError: true, status: 'idle' })
  },

  clearRun() {
    set(initialState)
  },
}))
