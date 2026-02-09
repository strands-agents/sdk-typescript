import { Button, Flex, TextArea, TextField } from '@radix-ui/themes'
import type { AgentSpec } from '../lib/types'
import { AVAILABLE_TOOLS, MAX_SYSTEM_PROMPT } from '../lib/constants'

interface AgentCardProps {
  agent: AgentSpec
  onUpdate: (id: string, updates: Partial<Pick<AgentSpec, 'name' | 'systemPrompt' | 'tools'>>) => void
  onRemove: (id: string) => void
  canRemove: boolean
}

export default function AgentCard({ agent, onUpdate, onRemove, canRemove }: AgentCardProps): JSX.Element {
  const toolCsv = (agent.tools ?? []).join(', ')

  return (
    <div className="agent-card" data-id={agent.id}>
      <Flex gap="4" align="center" justify="between" className="agent-card-header" mb="2">
        <TextField.Root
          placeholder="Agent name"
          value={agent.name}
          
          onChange={(e) => {
            const v = e.target.value.trim() || 'agent'
            onUpdate(agent.id, { name: v })
          }}
          style={{ flex: 1 }}
        />
        <Button
          variant="soft"
          color="red"
          // size="1"
          onClick={() => onRemove(agent.id)}
          disabled={!canRemove}
        >
          Remove
        </Button>
      </Flex>
      <TextArea
        placeholder="System prompt (max 500 chars)"
        maxLength={MAX_SYSTEM_PROMPT}
        value={agent.systemPrompt}
        onChange={(e) => onUpdate(agent.id, { systemPrompt: e.target.value })}
        rows={3}
        style={{ minHeight: 60, resize: 'vertical' }}
      />
      <div className="char-count">
        {agent.systemPrompt.length}/{MAX_SYSTEM_PROMPT}
      </div>
      <TextField.Root
        placeholder={`Tools (comma-separated, 'none' for no tools). Available: ${AVAILABLE_TOOLS.join(', ')}`}
        value={toolCsv}
        onChange={(e) => {
          const raw = e.target.value.trim()
          if (raw === '') {
            onUpdate(agent.id, { tools: undefined })
            return
          }
          if (raw.toLowerCase() === 'none') {
            onUpdate(agent.id, { tools: [] })
            return
          }
          const parsed = raw
            .split(',')
            .map((tool) => tool.trim())
            .filter(Boolean)
          onUpdate(agent.id, { tools: parsed.length > 0 ? parsed : undefined })
        }}
        style={{ marginTop: '0.5rem' }}
      />
    </div>
  )
}
