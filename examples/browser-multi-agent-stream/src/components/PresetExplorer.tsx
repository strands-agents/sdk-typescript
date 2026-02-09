import { Button, TextField } from '@radix-ui/themes'
import { useMemo, useState } from 'react'
import { PRESET_CATALOG } from '../lib/constants'
import type { RunMode } from '../lib/types'

interface PresetExplorerProps {
  presetKey: string
  currentMode: RunMode
  onApplyPreset: (presetKey: string) => void
  onStartCustomSetup: (mode: RunMode) => void
}

export default function PresetExplorer({
  presetKey,
  currentMode,
  onApplyPreset,
  onStartCustomSetup,
}: PresetExplorerProps): JSX.Element {
  const [query, setQuery] = useState('')

  const filteredPresets = useMemo(() => {
    const search = query.trim().toLowerCase()
    if (!search) return PRESET_CATALOG
    return PRESET_CATALOG.filter((preset) => {
      return (
        preset.label.toLowerCase().includes(search) ||
        preset.feature.toLowerCase().includes(search) ||
        preset.summary.toLowerCase().includes(search) ||
        preset.mode.toLowerCase().includes(search)
      )
    })
  }, [query])

  return (
    <section className="preset-explorer">
      <header className="preset-explorer-header">
        <div>
          <h2>Preset Library</h2>
          <p>Browse guided examples, apply one, then customize setup below before you run.</p>
        </div>
        <div className="preset-explorer-search">
          <TextField.Root
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search presets"
            aria-label="Search presets"
          />
        </div>
      </header>
      {filteredPresets.length === 0 ? (
        <div className="preset-explorer-empty">No presets match your search.</div>
      ) : (
        <>
          <div className="preset-explorer-grid">
            {filteredPresets.map((preset) => {
              const isActive = preset.key === presetKey
              return (
                <article key={preset.key} className={`preset-card ${isActive ? 'active' : ''}`}>
                  <div className="preset-card-head">
                    <h3>{preset.label}</h3>
                    <span className={`preset-card-mode mode-${preset.mode}`}>{preset.mode}</span>
                  </div>
                  <p className="preset-card-summary">{preset.summary}</p>
                  <div className="preset-card-meta">
                    <span>{preset.feature}</span>
                    <span>{preset.agentCount} agents</span>
                    {preset.hasStructuredOutput && <span>structured output</span>}
                  </div>
                  <Button
                    type="button"
                    size="2"
                    variant={isActive ? 'solid' : 'soft'}
                    onClick={() => onApplyPreset(preset.key)}
                  >
                    {isActive ? 'Active preset' : 'Use preset'}
                  </Button>
                </article>
              )
            })}
          </div>
          <section className={`custom-setup-card ${presetKey === 'custom' ? 'active' : ''}`}>
            <div className="custom-setup-head">
              <h3>Custom Setup</h3>
              {presetKey === 'custom' && <span className="custom-setup-active">active</span>}
            </div>
            <p>Start a mode-specific workflow with fully editable configuration.</p>
            <div className="custom-setup-modes">
              <Button
                type="button"
                size="2"
                variant={presetKey === 'custom' && currentMode === 'single' ? 'solid' : 'soft'}
                onClick={() => onStartCustomSetup('single')}
              >
                Single
              </Button>
              <Button
                type="button"
                size="2"
                variant={presetKey === 'custom' && currentMode === 'swarm' ? 'solid' : 'soft'}
                onClick={() => onStartCustomSetup('swarm')}
              >
                Swarm
              </Button>
            </div>
          </section>
        </>
      )}
    </section>
  )
}
