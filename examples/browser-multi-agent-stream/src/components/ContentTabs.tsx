import { Box, Tabs } from '@radix-ui/themes'
import FollowUpComposer from './FollowUpComposer'
import LogsPanel from './LogsPanel'
import MetricsPanel from './MetricsPanel'
import OutputPanel from './OutputPanel'
import { useRun } from '../hooks/useRun'
import { useRunStore } from '../store/runStore'
import type { RunMode, RunPayload, TabId } from '../lib/types'

interface ContentTabsProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  isRunning: boolean
  presetKey: string
  mode: RunMode
  hasSession: boolean
  onFollowUpPromptCommitted: (prompt: string) => void
  buildPayloadForPrompt: (prompt: string) => RunPayload | null
}

export default function ContentTabs({
  activeTab,
  onTabChange,
  isRunning,
  presetKey,
  mode,
  hasSession,
  onFollowUpPromptCommitted,
  buildPayloadForPrompt,
}: ContentTabsProps): JSX.Element {
  const { cancelRun } = useRun()
  const currentRunId = useRunStore((state) => state.metrics?.runId)

  return (
    <div className="content run-shell">
      <div className="run-shell-header">
        <div>
          <h2>Run Output</h2>
          <p>Live stream, metrics, logs, and inline follow-up prompts.</p>
        </div>
        {isRunning && (
          <button type="button" className="danger-btn" onClick={cancelRun}>
            Cancel Run
          </button>
        )}
      </div>
      <FollowUpComposer
        isRunning={isRunning}
        presetKey={presetKey}
        mode={mode}
        hasSession={hasSession}
        onPromptCommitted={onFollowUpPromptCommitted}
        buildPayloadForPrompt={buildPayloadForPrompt}
      />
      <div className={`content-tabs ${isRunning ? 'running' : ''}`}>
        <Tabs.Root value={activeTab} onValueChange={(v) => onTabChange(v as TabId)} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <Tabs.List>
            <Tabs.Trigger value="output">Output</Tabs.Trigger>
            <Tabs.Trigger value="metrics">Metrics</Tabs.Trigger>
            <Tabs.Trigger value="logs">Logs</Tabs.Trigger>
          </Tabs.List>
          <Box
            pt="3"
            className="tabs-panels"
            style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            <Tabs.Content value="output" className="tab-panel">
              <OutputPanel />
            </Tabs.Content>
            <Tabs.Content value="metrics" className="tab-panel">
              <MetricsPanel />
            </Tabs.Content>
            <Tabs.Content value="logs" className="tab-panel">
              <LogsPanel runId={currentRunId} />
            </Tabs.Content>
          </Box>
        </Tabs.Root>
      </div>
    </div>
  )
}
