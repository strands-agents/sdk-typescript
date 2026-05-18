/**
 * Internal judge primitives for the Goal plugin's natural-language validator.
 *
 * Not re-exported from the package. The shape (schema, prompt, transcript format)
 * is intentionally tweakable in one place without touching the plugin core.
 */

import { z } from 'zod'
import type { Message } from '../../types/messages.js'

/** Structured outcome the judge agent fills via the `strands_structured_output` tool. */
export const JUDGE_OUTCOME_SCHEMA = z.object({
  passed: z.boolean().describe('True iff the response fully satisfies the criteria.'),
  feedback: z.string().optional().describe('Concrete, actionable feedback for the next attempt. One paragraph.'),
})

/** System prompt for the auto-built judge agent. */
export const JUDGE_SYSTEM_PROMPT = `You evaluate whether an agent's response satisfies a stated goal.
You see the goal description and the full conversation transcript.
Reply only via the strands_structured_output tool.
Be strict: only set passed=true when every part of the criteria is met.`

/**
 * Builds the judge's user prompt: the goal description plus a serialised transcript
 * of the working agent's conversation, mirroring `/goal`'s "evaluator sees the full
 * transcript" semantics.
 */
export function buildJudgePrompt(description: string, transcript: readonly Message[]): string {
  const lines = transcript
    .map((m) => {
      const text = m.content.flatMap((b) => (b.type === 'textBlock' ? [b.text] : [])).join('\n')
      return `[${m.role}]\n${text}`
    })
    .join('\n\n')
  return `Goal:\n${description}\n\nConversation transcript:\n${lines}`
}
