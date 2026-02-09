import { Button, TextField } from '@radix-ui/themes'
import type { AgentLibraryEntry } from '../../lib/constants'

interface AgentLibrarySectionProps {
  agentSearch: string
  onAgentSearchChange: (value: string) => void
  filteredAgentLibrary: AgentLibraryEntry[]
  totalAgentLibraryCount: number
  canAddAgents: boolean
  onAddAgentFromLibrary: (entry: AgentLibraryEntry) => void
}

export default function AgentLibrarySection({
  agentSearch,
  onAgentSearchChange,
  filteredAgentLibrary,
  totalAgentLibraryCount,
  canAddAgents,
  onAddAgentFromLibrary,
}: AgentLibrarySectionProps): JSX.Element {
  return (
    <section className="agent-library-section">
      <div className="agent-library-header">
        <label htmlFor="agent-library-search">Agent Library</label>
        <span>
          {filteredAgentLibrary.length}/{totalAgentLibraryCount}
        </span>
      </div>
      <TextField.Root
        id="agent-library-search"
        value={agentSearch}
        onChange={(event) => onAgentSearchChange(event.target.value)}
        placeholder="Search by role, preset, tool, or prompt"
      />
      <div className="agent-library-list">
        {filteredAgentLibrary.map((entry) => (
          <article key={entry.libraryId} className="agent-library-card">
            <div className="agent-library-card-head">
              <strong>{entry.name}</strong>
              <span>{entry.sourcePresetLabel}</span>
            </div>
            <p>{entry.systemPrompt}</p>
            <div className="agent-library-meta">
              <span>{entry.sourceFeature}</span>
              <span>{entry.tools.length > 0 ? entry.tools.join(', ') : 'No tools'}</span>
            </div>
            <Button
              size="1"
              variant="soft"
              disabled={!canAddAgents}
              onClick={() => onAddAgentFromLibrary(entry)}
            >
              Add agent
            </Button>
          </article>
        ))}
      </div>
    </section>
  )
}
