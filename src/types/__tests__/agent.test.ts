import { describe, it, expect } from 'vitest'
import { AgentResult } from '../agent.js'
import { Message } from '../messages.js'
import { TextBlock, ReasoningBlock, ToolUseBlock, ToolResultBlock, CachePointBlock } from '../messages.js'

describe('AgentResult', () => {
  describe('toString', () => {
    describe('when content is empty', () => {
      it('returns empty string', () => {
        const message = new Message({
          role: 'assistant',
          content: [],
        })

        const result = new AgentResult({
          stopReason: 'endTurn',
          lastMessage: message,
        })

        expect(result.toString()).toBe('')
      })
    })

    describe('when content has single TextBlock', () => {
      it('returns the text content', () => {
        const message = new Message({
          role: 'assistant',
          content: [new TextBlock('Hello, world!')],
        })

        const result = new AgentResult({
          stopReason: 'endTurn',
          lastMessage: message,
        })

        expect(result.toString()).toBe('Hello, world!')
      })
    })

    describe('when content has multiple TextBlocks', () => {
      it('returns all text joined with newlines', () => {
        const message = new Message({
          role: 'assistant',
          content: [new TextBlock('First line'), new TextBlock('Second line'), new TextBlock('Third line')],
        })

        const result = new AgentResult({
          stopReason: 'endTurn',
          lastMessage: message,
        })

        expect(result.toString()).toBe('First line\nSecond line\nThird line')
      })
    })

    describe('when content has ReasoningBlock with text', () => {
      it('returns the reasoning text with prefix', () => {
        const message = new Message({
          role: 'assistant',
          content: [new ReasoningBlock({ text: 'Let me think about this...' })],
        })

        const result = new AgentResult({
          stopReason: 'endTurn',
          lastMessage: message,
        })

        expect(result.toString()).toBe('💭 Reasoning:\n   Let me think about this...')
      })
    })

    describe('when content has ReasoningBlock without text', () => {
      it('returns empty string (reasoning block is skipped)', () => {
        const message = new Message({
          role: 'assistant',
          content: [new ReasoningBlock({ signature: 'abc123' })],
        })

        const result = new AgentResult({
          stopReason: 'endTurn',
          lastMessage: message,
        })

        expect(result.toString()).toBe('')
      })
    })

    describe('when content has mixed TextBlock and ReasoningBlock', () => {
      it('returns all text joined with newlines', () => {
        const message = new Message({
          role: 'assistant',
          content: [
            new TextBlock('Here is my response.'),
            new ReasoningBlock({ text: 'I reasoned carefully.' }),
            new TextBlock('Additional context.'),
          ],
        })

        const result = new AgentResult({
          stopReason: 'endTurn',
          lastMessage: message,
        })

        expect(result.toString()).toBe(
          'Here is my response.\n💭 Reasoning:\n   I reasoned carefully.\nAdditional context.'
        )
      })
    })

    describe('when content has only non-text blocks', () => {
      it('returns empty string', () => {
        const message = new Message({
          role: 'assistant',
          content: [
            new ToolUseBlock({ name: 'calc', toolUseId: 'id-1', input: { a: 1, b: 2 } }),
            new ToolResultBlock({
              toolUseId: 'id-1',
              status: 'success',
              content: [new TextBlock('3')],
            }),
            new CachePointBlock({ cacheType: 'default' }),
          ],
        })

        const result = new AgentResult({
          stopReason: 'toolUse',
          lastMessage: message,
        })

        expect(result.toString()).toBe('')
      })
    })

    describe('when content has mixed text and non-text blocks', () => {
      it('returns only text from TextBlock and ReasoningBlock', () => {
        const message = new Message({
          role: 'assistant',
          content: [
            new TextBlock('Before tool'),
            new ToolUseBlock({ name: 'calc', toolUseId: 'id-1', input: { a: 1, b: 2 } }),
            new ReasoningBlock({ text: 'Thinking...' }),
            new CachePointBlock({ cacheType: 'default' }),
            new TextBlock('After tool'),
          ],
        })

        const result = new AgentResult({
          stopReason: 'toolUse',
          lastMessage: message,
        })

        expect(result.toString()).toBe('Before tool\n💭 Reasoning:\n   Thinking...\nAfter tool')
      })
    })

    describe('when called implicitly', () => {
      it('works with String() conversion', () => {
        const message = new Message({
          role: 'assistant',
          content: [new TextBlock('Hello')],
        })

        const result = new AgentResult({
          stopReason: 'endTurn',
          lastMessage: message,
        })

        expect(String(result)).toBe('Hello')
      })

      it('works with template literals', () => {
        const message = new Message({
          role: 'assistant',
          content: [new TextBlock('World')],
        })

        const result = new AgentResult({
          stopReason: 'endTurn',
          lastMessage: message,
        })

        expect(`Response: ${result}`).toBe('Response: World')
      })

      it('when structuredOutput is present returns JSON string of structured output', () => {
        const message = new Message({
          role: 'assistant',
          content: [new TextBlock('Ignore this text')],
        })
        const structuredOutput = { name: 'Jane', age: 30 }

        const result = new AgentResult({
          stopReason: 'endTurn',
          lastMessage: message,
          structuredOutput,
        })

        expect(result.structuredOutput).toStrictEqual(structuredOutput)
        expect(String(result)).toBe(JSON.stringify(structuredOutput))
      })
    })
  })

  describe('metrics', () => {
    it('defaults to undefined when not provided', () => {
      const message = new Message({ role: 'assistant', content: [new TextBlock('Hi')] })

      const result = new AgentResult({ stopReason: 'endTurn', lastMessage: message })

      expect(result.metrics).toBeUndefined()
    })

    it('stores metrics when provided', () => {
      const message = new Message({ role: 'assistant', content: [new TextBlock('Hi')] })
      const metrics = {
        accumulatedUsage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
        accumulatedMetrics: { latencyMs: 200 },
      }

      const result = new AgentResult({ stopReason: 'endTurn', lastMessage: message, metrics })

      expect(result.metrics).toStrictEqual(metrics)
    })
  })

  describe('interrupts', () => {
    it('defaults to empty array when not provided', () => {
      const message = new Message({ role: 'assistant', content: [new TextBlock('Hi')] })

      const result = new AgentResult({ stopReason: 'endTurn', lastMessage: message })

      expect(result.interrupts).toStrictEqual([])
    })

    it('stores interrupts when provided', async () => {
      const message = new Message({ role: 'assistant', content: [new TextBlock('Hi')] })
      const { Interrupt } = await import('../../interrupt.js')
      const interrupts = [new Interrupt({ id: 'int-1', name: 'approval', reason: 'Need approval' })]

      const result = new AgentResult({ stopReason: 'endTurn', lastMessage: message, interrupts })

      expect(result.interrupts).toHaveLength(1)
      expect(result.interrupts[0]!.id).toBe('int-1')
      expect(result.interrupts[0]!.name).toBe('approval')
    })
  })
})
