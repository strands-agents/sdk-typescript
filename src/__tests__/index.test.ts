import { describe, it, expect } from 'vitest'
import * as SDK from '../index.js'

describe('index', () => {
  describe('when importing from main entry point', () => {
    it('exports error classes', () => {
      expect(SDK.ContextWindowOverflowError).toBeDefined()
    })

    it('exports BedrockModel', () => {
      expect(SDK.BedrockModel).toBeDefined()
    })

    it('can instantiate BedrockModel', () => {
      const provider = new SDK.BedrockModel({ region: 'us-west-2' })
      expect(provider).toBeInstanceOf(SDK.BedrockModel)
      expect(provider.getConfig()).toBeDefined()
    })

    it('exports all required types', () => {
      // This test ensures all type exports compile correctly
      // If any exports are missing, TypeScript will error
      const _typeCheck: {
        // Error types
        contextError: typeof SDK.ContextWindowOverflowError
        // Model provider
        provider: typeof SDK.BedrockModel
      } = {
        contextError: SDK.ContextWindowOverflowError,
        provider: SDK.BedrockModel,
      }
      expect(_typeCheck).toBeDefined()
    })
  })
})
