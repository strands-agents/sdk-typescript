import { describe, it, expect } from 'vitest'
import * as SDK from '../index'

describe('index', () => {
  describe('when importing from main entry point', () => {
    it('exports error classes', () => {
      expect(SDK.ContextWindowOverflowError).toBeDefined()
    })

    it('exports BedrockModelProvider', () => {
      expect(SDK.BedrockModelProvider).toBeDefined()
    })

    it('can instantiate BedrockModelProvider', () => {
      const provider = new SDK.BedrockModelProvider({ region: 'us-west-2' })
      expect(provider).toBeInstanceOf(SDK.BedrockModelProvider)
      expect(provider.getConfig()).toBeDefined()
    })

    it('exports all required types', () => {
      // This test ensures all type exports compile correctly
      // If any exports are missing, TypeScript will error
      const _typeCheck: {
        // Error types
        contextError: typeof SDK.ContextWindowOverflowError
        // Model provider
        provider: typeof SDK.BedrockModelProvider
      } = {
        contextError: SDK.ContextWindowOverflowError,
        provider: SDK.BedrockModelProvider,
      }
      expect(_typeCheck).toBeDefined()
    })
  })
})
