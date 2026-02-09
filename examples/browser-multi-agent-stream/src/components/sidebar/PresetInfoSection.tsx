import { Button } from '@radix-ui/themes'
import type { PresetGuide } from '../../lib/types'

interface StructuredSchemaDisplay {
  label: string
  summary: string
  schema: Record<string, unknown>
  example: Record<string, unknown>
}

interface PresetInfoSectionProps {
  presetKey: string
  activePresetLabel: string
  guide?: PresetGuide
  activeStructuredSchema?: StructuredSchemaDisplay
  onResetPreset: (presetKey: string) => void
}

export default function PresetInfoSection({
  presetKey,
  activePresetLabel,
  guide,
  activeStructuredSchema,
  onResetPreset,
}: PresetInfoSectionProps): JSX.Element {
  return (
    <>
      <section className="setup-heading">
        <h2>Setup</h2>
        <p>Review the active preset, tune orchestration mode, then customize agents.</p>
      </section>
      <section className="presets-section">
        <div className="active-preset-row">
          <div>
            <label>Active preset</label>
            <strong className="active-preset-name">{activePresetLabel}</strong>
          </div>
          <Button size="2" variant="soft" onClick={() => onResetPreset(presetKey)}>
            Reset preset
          </Button>
        </div>
      </section>
      {guide && (
        <section className="preset-guide">
          <div className="preset-guide-feature">{guide.feature}</div>
          <p className="preset-guide-summary">{guide.summary}</p>
          <ol className="preset-guide-steps">
            {guide.steps.map((step, index) => (
              <li key={`${presetKey}-step-${index}`}>{step}</li>
            ))}
          </ol>
        </section>
      )}
      {activeStructuredSchema && (
        <section className="structured-schema-panel">
          <div className="structured-schema-head">
            <strong>Structured Output Schema</strong>
            <span>{activeStructuredSchema.label}</span>
          </div>
          <p className="structured-schema-summary">{activeStructuredSchema.summary}</p>
          <label>Schema</label>
          <pre className="structured-schema-pre">
            {JSON.stringify(activeStructuredSchema.schema, null, 2)}
          </pre>
          <label>Example</label>
          <pre className="structured-schema-pre">
            {JSON.stringify(activeStructuredSchema.example, null, 2)}
          </pre>
        </section>
      )}
    </>
  )
}
