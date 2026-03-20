import { describe, it, expect } from 'vitest'
import * as SDK from '../index.js'

describe('index', () => {
  describe('when importing from main entry point', () => {
    it('exports error classes', () => {
      expect(SDK.ContextWindowOverflowError).toBeDefined()
    })

    it('exports ConverseModel', () => {
      expect(SDK.ConverseModel).toBeDefined()
    })

    it('can instantiate ConverseModel', () => {
      const provider = new SDK.ConverseModel({ region: 'us-west-2' })
      expect(provider).toBeInstanceOf(SDK.ConverseModel)
      expect(provider.getConfig()).toBeDefined()
    })

    it('exports all required types', () => {
      // This test ensures all type exports compile correctly
      // If any exports are missing, TypeScript will error
      const _typeCheck: {
        // Error types
        contextError: typeof SDK.ContextWindowOverflowError
        // Model provider
        provider: typeof SDK.ConverseModel
      } = {
        contextError: SDK.ContextWindowOverflowError,
        provider: SDK.ConverseModel,
      }
      expect(_typeCheck).toBeDefined()
    })

    it('exports streaming event classes as values, not just types', () => {
      // Regression: these must be value exports (not `export type`) so they
      // survive TypeScript type-erasure and can be used with `instanceof` /
      // `new` at runtime.
      expect(SDK.ToolStreamEvent).toBeDefined()
      expect(SDK.ModelMessageStartEvent).toBeDefined()
      expect(SDK.ModelContentBlockStartEvent).toBeDefined()
      expect(SDK.ModelContentBlockDeltaEvent).toBeDefined()
      expect(SDK.ModelContentBlockStopEvent).toBeDefined()
      expect(SDK.ModelMessageStopEvent).toBeDefined()
      expect(SDK.ModelMetadataEvent).toBeDefined()
      expect(SDK.ModelRedactionEvent).toBeDefined()
    })

    it('can instantiate exported streaming event classes', () => {
      const toolEvent = new SDK.ToolStreamEvent({ data: 'test' })
      expect(toolEvent).toBeInstanceOf(SDK.ToolStreamEvent)
      expect(toolEvent.type).toBe('toolStreamEvent')

      const msgStart = new SDK.ModelMessageStartEvent({ type: 'modelMessageStartEvent', role: 'assistant' })
      expect(msgStart).toBeInstanceOf(SDK.ModelMessageStartEvent)
      expect(msgStart.type).toBe('modelMessageStartEvent')
    })
  })
})
