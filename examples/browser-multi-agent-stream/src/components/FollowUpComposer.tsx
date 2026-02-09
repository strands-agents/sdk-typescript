import { Button, TextArea } from '@radix-ui/themes'
import { useMemo, useState } from 'react'
import { useRun } from '../hooks/useRun'
import { FOLLOW_UP_SUGGESTIONS } from '../lib/constants'
import type { RunMode, RunPayload } from '../lib/types'

interface FollowUpComposerProps {
  isRunning: boolean
  presetKey: string
  mode: RunMode
  hasSession: boolean
  onPromptCommitted: (prompt: string) => void
  buildPayloadForPrompt: (prompt: string) => RunPayload | null
}

function modeLabel(mode: RunMode): string {
  if (mode === 'single') return 'single'
  if (mode === 'graph') return 'graph'
  return 'swarm'
}

export default function FollowUpComposer({
  isRunning,
  presetKey,
  mode,
  hasSession,
  onPromptCommitted,
  buildPayloadForPrompt,
}: FollowUpComposerProps): JSX.Element {
  const [followUpPrompt, setFollowUpPrompt] = useState('')
  const { startRun, cancelRun } = useRun()
  const trimmed = followUpPrompt.trim()
  const suggestions = useMemo(() => {
    const out: string[] = []
    const seen = new Set<string>()
    const buckets = [
      FOLLOW_UP_SUGGESTIONS[presetKey] ?? [],
      hasSession ? FOLLOW_UP_SUGGESTIONS.session_context ?? [] : [],
      FOLLOW_UP_SUGGESTIONS[`mode:${mode}`] ?? [],
    ]
    for (const bucket of buckets) {
      for (const suggestion of bucket) {
        if (seen.has(suggestion)) continue
        seen.add(suggestion)
        out.push(suggestion)
        if (out.length >= 4) return out
      }
    }
    return out
  }, [hasSession, mode, presetKey])

  async function submitFollowUp(): Promise<void> {
    if (trimmed === '') return
    const payload = buildPayloadForPrompt(trimmed)
    if (!payload) return
    onPromptCommitted(trimmed)
    setFollowUpPrompt('')
    await startRun(payload)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void submitFollowUp()
    }
  }

  function applySuggestion(nextPrompt: string): void {
    setFollowUpPrompt((prev) => {
      const existing = prev.trim()
      if (existing === '') return nextPrompt
      return `${existing}\n${nextPrompt}`
    })
  }

  return (
    <section className="follow-up-composer">
      <div className="follow-up-header">
        <div>
          <h3>Follow-up Prompt</h3>
          <p>Continue this workflow without leaving Output.</p>
        </div>
        <div className="follow-up-badges">
          <span className="follow-up-badge">{modeLabel(mode)}</span>
          <span className="follow-up-badge">{hasSession ? 'session on' : 'session off'}</span>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="follow-up-suggestions" aria-label="Suggested follow-up prompts">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="follow-up-suggestion-chip"
              onClick={() => applySuggestion(suggestion)}
              disabled={isRunning}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <TextArea
        rows={3}
        value={followUpPrompt}
        onChange={(event) => setFollowUpPrompt(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask a follow-up, provide steering guidance, or continue the task…"
      />
      <div className="follow-up-actions">
        <span>Cmd/Ctrl + Enter to run</span>
        {isRunning ? (
          <Button size="2" color="red" variant="soft" onClick={cancelRun}>
            Cancel Run
          </Button>
        ) : (
          <Button size="2" onClick={() => void submitFollowUp()} disabled={trimmed === ''}>
            Run Follow-up
          </Button>
        )}
      </div>
    </section>
  )
}
