import { Button, Flex, TextArea } from '@radix-ui/themes'
import { useRun } from '../hooks/useRun'
import type { RunPayload } from '../lib/types'

interface PromptBarProps {
  prompt: string
  onPromptChange: (value: string) => void
  buildPayload: () => RunPayload | null
  onRunTriggered?: () => void
}

export default function PromptBar({
  prompt,
  onPromptChange,
  buildPayload,
  onRunTriggered,
}: PromptBarProps): JSX.Element {
  const { startRun, cancelRun, isRunning } = useRun()

  function handleRun(): void {
    const payload = buildPayload()
    if (!payload) return
    onRunTriggered?.()
    startRun(payload)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleRun()
    }
  }

  return (
    <div className="prompt-bar">
      <div className="prompt-header">
        <h2>Prompt</h2>
        <span>Cmd/Ctrl + Enter to run</span>
      </div>
      <Flex gap="3" direction="column" style={{ width: '100%', minWidth: 0 }}>
        <TextArea
          id="prompt"
          placeholder="Describe the task clearly, include constraints, desired format, and any context."
          autoComplete="off"
          rows={8}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Flex justify="end">
          {isRunning ? (
            <Button id="cancel-run" size="3" color="red" variant="soft" onClick={cancelRun}>
              Cancel Run
            </Button>
          ) : (
            <Button id="run" size="3" onClick={handleRun}>
              Run
            </Button>
          )}
        </Flex>
      </Flex>
    </div>
  )
}
