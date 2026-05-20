/**
 * Judge primitives for the goal plugin's natural-language validator. Re-exported
 * from `index.ts` so users can build a custom judge through a function validator
 * while reusing the same outcome schema, system prompt, or transcript format.
 */

import { z } from 'zod'
import type { Message } from '../../types/messages.js'

/**
 * Structured outcome the judge agent fills via the `strands_structured_output`
 * tool. Pass this to a custom judge `Agent` via `structuredOutputSchema` to
 * mirror the shape `GoalLoop` expects from `validate`.
 */
export const JUDGE_OUTCOME_SCHEMA = z.object({
  passed: z.boolean().describe('True iff the response fully satisfies the criteria.'),
  feedback: z.string().optional().describe('Concrete, actionable feedback for the next attempt. One paragraph.'),
})

/**
 * System prompt for the auto-built judge agent. Pass to a custom judge `Agent`
 * to inherit the strict, structured-output-only evaluation behavior, or use as
 * a starting point for a tuned variant.
 */
export const JUDGE_SYSTEM_PROMPT = `You evaluate whether an agent's response satisfies a stated goal.
You see the goal description and the full conversation transcript.
Reply only via the strands_structured_output tool.
Be strict: only set passed=true when every part of the criteria is met.`

/**
 * Builds the judge's user prompt: the goal description plus a serialised
 * transcript of the working agent's conversation. Mirrors `/goal`'s
 * "evaluator sees the full transcript" semantics.
 *
 * Tool calls and results are summarised inline so the judge can grade goals
 * that depend on tool behaviour (e.g. "did the agent run the tests and act on
 * the failures?"). Without this, a tool-using agent's transcript would look
 * empty to the judge whenever the model's text output was sparse.
 *
 * @param description - Natural-language goal the judge evaluates against.
 * @param transcript - Working agent's conversation messages.
 * @returns Composed prompt string ready to feed to a judge `Agent.invoke`.
 */
export function buildJudgePrompt(description: string, transcript: readonly Message[]): string {
  const lines = transcript
    .map((message) => {
      const parts = message.content.flatMap((block) => {
        if (block.type === 'textBlock') return [block.text]
        if (block.type === 'toolUseBlock') {
          return [`[tool-call: ${block.name}] input=${truncate(JSON.stringify(block.input))}`]
        }
        if (block.type === 'toolResultBlock') {
          const text = block.content
            .flatMap((inner) =>
              inner.type === 'textBlock' ? [inner.text] : inner.type === 'jsonBlock' ? [JSON.stringify(inner.json)] : []
            )
            .join(' ')
          return [`[tool-result: ${block.status}] ${truncate(text)}`]
        }
        return []
      })
      return `[${message.role}]\n${parts.join('\n')}`
    })
    .join('\n\n')
  return `Goal:\n${description}\n\nConversation transcript:\n${lines}`
}

/** Trims long tool inputs/outputs so a single tool call can't dominate the judge prompt. */
function truncate(text: string, max = 500): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [${text.length - max} more chars]`
}
