import { describe, it, expect } from 'vitest'
import type { ModelProviderStreamEvent } from '@/models/streaming'

describe('streaming events', () => {
  describe('ModelProviderStreamEvent type narrowing', () => {
    it('narrows type for modelMessageStartEvent', () => {
      const event: ModelProviderStreamEvent = {
        type: 'modelMessageStartEvent',
        role: 'assistant',
      }

      if (event.type === 'modelMessageStartEvent') {
        expect(event.role).toBe('assistant')
      }
    })

    it('narrows type for modelContentBlockDeltaEvent with text delta', () => {
      const event: ModelProviderStreamEvent = {
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'text', text: 'Hello' },
      }

      if (event.type === 'modelContentBlockDeltaEvent') {
        expect(event.delta).toBeDefined()
        if (event.delta.type === 'text') {
          expect(event.delta.text).toBe('Hello')
        }
      }
    })

    it('narrows type for modelMessageStopEvent', () => {
      const event: ModelProviderStreamEvent = {
        type: 'modelMessageStopEvent',
        stopReason: 'endTurn',
      }

      if (event.type === 'modelMessageStopEvent') {
        expect(event.stopReason).toBe('endTurn')
      }
    })
  })
})
