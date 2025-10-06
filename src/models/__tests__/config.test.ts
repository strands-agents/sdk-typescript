import { describe, it, expect } from 'vitest'
import type { ModelConfig } from '@/models/config'

describe('ModelConfig interface', () => {
  describe('required fields', () => {
    it('accepts valid config with only modelId', () => {
      const config: ModelConfig = {
        modelId: 'anthropic.claude-v3-sonnet',
      }
      expect(config.modelId).toBe('anthropic.claude-v3-sonnet')
    })
  })

  describe('optional fields', () => {
    it('accepts config with maxTokens', () => {
      const config: ModelConfig = {
        modelId: 'gpt-4',
        maxTokens: 1000,
      }
      expect(config.maxTokens).toBe(1000)
    })

    it('accepts config with temperature', () => {
      const config: ModelConfig = {
        modelId: 'gpt-4',
        temperature: 0.7,
      }
      expect(config.temperature).toBe(0.7)
    })

    it('accepts config with topP', () => {
      const config: ModelConfig = {
        modelId: 'gpt-4',
        topP: 0.9,
      }
      expect(config.topP).toBe(0.9)
    })

    it('accepts config with stopSequences', () => {
      const config: ModelConfig = {
        modelId: 'gpt-4',
        stopSequences: ['END', 'STOP'],
      }
      expect(config.stopSequences).toHaveLength(2)
      expect(config.stopSequences?.[0]).toBe('END')
    })

    it('accepts config with all fields', () => {
      const config: ModelConfig = {
        modelId: 'anthropic.claude-v3-opus',
        maxTokens: 2048,
        temperature: 0.5,
        topP: 0.95,
        stopSequences: ['DONE'],
      }
      expect(config.modelId).toBe('anthropic.claude-v3-opus')
      expect(config.maxTokens).toBe(2048)
      expect(config.temperature).toBe(0.5)
      expect(config.topP).toBe(0.95)
      expect(config.stopSequences).toHaveLength(1)
    })
  })

  describe('field types', () => {
    it('modelId is a string', () => {
      const config: ModelConfig = {
        modelId: 'test-model',
      }
      expect(typeof config.modelId).toBe('string')
    })

    it('maxTokens is a number', () => {
      const config: ModelConfig = {
        modelId: 'test-model',
        maxTokens: 500,
      }
      expect(typeof config.maxTokens).toBe('number')
    })

    it('temperature is a number', () => {
      const config: ModelConfig = {
        modelId: 'test-model',
        temperature: 0.8,
      }
      expect(typeof config.temperature).toBe('number')
    })

    it('topP is a number', () => {
      const config: ModelConfig = {
        modelId: 'test-model',
        topP: 0.85,
      }
      expect(typeof config.topP).toBe('number')
    })

    it('stopSequences is an array of strings', () => {
      const config: ModelConfig = {
        modelId: 'test-model',
        stopSequences: ['stop1', 'stop2'],
      }
      expect(Array.isArray(config.stopSequences)).toBe(true)
      expect(typeof config.stopSequences?.[0]).toBe('string')
    })
  })
})
