/**
 * Integration tests for GoalPlugin.
 *
 * Design principle: assertions must be deterministic regardless of model
 * output. We never assert "the model produced X" — only structural properties
 * we control via the validator (it's user code, fully deterministic). The
 * model's role here is to produce *some* assistant turn so the plugin's
 * machinery (validation, resume, snapshot/restore) executes against a real
 * agent loop end-to-end.
 */

import { describe, expect, it } from 'vitest'
import { Agent } from '$/sdk/index.js'
import { GoalPlugin } from '$/sdk/vended-plugins/goal/index.js'
import { bedrock } from '../__fixtures__/model-providers.js'

describe.skipIf(bedrock.skip)('GoalPlugin Integration', () => {
  const createModel = (): ReturnType<typeof bedrock.createModel> => bedrock.createModel({ maxTokens: 512 })

  describe('standard refinement loop', () => {
    it('runs N attempts, accumulates feedback in the transcript, surfaces lastResult', async () => {
      // Force exactly 2 attempts: fail the first, pass the second. The
      // validator is user code so the loop length is deterministic regardless
      // of what the model emits.
      let calls = 0
      const plugin = new GoalPlugin({
        name: 'integ-standard',
        validate: () => {
          calls++
          if (calls === 1) return { passed: false, feedback: 'TRIGGER_RETRY_MARKER' }
          return true
        },
        maxAttempts: 5,
      })

      const agent = new Agent({ model: createModel(), plugins: [plugin], printer: false })
      await agent.invoke('Say hello.')

      expect(plugin.lastResult?.passed).toBe(true)
      expect(plugin.lastResult?.stopReason).toBe('satisfied')
      expect(plugin.lastResult?.attempts).toHaveLength(2)
      expect(plugin.lastResult?.attempts[0]?.feedback).toBe('TRIGGER_RETRY_MARKER')

      // Standard mode keeps both assistant turns in the transcript and the
      // validator feedback is surfaced as a user message between them.
      const roles = agent.messages.map((m) => m.role)
      expect(roles).toEqual(['user', 'assistant', 'user', 'assistant'])
      const userTexts = agent.messages
        .filter((m) => m.role === 'user')
        .flatMap((m) => m.content)
        .flatMap((b) => (b.type === 'textBlock' ? [b.text] : []))
      expect(userTexts.some((t) => t.includes('TRIGGER_RETRY_MARKER'))).toBe(true)
    }, 120_000)
  })

  describe('freshContextPerAttempt (Ralph loop)', () => {
    it('restores transcript between attempts; only the final assistant turn survives', async () => {
      // Force 3 attempts: fail twice, pass third.
      let calls = 0
      const plugin = new GoalPlugin({
        name: 'integ-fresh-context',
        validate: () => {
          calls++
          if (calls < 3) return { passed: false, feedback: `force-retry-${calls}` }
          return true
        },
        maxAttempts: 5,
        freshContextPerAttempt: true,
      })

      const agent = new Agent({ model: createModel(), plugins: [plugin], printer: false })
      await agent.invoke('Say hello.')

      expect(plugin.lastResult?.passed).toBe(true)
      expect(plugin.lastResult?.stopReason).toBe('satisfied')
      expect(plugin.lastResult?.attempts).toHaveLength(3)

      // The defining property of fresh-context mode: every failed attempt's
      // assistant turn was popped on restart, so only the final successful
      // attempt's assistant turn remains in the transcript.
      const assistantTurns = agent.messages.filter((m) => m.role === 'assistant')
      expect(assistantTurns).toHaveLength(1)

      // Transcript shape for the satisfied final attempt: original input,
      // then the latest validator feedback as a fresh user message, then the
      // assistant's successful reply.
      const roles = agent.messages.map((m) => m.role)
      expect(roles).toEqual(['user', 'user', 'assistant'])
    }, 180_000)
  })
})
