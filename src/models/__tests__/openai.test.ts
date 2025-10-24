import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import OpenAI from 'openai'
import { OpenAIModel, type OpenAIModelOptions } from '../openai'
import type { Message } from '../../types/messages'

// Mock the OpenAI SDK
vi.mock('openai', () => {
  const mockConstructor = vi.fn().mockImplementation(() => ({}))
  return {
    default: mockConstructor,
  }
})

describe('OpenAIModel', () => {
  const originalEnv = process.env.OPENAI_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    // Set default env var for most tests
    process.env.OPENAI_API_KEY = 'sk-test-env'
  })

  afterEach(() => {
    vi.clearAllMocks()
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env.OPENAI_API_KEY = originalEnv
    } else {
      delete process.env.OPENAI_API_KEY
    }
  })

  describe('constructor', () => {
    it('throws error when modelId is not provided', () => {
      expect(() => new OpenAIModel({ apiKey: 'sk-test' } as OpenAIModelOptions)).toThrow(
        "OpenAI model ID is required. Provide it via the 'modelId' option."
      )
    })

    it('creates an instance with required modelId', () => {
      const provider = new OpenAIModel({ modelId: 'gpt-4o', apiKey: 'sk-test' })
      const config = provider.getConfig()
      expect(config.modelId).toBe('gpt-4o')
    })

    it('uses custom model ID', () => {
      const customModelId = 'gpt-3.5-turbo'
      const provider = new OpenAIModel({ modelId: customModelId, apiKey: 'sk-test' })
      expect(provider.getConfig()).toStrictEqual({
        modelId: customModelId,
      })
    })

    it('uses API key from constructor parameter', () => {
      const apiKey = 'sk-explicit'
      new OpenAIModel({ modelId: 'gpt-4o', apiKey })
      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: apiKey,
        })
      )
    })

    it('uses API key from environment variable', () => {
      process.env.OPENAI_API_KEY = 'sk-from-env'
      new OpenAIModel({ modelId: 'gpt-4o' })
      // OpenAI client should be called without explicit apiKey (uses env var internally)
      expect(OpenAI).toHaveBeenCalled()
    })

    it('explicit API key takes precedence over environment variable', () => {
      process.env.OPENAI_API_KEY = 'sk-from-env'
      const explicitKey = 'sk-explicit'
      new OpenAIModel({ modelId: 'gpt-4o', apiKey: explicitKey })
      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: explicitKey,
        })
      )
    })

    it('throws error when no API key is available', () => {
      delete process.env.OPENAI_API_KEY
      expect(() => new OpenAIModel({ modelId: 'gpt-4o' })).toThrow(
        "OpenAI API key is required. Provide it via the 'apiKey' option or set the OPENAI_API_KEY environment variable."
      )
    })

    it('uses custom client configuration', () => {
      const timeout = 30000
      new OpenAIModel({ modelId: 'gpt-4o', apiKey: 'sk-test', clientConfig: { timeout } })
      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: timeout,
        })
      )
    })
  })

  describe('updateConfig', () => {
    it('merges new config with existing config', () => {
      const provider = new OpenAIModel({ modelId: 'gpt-4o', apiKey: 'sk-test', temperature: 0.5 })
      provider.updateConfig({ modelId: 'gpt-4o', temperature: 0.8, maxTokens: 2048 })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'gpt-4o',
        temperature: 0.8,
        maxTokens: 2048,
      })
    })

    it('preserves fields not included in the update', () => {
      const provider = new OpenAIModel({
        apiKey: 'sk-test',
        modelId: 'gpt-3.5-turbo',
        temperature: 0.5,
        maxTokens: 1024,
      })
      provider.updateConfig({ modelId: 'gpt-3.5-turbo', temperature: 0.8 })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'gpt-3.5-turbo',
        temperature: 0.8,
        maxTokens: 1024,
      })
    })
  })

  describe('getConfig', () => {
    it('returns the current configuration', () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o',
        maxTokens: 1024,
        temperature: 0.7,
      })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'gpt-4o',
        maxTokens: 1024,
        temperature: 0.7,
      })
    })
  })

  describe('stream', () => {
    it('throws not yet implemented error', async () => {
      const provider = new OpenAIModel({ modelId: 'gpt-4o' })
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      await expect(async () => {
        // Try to consume the async generator
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of provider.stream(messages)) {
          // Should not reach here
        }
      }).rejects.toThrow('Not yet implemented - will be completed in Task 04.2')
    })
  })
})
