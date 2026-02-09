import { Button } from '@radix-ui/themes'
import React from 'react'
import AgentCard from './AgentCard'
import AgentLibrarySection from './sidebar/AgentLibrarySection'
import ModeSettingsSection from './sidebar/ModeSettingsSection'
import PresetInfoSection from './sidebar/PresetInfoSection'
import {
  AGENT_LIBRARY,
  MAX_AGENTS,
  PRESET_GUIDES,
  PRESET_LABELS,
  STRUCTURED_OUTPUT_SCHEMAS,
  TOP_LEVEL_CURATED_MODEL_BY_ID,
  TOP_LEVEL_MODEL_PROFILE_DEFAULTS,
} from '../lib/constants'
import { genId } from '../lib/genId'
import type { AgentLibraryEntry } from '../lib/constants'
import type {
  AgentSpec,
  CuratedModelProfile,
  RunMode,
  StructuredOutputSchemaId,
} from '../lib/types'

type Edge = { from: string; to: string }

interface SidebarProps {
  agents: AgentSpec[]
  setAgents: React.Dispatch<React.SetStateAction<AgentSpec[]>>
  mode: RunMode
  setMode: (mode: RunMode) => void
  topLevelModelProfile: CuratedModelProfile
  setTopLevelModelProfile: (value: CuratedModelProfile) => void
  topLevelModelId?: string
  setTopLevelModelId: (value: string | undefined) => void
  singleAgent: string
  setSingleAgent: (v: string) => void
  entryPoint: string
  setEntryPoint: (v: string) => void
  maxHandoffs: number
  setMaxHandoffs: (v: number) => void
  edges: Edge[]
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  graphEntryPoints: Set<string>
  setGraphEntryPoints: React.Dispatch<React.SetStateAction<Set<string>>>
  presetKey: string
  structuredOutputSchema?: StructuredOutputSchemaId
  onApplyPreset: (presetKey: string) => void
}

function buildUniqueAgentName(baseName: string, existingNames: Set<string>): string {
  const normalized = baseName.trim().replace(/\s+/g, '_') || 'agent'
  if (!existingNames.has(normalized)) return normalized
  let suffix = 2
  while (existingNames.has(`${normalized}_${suffix}`)) suffix += 1
  return `${normalized}_${suffix}`
}

export default function Sidebar({
  agents,
  setAgents,
  mode,
  setMode,
  topLevelModelProfile,
  setTopLevelModelProfile,
  topLevelModelId,
  setTopLevelModelId,
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
  presetKey,
  structuredOutputSchema,
  onApplyPreset,
}: SidebarProps): JSX.Element {
  const [agentSearch, setAgentSearch] = React.useState('')
  const isCustomPreset = presetKey === 'custom'

  const guide = PRESET_GUIDES[presetKey]
  const activeStructuredSchema =
    structuredOutputSchema != null
      ? STRUCTURED_OUTPUT_SCHEMAS[structuredOutputSchema]
      : undefined
  const activePresetLabel = PRESET_LABELS[presetKey] ?? presetKey
  const selectedTopLevelModelId =
    topLevelModelId != null && TOP_LEVEL_CURATED_MODEL_BY_ID.has(topLevelModelId)
      ? topLevelModelId
      : TOP_LEVEL_MODEL_PROFILE_DEFAULTS[topLevelModelProfile]
  const selectedTopLevelModel = TOP_LEVEL_CURATED_MODEL_BY_ID.get(selectedTopLevelModelId)

  const filteredAgentLibrary = React.useMemo(() => {
    const query = agentSearch.trim().toLowerCase()
    if (!query) return AGENT_LIBRARY
    return AGENT_LIBRARY.filter((entry) => {
      const toolText = entry.tools.join(' ')
      return (
        entry.name.toLowerCase().includes(query) ||
        entry.sourcePresetLabel.toLowerCase().includes(query) ||
        entry.sourceFeature.toLowerCase().includes(query) ||
        entry.systemPrompt.toLowerCase().includes(query) ||
        toolText.toLowerCase().includes(query)
      )
    })
  }, [agentSearch])

  function addAgentFromLibrary(entry: AgentLibraryEntry): void {
    setAgents((prev) => {
      if (prev.length >= MAX_AGENTS) return prev
      const existingNames = new Set(prev.map((agent) => agent.name))
      const nextName = buildUniqueAgentName(entry.name, existingNames)
      return [
        ...prev,
        {
          id: genId(),
          name: nextName,
          systemPrompt: entry.systemPrompt,
          tools: entry.tools.length > 0 ? [...entry.tools] : [],
        },
      ]
    })
  }

  function updateAgent(
    id: string,
    updates: Partial<Pick<AgentSpec, 'name' | 'systemPrompt' | 'tools'>>
  ): void {
    setAgents((prev) => {
      let resolvedName = updates.name
      if (resolvedName != null) {
        const existingNames = new Set(prev.filter((agent) => agent.id !== id).map((agent) => agent.name))
        resolvedName = buildUniqueAgentName(resolvedName, existingNames)
      }

      const next = prev.map((agent) =>
        agent.id === id
          ? {
              ...agent,
              ...updates,
              ...(resolvedName != null ? { name: resolvedName } : {}),
            }
          : agent
      )
      if (resolvedName != null) {
        const oldAgent = prev.find((agent) => agent.id === id)
        const oldName = oldAgent?.name
        if (oldName) {
          setEdges((prevEdges) =>
            prevEdges.map((edge) => ({
              from: edge.from === oldName ? resolvedName! : edge.from,
              to: edge.to === oldName ? resolvedName! : edge.to,
            }))
          )
          setGraphEntryPoints((prevEntryPoints) => {
            const nextEntryPoints = new Set(prevEntryPoints)
            nextEntryPoints.delete(oldName)
            nextEntryPoints.add(resolvedName!)
            return nextEntryPoints
          })
          if (entryPoint === oldName) setEntryPoint(resolvedName!)
          if (singleAgent === oldName) setSingleAgent(resolvedName!)
        }
      }
      return next
    })
  }

  function removeAgent(id: string): void {
    if (agents.length <= 1) return
    const agent = agents.find((item) => item.id === id)
    if (!agent) return
    const nextAgents = agents.filter((item) => item.id !== id)
    setAgents(nextAgents)
    setEdges((prev) =>
      prev.filter((edge) => edge.from !== agent.name && edge.to !== agent.name)
    )
    setGraphEntryPoints((prev) => {
      const next = new Set(prev)
      next.delete(agent.name)
      return next
    })
    if (entryPoint === agent.name) setEntryPoint(nextAgents[0]?.name ?? '')
    if (singleAgent === agent.name) setSingleAgent(nextAgents[0]?.name ?? '')
  }

  function addEdge(): void {
    if (agents.length < 2 || edges.length >= 10) return
    setEdges((prev) => [...prev, { from: agents[0]!.name, to: agents[1]!.name }])
  }

  function updateEdge(index: number, field: 'from' | 'to', value: string): void {
    setEdges((prev) => {
      const next = [...prev]
      const edge = next[index]
      if (edge) next[index] = { ...edge, [field]: value }
      return next
    })
  }

  function removeEdge(index: number): void {
    setEdges((prev) => prev.filter((_, edgeIndex) => edgeIndex !== index))
  }

  function toggleGraphEntry(name: string): void {
    setGraphEntryPoints((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <aside className="sidebar">
      <PresetInfoSection
        presetKey={presetKey}
        activePresetLabel={activePresetLabel}
        guide={guide}
        activeStructuredSchema={activeStructuredSchema}
        onResetPreset={onApplyPreset}
      />

      <ModeSettingsSection
        isCustomPreset={isCustomPreset}
        mode={mode}
        setMode={setMode}
        topLevelModelProfile={topLevelModelProfile}
        setTopLevelModelProfile={setTopLevelModelProfile}
        topLevelModelId={topLevelModelId}
        setTopLevelModelId={setTopLevelModelId}
        activeModelDescription={selectedTopLevelModel?.notes}
        agents={agents}
        singleAgent={singleAgent}
        setSingleAgent={setSingleAgent}
        entryPoint={entryPoint}
        setEntryPoint={setEntryPoint}
        maxHandoffs={maxHandoffs}
        setMaxHandoffs={setMaxHandoffs}
        edges={edges}
        onAddEdge={addEdge}
        onUpdateEdge={updateEdge}
        onRemoveEdge={removeEdge}
        graphEntryPoints={graphEntryPoints}
        onToggleGraphEntry={toggleGraphEntry}
      />

      <section className="agents-section">
        <div className="agents-header">
          <label>Agents (1-5)</label>
          <Button
            variant="soft"
            size="2"
            title="Add agent"
            disabled={agents.length >= MAX_AGENTS}
            onClick={() =>
              setAgents((prev) => {
                const existingNames = new Set(prev.map((agent) => agent.name))
                const nextName = buildUniqueAgentName(`agent${prev.length + 1}`, existingNames)
                return [...prev, { id: genId(), name: nextName, systemPrompt: '' }]
              })
            }
          >
            + Add
          </Button>
        </div>
        <div className="agents">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onUpdate={updateAgent}
              onRemove={removeAgent}
              canRemove={agents.length > 1}
            />
          ))}
        </div>
      </section>

      <AgentLibrarySection
        agentSearch={agentSearch}
        onAgentSearchChange={setAgentSearch}
        filteredAgentLibrary={filteredAgentLibrary}
        totalAgentLibraryCount={AGENT_LIBRARY.length}
        canAddAgents={agents.length < MAX_AGENTS}
        onAddAgentFromLibrary={addAgentFromLibrary}
      />
    </aside>
  )
}
