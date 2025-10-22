import { describe, it, expect } from 'vitest'
import * as SDK from '../index'

describe('index', () => {
  describe('when importing from main entry point', () => {
    it('exports error classes', () => {
      expect(SDK.ContextWindowOverflowError).toBeDefined()
      expect(SDK.ModelThrottledError).toBeDefined()
    })

    it('exports BedrockModelProvider', () => {
      expect(SDK.BedrockModelProvider).toBeDefined()
      expect(SDK.DEFAULT_BEDROCK_MODEL_ID).toBeDefined()
    })

    it('can instantiate BedrockModelProvider', () => {
      const provider = new SDK.BedrockModelProvider()
      expect(provider).toBeInstanceOf(SDK.BedrockModelProvider)
      expect(provider.getConfig()).toBeDefined()
    })

    it('exports all required types', () => {
      // This test ensures all type exports compile correctly
      // If any exports are missing, TypeScript will error
      const _typeCheck: {
        // Error types
        contextError: typeof SDK.ContextWindowOverflowError
        throttleError: typeof SDK.ModelThrottledError
        // Model provider
        provider: typeof SDK.BedrockModelProvider
        modelId: typeof SDK.DEFAULT_BEDROCK_MODEL_ID
      } = {
        contextError: SDK.ContextWindowOverflowError,
        throttleError: SDK.ModelThrottledError,
        provider: SDK.BedrockModelProvider,
        modelId: SDK.DEFAULT_BEDROCK_MODEL_ID,
      }
      expect(_typeCheck).toBeDefined()
    })
  })
})
