import {
  Select,
  SegmentedControl,
  TextField,
} from '@radix-ui/themes'
import {
  TOP_LEVEL_CURATED_MODEL_BY_ID,
  TOP_LEVEL_CURATED_MODELS,
  TOP_LEVEL_MODEL_PROFILE_DEFAULTS,
} from '../../lib/constants'
import type { AgentSpec, CuratedModelProfile, RunMode } from '../../lib/types'

interface Edge {
  from: string
  to: string
}

interface ModeSettingsSectionProps {
  isCustomPreset: boolean
  mode: RunMode
  setMode: (mode: RunMode) => void
  topLevelModelProfile: CuratedModelProfile
  setTopLevelModelProfile: (value: CuratedModelProfile) => void
  topLevelModelId?: string
  setTopLevelModelId: (value: string | undefined) => void
  activeModelDescription?: string
  agents: AgentSpec[]
  singleAgent: string
  setSingleAgent: (value: string) => void
  entryPoint: string
  setEntryPoint: (value: string) => void
  maxHandoffs: number
  setMaxHandoffs: (value: number) => void
  edges: Edge[]
  onAddEdge: () => void
  onUpdateEdge: (index: number, field: 'from' | 'to', value: string) => void
  onRemoveEdge: (index: number) => void
  graphEntryPoints: Set<string>
  onToggleGraphEntry: (name: string) => void
}

function formatModeLabel(value: RunMode): string {
  if (value === 'single') return 'Single'
  if (value === 'graph') return 'Swarm'
  return 'Swarm'
}

const PROFILE_BY_MODEL_ID: Record<string, CuratedModelProfile> = {}
for (const [profile, modelId] of Object.entries(TOP_LEVEL_MODEL_PROFILE_DEFAULTS)) {
  if (PROFILE_BY_MODEL_ID[modelId] == null) {
    PROFILE_BY_MODEL_ID[modelId] = profile as CuratedModelProfile
  }
}

export default function ModeSettingsSection({
  isCustomPreset,
  mode,
  setMode,
  topLevelModelProfile,
  setTopLevelModelProfile,
  topLevelModelId,
  setTopLevelModelId,
  activeModelDescription,
  agents,
  singleAgent,
  setSingleAgent,
  entryPoint,
  setEntryPoint,
  maxHandoffs,
  setMaxHandoffs,
  edges,
  onAddEdge,
  onUpdateEdge,
  onRemoveEdge,
  graphEntryPoints,
  onToggleGraphEntry,
}: ModeSettingsSectionProps): JSX.Element {
  const selectedModelId =
    topLevelModelId != null && TOP_LEVEL_CURATED_MODEL_BY_ID.has(topLevelModelId)
      ? topLevelModelId
      : TOP_LEVEL_MODEL_PROFILE_DEFAULTS[topLevelModelProfile]
  const selectedModel = TOP_LEVEL_CURATED_MODEL_BY_ID.get(selectedModelId)

  return (
    <>
      <section className="mode-section">
        <label>Mode</label>
        {isCustomPreset ? (
          <SegmentedControl.Root
            value={mode}
            onValueChange={(value) => setMode(value as RunMode)}
            aria-label="Orchestration mode"
          >
            <SegmentedControl.Item value="single">Single</SegmentedControl.Item>
            <SegmentedControl.Item value="swarm">Swarm</SegmentedControl.Item>
          </SegmentedControl.Root>
        ) : (
          <div className="mode-lock-row">
            <strong>{formatModeLabel(mode)}</strong>
            <span>Locked by preset. Use Custom Setup to choose a different mode.</span>
          </div>
        )}
      </section>
      <section className="mode-section">
        <label htmlFor="top-level-model-choice">Top-level model</label>
        <Select.Root
          value={selectedModelId}
          onValueChange={(value) => {
            setTopLevelModelId(value)
            const mappedProfile = PROFILE_BY_MODEL_ID[value]
            if (mappedProfile != null) setTopLevelModelProfile(mappedProfile)
          }}
        >
          <Select.Trigger id="top-level-model-choice" />
          <Select.Content>
            {TOP_LEVEL_CURATED_MODELS.map((model) => (
              <Select.Item key={model.modelId} value={model.modelId}>
                {model.intentLabel} ({model.displayName})
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <p className="mode-help">
          {activeModelDescription ?? selectedModel?.notes ?? 'Choose a curated model for top-level orchestration.'}
        </p>
      </section>
      <section className={`single-options ${mode === 'single' ? '' : 'hidden'}`}>
        <label htmlFor="single-agent">Single agent</label>
        <Select.Root value={singleAgent} onValueChange={setSingleAgent}>
          <Select.Trigger id="single-agent" />
          <Select.Content>
            {agents.map((agent) => (
              <Select.Item key={agent.id} value={agent.name}>
                {agent.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <p className="mode-help">Only the selected agent executes for this run.</p>
      </section>
      <section className={`swarm-options ${mode === 'swarm' ? '' : 'hidden'}`}>
        <label htmlFor="entry-point">Entry point</label>
        <Select.Root value={entryPoint} onValueChange={setEntryPoint}>
          <Select.Trigger id="entry-point" />
          <Select.Content>
            {agents.map((agent) => (
              <Select.Item key={agent.id} value={agent.name}>
                {agent.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <label htmlFor="max-handoffs">Max handoffs (1-5)</label>
        <TextField.Root
          id="max-handoffs"
          type="number"
          min={1}
          max={5}
          value={String(maxHandoffs)}
          onChange={(event) =>
            setMaxHandoffs(
              Math.min(5, Math.max(1, Number.parseInt(event.target.value, 10) || 3))
            )
          }
        />
        <p className="mode-help">Swarm agents can hand off to each other up to this limit.</p>
      </section>
    </>
  )
}
