import { describe, it, expect, vi } from 'vitest'
import { DefaultOutputter } from '../outputter.js'
import type { AgentStreamEvent } from '../streaming.js'

describe('DefaultOutputter', () => {
  describe('constructor', () => {
    it('creates instance with appender function', () => {
      const appender = vi.fn()
      const outputter = new DefaultOutputter(appender)
      expect(outputter).toBeDefined()
    })
  })

  describe('write', () => {
    it('calls appender with content', () => {
      const appender = vi.fn()
      const outputter = new DefaultOutputter(appender)

      outputter.write('test content')

      expect(appender).toHaveBeenCalledWith('test content')
      expect(appender).toHaveBeenCalledTimes(1)
    })

    it('calls appender multiple times for multiple writes', () => {
      const appender = vi.fn()
      const outputter = new DefaultOutputter(appender)

      outputter.write('first')
      outputter.write('second')

      expect(appender).toHaveBeenCalledTimes(2)
      expect(appender).toHaveBeenNthCalledWith(1, 'first')
      expect(appender).toHaveBeenNthCalledWith(2, 'second')
    })
  })

  describe('processEvent', () => {
    describe('text delta events', () => {
      it('outputs text delta immediately', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        const event: AgentStreamEvent = {
          type: 'modelContentBlockDeltaEvent',
          delta: {
            type: 'textDelta',
            text: 'Hello world',
          },
        }

        outputter.processEvent(event)

        expect(appender).toHaveBeenCalledWith('Hello world')
      })

      it('streams multiple text deltas', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: 'Hello ' },
        })
        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: 'world' },
        })

        expect(appender).toHaveBeenCalledTimes(2)
        expect(appender).toHaveBeenNthCalledWith(1, 'Hello ')
        expect(appender).toHaveBeenNthCalledWith(2, 'world')
      })

      it('handles empty text delta', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: '' },
        })

        expect(appender).not.toHaveBeenCalled()
      })
    })

    describe('reasoning delta events', () => {
      it('wraps reasoning content in tags', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        // Start reasoning block
        outputter.processEvent({
          type: 'modelContentBlockStartEvent',
        })

        // Reasoning delta
        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: {
            type: 'reasoningContentDelta',
            text: 'thinking...',
          },
        })

        // End reasoning block
        outputter.processEvent({
          type: 'modelContentBlockStopEvent',
        })

        expect(appender).toHaveBeenCalledTimes(3)
        expect(appender).toHaveBeenNthCalledWith(1, '<reason>')
        expect(appender).toHaveBeenNthCalledWith(2, 'thinking...')
        expect(appender).toHaveBeenNthCalledWith(3, '</reason>')
      })

      it('streams multiple reasoning deltas', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        outputter.processEvent({
          type: 'modelContentBlockStartEvent',
        })

        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'reasoningContentDelta', text: 'First ' },
        })
        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'reasoningContentDelta', text: 'thought' },
        })

        outputter.processEvent({
          type: 'modelContentBlockStopEvent',
        })

        expect(appender).toHaveBeenCalledTimes(4)
        expect(appender).toHaveBeenNthCalledWith(1, '<reason>')
        expect(appender).toHaveBeenNthCalledWith(2, 'First ')
        expect(appender).toHaveBeenNthCalledWith(3, 'thought')
        expect(appender).toHaveBeenNthCalledWith(4, '</reason>')
      })

      it('handles reasoning delta without text field', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        outputter.processEvent({
          type: 'modelContentBlockStartEvent',
        })

        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'reasoningContentDelta' },
        })

        outputter.processEvent({
          type: 'modelContentBlockStopEvent',
        })

        // Should still output tags but no content
        expect(appender).toHaveBeenCalledTimes(2)
        expect(appender).toHaveBeenNthCalledWith(1, '<reason>')
        expect(appender).toHaveBeenNthCalledWith(2, '</reason>')
      })

      it('handles empty reasoning text', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        outputter.processEvent({
          type: 'modelContentBlockStartEvent',
        })

        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'reasoningContentDelta', text: '' },
        })

        outputter.processEvent({
          type: 'modelContentBlockStopEvent',
        })

        expect(appender).toHaveBeenCalledTimes(2)
        expect(appender).toHaveBeenNthCalledWith(1, '<reason>')
        expect(appender).toHaveBeenNthCalledWith(2, '</reason>')
      })
    })

    describe('tool execution events', () => {
      it('outputs tool start message', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        outputter.processEvent({
          type: 'modelContentBlockStartEvent',
          start: {
            type: 'toolUseStart',
            name: 'calculator',
            toolUseId: 'tool-1',
          },
        })

        expect(appender).toHaveBeenCalledWith('\n🔧 Tool #1: calculator\n')
      })

      it('increments tool count for multiple tools', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        outputter.processEvent({
          type: 'modelContentBlockStartEvent',
          start: {
            type: 'toolUseStart',
            name: 'calculator',
            toolUseId: 'tool-1',
          },
        })

        outputter.processEvent({
          type: 'modelContentBlockStartEvent',
          start: {
            type: 'toolUseStart',
            name: 'weather',
            toolUseId: 'tool-2',
          },
        })

        expect(appender).toHaveBeenCalledTimes(2)
        expect(appender).toHaveBeenNthCalledWith(1, '\n🔧 Tool #1: calculator\n')
        expect(appender).toHaveBeenNthCalledWith(2, '\n🔧 Tool #2: weather\n')
      })

      it('outputs tool completion message', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        outputter.processEvent({
          type: 'toolResultBlock',
          toolUseId: 'tool-1',
          status: 'success',
          content: [],
        })

        expect(appender).toHaveBeenCalledWith('✓ Tool completed\n')
      })

      it('outputs error status for failed tool', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        outputter.processEvent({
          type: 'toolResultBlock',
          toolUseId: 'tool-1',
          status: 'error',
          content: [],
        })

        expect(appender).toHaveBeenCalledWith('✗ Tool failed\n')
      })
    })

    describe('other event types', () => {
      it('ignores beforeModelEvent', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        outputter.processEvent({
          type: 'beforeModelEvent',
          messages: [],
        })

        expect(appender).not.toHaveBeenCalled()
      })

      it('ignores afterModelEvent', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        outputter.processEvent({
          type: 'afterModelEvent',
          message: {} as any,
          stopReason: 'endTurn',
        })

        expect(appender).not.toHaveBeenCalled()
      })

      it('ignores modelMessageStartEvent', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        outputter.processEvent({
          type: 'modelMessageStartEvent',
          role: 'assistant',
        })

        expect(appender).not.toHaveBeenCalled()
      })

      it('ignores toolUseInputDelta', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: {
            type: 'toolUseInputDelta',
            input: '{"value": 1}',
          },
        })

        expect(appender).not.toHaveBeenCalled()
      })
    })

    describe('state tracking', () => {
      it('tracks reasoning block state correctly', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        // Start reasoning block
        outputter.processEvent({
          type: 'modelContentBlockStartEvent',
        })

        // Reasoning content
        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'reasoningContentDelta', text: 'thinking' },
        })

        // End reasoning block
        outputter.processEvent({
          type: 'modelContentBlockStopEvent',
        })

        // Start new reasoning block
        outputter.processEvent({
          type: 'modelContentBlockStartEvent',
        })

        // New reasoning content
        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'reasoningContentDelta', text: 'more thinking' },
        })

        // End new reasoning block
        outputter.processEvent({
          type: 'modelContentBlockStopEvent',
        })

        expect(appender).toHaveBeenCalledTimes(6)
        expect(appender).toHaveBeenNthCalledWith(1, '<reason>')
        expect(appender).toHaveBeenNthCalledWith(2, 'thinking')
        expect(appender).toHaveBeenNthCalledWith(3, '</reason>')
        expect(appender).toHaveBeenNthCalledWith(4, '<reason>')
        expect(appender).toHaveBeenNthCalledWith(5, 'more thinking')
        expect(appender).toHaveBeenNthCalledWith(6, '</reason>')
      })

      it('maintains tool count across multiple invocations', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        // Use three tools
        for (let i = 1; i <= 3; i++) {
          outputter.processEvent({
            type: 'modelContentBlockStartEvent',
            start: {
              type: 'toolUseStart',
              name: `tool${i}`,
              toolUseId: `tool-${i}`,
            },
          })
        }

        expect(appender).toHaveBeenCalledTimes(3)
        expect(appender).toHaveBeenNthCalledWith(1, '\n🔧 Tool #1: tool1\n')
        expect(appender).toHaveBeenNthCalledWith(2, '\n🔧 Tool #2: tool2\n')
        expect(appender).toHaveBeenNthCalledWith(3, '\n🔧 Tool #3: tool3\n')
      })
    })

    describe('complex scenarios', () => {
      it('handles mixed text and reasoning in sequence', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        // Text
        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: 'Hello' },
        })

        // Reasoning block
        outputter.processEvent({
          type: 'modelContentBlockStartEvent',
        })
        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'reasoningContentDelta', text: 'thinking' },
        })
        outputter.processEvent({
          type: 'modelContentBlockStopEvent',
        })

        // More text
        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: 'World' },
        })

        expect(appender).toHaveBeenCalledTimes(5)
        expect(appender).toHaveBeenNthCalledWith(1, 'Hello')
        expect(appender).toHaveBeenNthCalledWith(2, '<reason>')
        expect(appender).toHaveBeenNthCalledWith(3, 'thinking')
        expect(appender).toHaveBeenNthCalledWith(4, '</reason>')
        expect(appender).toHaveBeenNthCalledWith(5, 'World')
      })

      it('handles tool use with text output', () => {
        const appender = vi.fn()
        const outputter = new DefaultOutputter(appender)

        // Tool start
        outputter.processEvent({
          type: 'modelContentBlockStartEvent',
          start: {
            type: 'toolUseStart',
            name: 'calculator',
            toolUseId: 'tool-1',
          },
        })

        // Tool result
        outputter.processEvent({
          type: 'toolResultBlock',
          toolUseId: 'tool-1',
          status: 'success',
          content: [],
        })

        // Text response
        outputter.processEvent({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: 'The answer is 42' },
        })

        expect(appender).toHaveBeenCalledTimes(3)
        expect(appender).toHaveBeenNthCalledWith(1, '\n🔧 Tool #1: calculator\n')
        expect(appender).toHaveBeenNthCalledWith(2, '✓ Tool completed\n')
        expect(appender).toHaveBeenNthCalledWith(3, 'The answer is 42')
      })
    })
  })
})
