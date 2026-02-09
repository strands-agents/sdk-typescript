import RunSidebar from './components/RunSidebar'
import StudioHeader from './components/app/StudioHeader'
import StudioWorkspace from './components/app/StudioWorkspace'
import { useStudioSetup } from './hooks/useStudioSetup'

interface AppProps {
  themeAppearance: 'dark' | 'light'
  onToggleTheme: () => void
}

export default function App({ themeAppearance, onToggleTheme }: AppProps): JSX.Element {
  const studio = useStudioSetup()

  const isHistoryView = studio.workspaceView === 'history'
  const isRunDetailView = isHistoryView && studio.selectedRunId != null
  const topBreadcrumb = isHistoryView
    ? (isRunDetailView ? 'History / Run Detail' : 'History / Run List')
    : `Studio / ${studio.workspaceView === 'output' ? 'Output' : 'Compose'}`
  const subtitle = isHistoryView
    ? 'Review persisted runs and diagnostics from the left history rail.'
    : 'Configure setup, run, and review any previous run from the left history rail.'

  return (
    <div className="app">
      <div className="app-shell">
        <RunSidebar
          selectedRunId={studio.selectedRunId}
          onSelectRun={(runId) => {
            studio.setSelectedRunId(runId)
            studio.setWorkspaceView('history')
          }}
          onNewRun={() => {
            studio.setSelectedRunId(null)
            studio.setActiveTab('output')
            studio.setWorkspaceView('compose')
          }}
        />

        <section className="workspace-host">
          <StudioHeader
            isHistoryView={isHistoryView}
            isRunDetailView={isRunDetailView}
            isRunning={studio.isRunning}
            workspaceView={studio.workspaceView}
            topBreadcrumb={topBreadcrumb}
            subtitle={subtitle}
            themeAppearance={themeAppearance}
            onToggleTheme={onToggleTheme}
            onOpenStudio={() => {
              studio.setWorkspaceView(studio.isRunning ? 'output' : 'compose')
            }}
            onOpenHistory={() => {
              studio.setSelectedRunId(null)
              studio.setWorkspaceView('history')
            }}
            onBackToHistory={() => {
              studio.setSelectedRunId(null)
            }}
            onOpenLiveOutputOrCompose={() => {
              studio.setSelectedRunId(null)
              studio.setActiveTab('output')
              studio.setWorkspaceView(studio.isRunning ? 'output' : 'compose')
            }}
            onSelectCompose={() => {
              studio.setWorkspaceView('compose')
            }}
            onSelectOutput={() => {
              studio.setWorkspaceView('output')
            }}
          />

          <main className="studio-main">
            <StudioWorkspace
              workspaceView={studio.workspaceView}
              selectedRunId={studio.selectedRunId}
              prompt={studio.prompt}
              onPromptChange={studio.setPrompt}
              buildPayload={studio.buildPayload}
              onRunTriggered={() => {
                studio.setWorkspaceView('output')
              }}
              activeTab={studio.activeTab}
              onTabChange={studio.setActiveTab}
              isRunning={studio.isRunning}
              presetKey={studio.presetKey}
              mode={studio.mode}
              hasSession={studio.sessionId != null && studio.sessionId.trim() !== ''}
              onFollowUpPromptCommitted={(nextPrompt) => {
                studio.setPrompt(nextPrompt)
                studio.setSelectedRunId(null)
              }}
              buildPayloadForPrompt={studio.buildPayloadForPrompt}
              onApplyPreset={studio.applyPreset}
              onStartCustomSetup={studio.startCustomSetup}
              agents={studio.agents}
              setAgents={studio.setAgents}
              setMode={studio.setMode}
              topLevelModelProfile={studio.topLevelModelProfile}
              setTopLevelModelProfile={studio.setTopLevelModelProfile}
              topLevelModelId={studio.topLevelModelId}
              setTopLevelModelId={studio.setTopLevelModelId}
              singleAgent={studio.singleAgent}
              setSingleAgent={studio.setSingleAgent}
              entryPoint={studio.entryPoint}
              setEntryPoint={studio.setEntryPoint}
              maxHandoffs={studio.maxHandoffs}
              setMaxHandoffs={studio.setMaxHandoffs}
              edges={studio.edges}
              setEdges={studio.setEdges}
              graphEntryPoints={studio.graphEntryPoints}
              setGraphEntryPoints={studio.setGraphEntryPoints}
              structuredOutputSchema={studio.structuredOutputSchema}
            />
          </main>
        </section>
      </div>
    </div>
  )
}
