import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useRunStore } from '../store/runStore'
import { DEFAULT_TOP_LEVEL_MODEL_PROFILE, PRESETS } from '../lib/constants'
import { genId } from '../lib/genId'
import type { AgentSpec } from '../lib/types'
import type {
  CuratedModelProfile,
  RunMode,
  RunPayload,
  StructuredOutputSchemaId,
  TabId,
} from '../lib/types'

const DEFAULT_PRESET_KEY = 'research'
const initialPreset = PRESETS[DEFAULT_PRESET_KEY]
const initialAgents: AgentSpec[] = (initialPreset?.agents ?? []).map((agent) => ({
  ...agent,
  id: genId(),
}))
function normalizeMode(mode: RunMode | undefined): RunMode {
  return mode === 'graph' ? 'swarm' : (mode ?? 'swarm')
}

export type WorkspaceView = 'compose' | 'output' | 'history'

export function useStudioSetup(): {
  agents: AgentSpec[]
  setAgents: Dispatch<SetStateAction<AgentSpec[]>>
  mode: RunMode
  setMode: (mode: RunMode) => void
  singleAgent: string
  setSingleAgent: (value: string) => void
  entryPoint: string
  setEntryPoint: (value: string) => void
  maxHandoffs: number
  setMaxHandoffs: (value: number) => void
  edges: Array<{ from: string; to: string }>
  setEdges: Dispatch<SetStateAction<Array<{ from: string; to: string }>>>
  graphEntryPoints: Set<string>
  setGraphEntryPoints: Dispatch<SetStateAction<Set<string>>>
  structuredOutputSchema?: StructuredOutputSchemaId
  sessionId?: string
  topLevelModelProfile: CuratedModelProfile
  setTopLevelModelProfile: (value: CuratedModelProfile) => void
  topLevelModelId?: string
  setTopLevelModelId: (value: string | undefined) => void
  prompt: string
  setPrompt: (value: string) => void
  activeTab: TabId
  setActiveTab: (value: TabId) => void
  presetKey: string
  workspaceView: WorkspaceView
  setWorkspaceView: (value: WorkspaceView) => void
  selectedRunId: string | null
  setSelectedRunId: (runId: string | null) => void
  isRunning: boolean
  startCustomSetup: (customMode: RunMode) => void
  applyPreset: (value: string) => void
  buildPayloadForPrompt: (promptText: string) => RunPayload | null
  buildPayload: () => RunPayload | null
} {
  const [agents, setAgents] = useState<AgentSpec[]>(initialAgents)
  const [mode, setMode] = useState<RunMode>(normalizeMode(initialPreset?.mode))
  const [singleAgent, setSingleAgent] = useState(initialPreset?.singleAgent ?? initialAgents[0]?.name ?? '')
  const [entryPoint, setEntryPoint] = useState(initialAgents[0]?.name ?? '')
  const [maxHandoffs, setMaxHandoffs] = useState(3)
  const [edges, setEdges] = useState<Array<{ from: string; to: string }>>([])
  const [graphEntryPoints, setGraphEntryPoints] = useState<Set<string>>(
    () => new Set(initialAgents.map((agent) => agent.name))
  )
  const [structuredOutputSchema, setStructuredOutputSchema] = useState<StructuredOutputSchemaId | undefined>(
    initialPreset?.structuredOutputSchema
  )
  const [sessionId, setSessionId] = useState<string | undefined>(initialPreset?.sessionId)
  const [topLevelModelProfile, setTopLevelModelProfile] = useState<CuratedModelProfile>(
    DEFAULT_TOP_LEVEL_MODEL_PROFILE
  )
  const [topLevelModelId, setTopLevelModelId] = useState<string | undefined>(undefined)
  const [prompt, setPrompt] = useState('')
  const [activeTab, setActiveTab] = useState<TabId>('output')
  const [presetKey, setPresetKey] = useState(DEFAULT_PRESET_KEY)
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('compose')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const clearRun = useRunStore((state) => state.clearRun)
  const isRunning = useRunStore((state) => state.status) === 'running'

  const startCustomSetup = useCallback(
    (customMode: RunMode): void => {
      const nextMode = normalizeMode(customMode)
      const baseAgents: AgentSpec[] =
        nextMode === 'single'
          ? [{ id: genId(), name: 'agent1', systemPrompt: '' }]
          : [
              { id: genId(), name: 'agent1', systemPrompt: '' },
              { id: genId(), name: 'agent2', systemPrompt: '' },
            ]
      setPresetKey('custom')
      setMode(nextMode)
      setAgents(baseAgents)
      setSingleAgent(baseAgents[0]?.name ?? '')
      setEntryPoint(baseAgents[0]?.name ?? '')
      setMaxHandoffs(3)
      setEdges([])
      setGraphEntryPoints(new Set([baseAgents[0]?.name ?? 'agent1']))
      setStructuredOutputSchema(undefined)
      setSessionId(undefined)
      setPrompt('')
      clearRun()
      setActiveTab('output')
      setWorkspaceView('compose')
      setSelectedRunId(null)
    },
    [clearRun]
  )

  const applyPreset = useCallback(
    (value: string): void => {
      setPresetKey(value)
      const preset = PRESETS[value]
      const nextMode = normalizeMode(preset?.mode)
      const presetAgents = preset?.agents ?? []
      const nextAgents: AgentSpec[] =
        presetAgents.length > 0
          ? presetAgents.map((agent) => ({ ...agent, id: genId() }))
          : [{ id: genId(), name: 'agent1', systemPrompt: '' }]

      setAgents(nextAgents)
      setMode(nextMode)
      setSingleAgent(preset?.singleAgent ?? nextAgents[0]?.name ?? '')
      setEntryPoint(nextAgents[0]?.name ?? '')
      setMaxHandoffs(3)
      setEdges([])
      setGraphEntryPoints(new Set(preset?.entryPoints ?? nextAgents.map((agent) => agent.name)))
      setStructuredOutputSchema(preset?.structuredOutputSchema)
      setSessionId(preset?.sessionId)
      setPrompt(preset?.prompt ?? '')
      clearRun()
      setActiveTab('output')
      setWorkspaceView('compose')
      setSelectedRunId(null)
    },
    [clearRun]
  )

  useEffect(() => {
    if (agents.length > 0 && !agents.some((agent) => agent.name === entryPoint)) {
      setEntryPoint(agents[0]!.name)
    }
  }, [agents, entryPoint])

  useEffect(() => {
    if (agents.length > 0 && !agents.some((agent) => agent.name === singleAgent)) {
      setSingleAgent(agents[0]!.name)
    }
  }, [agents, singleAgent])

  const buildPayloadForPrompt = useCallback(
    (promptText: string): RunPayload | null => {
      const trimmedPrompt = promptText.trim()
      if (!trimmedPrompt) return null
      const effectiveMode = normalizeMode(mode)

      const agentPayload = agents.map((agent) => ({
        name: agent.name.trim() || 'agent',
        systemPrompt: agent.systemPrompt.slice(0, 500),
        ...(agent.tools != null ? { tools: agent.tools } : {}),
      }))
      if (agentPayload.length < 1) return null

      if (effectiveMode === 'single') {
        const selectedAgent = agentPayload.find((agent) => agent.name === singleAgent) ?? agentPayload[0]
        if (!selectedAgent) return null

        const payload: RunPayload = {
          prompt: trimmedPrompt,
          mode: 'single',
          singleAgent: selectedAgent.name,
          agents: [selectedAgent],
          modelProfile: topLevelModelProfile,
          presetKey,
        }
        if (topLevelModelId != null && topLevelModelId.trim() !== '') payload.modelId = topLevelModelId
        if (sessionId != null && sessionId.trim() !== '') payload.sessionId = sessionId.trim()
        if (structuredOutputSchema) payload.structuredOutputSchema = structuredOutputSchema
        return payload
      }

      const payload: RunPayload = {
        prompt: trimmedPrompt,
        mode: effectiveMode,
        agents: agentPayload,
        modelProfile: topLevelModelProfile,
      }
      if (topLevelModelId != null && topLevelModelId.trim() !== '') payload.modelId = topLevelModelId
      payload.presetKey = presetKey
      if (sessionId != null && sessionId.trim() !== '') payload.sessionId = sessionId.trim()
      payload.entryPoint = entryPoint || agentPayload[0]?.name
      payload.maxHandoffs = Math.min(5, Math.max(1, maxHandoffs))
      return payload
    },
    [
      mode,
      agents,
      singleAgent,
      entryPoint,
      maxHandoffs,
      topLevelModelProfile,
      topLevelModelId,
      sessionId,
      structuredOutputSchema,
      presetKey,
    ]
  )

  const buildPayload = useCallback(
    (): RunPayload | null => buildPayloadForPrompt(prompt),
    [buildPayloadForPrompt, prompt]
  )

  return {
    agents,
    setAgents,
    mode,
    setMode,
    singleAgent,
    setSingleAgent,
    entryPoint,
    setEntryPoint,
    maxHandoffs,
    setMaxHandoffs,
    edges,
    setEdges,
    graphEntryPoints,
    setGraphEntryPoints,
    structuredOutputSchema,
    sessionId,
    topLevelModelProfile,
    setTopLevelModelProfile,
    topLevelModelId,
    setTopLevelModelId,
    prompt,
    setPrompt,
    activeTab,
    setActiveTab,
    presetKey,
    workspaceView,
    setWorkspaceView,
    selectedRunId,
    setSelectedRunId,
    isRunning,
    startCustomSetup,
    applyPreset,
    buildPayloadForPrompt,
    buildPayload,
  }
}
