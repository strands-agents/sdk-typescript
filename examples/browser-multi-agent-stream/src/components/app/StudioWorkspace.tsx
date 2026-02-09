import ContentTabs from '../ContentTabs'
import HistoryPanel from '../HistoryPanel'
import PresetExplorer from '../PresetExplorer'
import PromptBar from '../PromptBar'
import RunRecordView from '../RunRecordView'
import Sidebar from '../Sidebar'
import type { Dispatch, SetStateAction } from 'react'
import type {
  AgentSpec,
  CuratedModelProfile,
  RunMode,
  RunPayload,
  StructuredOutputSchemaId,
  TabId,
} from '../../lib/types'

interface StudioWorkspaceProps {
  workspaceView: 'compose' | 'output' | 'history'
  selectedRunId: string | null
  prompt: string
  onPromptChange: (prompt: string) => void
  buildPayload: () => RunPayload | null
  onRunTriggered: () => void
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  isRunning: boolean
  presetKey: string
  mode: RunMode
  hasSession: boolean
  onFollowUpPromptCommitted: (prompt: string) => void
  buildPayloadForPrompt: (prompt: string) => RunPayload | null
  onApplyPreset: (presetKey: string) => void
  onStartCustomSetup: (mode: RunMode) => void
  agents: AgentSpec[]
  setAgents: Dispatch<SetStateAction<AgentSpec[]>>
  setMode: (mode: RunMode) => void
  topLevelModelProfile: CuratedModelProfile
  setTopLevelModelProfile: (value: CuratedModelProfile) => void
  topLevelModelId?: string
  setTopLevelModelId: (value: string | undefined) => void
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
}

export default function StudioWorkspace({
  workspaceView,
  selectedRunId,
  prompt,
  onPromptChange,
  buildPayload,
  onRunTriggered,
  activeTab,
  onTabChange,
  isRunning,
  presetKey,
  mode,
  hasSession,
  onFollowUpPromptCommitted,
  buildPayloadForPrompt,
  onApplyPreset,
  onStartCustomSetup,
  agents,
  setAgents,
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
  structuredOutputSchema,
}: StudioWorkspaceProps): JSX.Element {
  if (workspaceView === 'compose') {
    return (
      <section className="compose-host">
        <PresetExplorer
          presetKey={presetKey}
          currentMode={mode}
          onApplyPreset={onApplyPreset}
          onStartCustomSetup={onStartCustomSetup}
        />
        <div className="setup-shell">
          <PromptBar
            prompt={prompt}
            onPromptChange={onPromptChange}
            buildPayload={buildPayload}
            onRunTriggered={onRunTriggered}
          />
          <Sidebar
            agents={agents}
            setAgents={setAgents}
            mode={mode}
            setMode={setMode}
            topLevelModelProfile={topLevelModelProfile}
            setTopLevelModelProfile={setTopLevelModelProfile}
            topLevelModelId={topLevelModelId}
            setTopLevelModelId={setTopLevelModelId}
            singleAgent={singleAgent}
            setSingleAgent={setSingleAgent}
            entryPoint={entryPoint}
            setEntryPoint={setEntryPoint}
            maxHandoffs={maxHandoffs}
            setMaxHandoffs={setMaxHandoffs}
            edges={edges}
            setEdges={setEdges}
            graphEntryPoints={graphEntryPoints}
            setGraphEntryPoints={setGraphEntryPoints}
            presetKey={presetKey}
            structuredOutputSchema={structuredOutputSchema}
            onApplyPreset={onApplyPreset}
          />
        </div>
      </section>
    )
  }

  if (workspaceView === 'output') {
    return (
      <section className="output-host">
        <ContentTabs
          activeTab={activeTab}
          onTabChange={onTabChange}
          isRunning={isRunning}
          presetKey={presetKey}
          mode={mode}
          hasSession={hasSession}
          onFollowUpPromptCommitted={onFollowUpPromptCommitted}
          buildPayloadForPrompt={buildPayloadForPrompt}
        />
      </section>
    )
  }

  if (selectedRunId == null) {
    return (
      <section className="history-page">
        <HistoryPanel />
      </section>
    )
  }

  return (
    <section className="run-record-host">
      <RunRecordView runId={selectedRunId} />
    </section>
  )
}
