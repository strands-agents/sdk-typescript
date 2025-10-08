import { describe, it, expect } from 'vitest'
import type { StreamOptions, ModelProvider } from '@/models/model'

describe('model provider types', () => {
  describe('StreamOptions interface', () => {
    it('accepts empty options', () => {
      const options: StreamOptions = {}
      expect(options).toBeDefined()
    })

    it('accepts options with toolSpecs', () => {
      const options: StreamOptions = {
        toolSpecs: [
          {
            name: 'calculator',
            description: 'Calculates math',
            inputSchema: { type: 'object' },
          },
        ],
      }
      expect(options.toolSpecs).toHaveLength(1)
      expect(options.toolSpecs?.[0]?.name).toBe('calculator')
    })

    it('accepts options with systemPrompt', () => {
      const options: StreamOptions = {
        systemPrompt: 'You are a helpful assistant',
      }
      expect(options.systemPrompt).toBe('You are a helpful assistant')
    })

    it('accepts options with toolChoice auto', () => {
      const options: StreamOptions = {
        toolChoice: { auto: {} },
      }
      expect(options.toolChoice).toBeDefined()
    })

    it('accepts options with toolChoice any', () => {
      const options: StreamOptions = {
        toolChoice: { any: {} },
      }
      expect(options.toolChoice).toBeDefined()
    })

    it('accepts options with toolChoice specific tool', () => {
      const options: StreamOptions = {
        toolChoice: { tool: { name: 'calculator' } },
      }
      expect(options.toolChoice).toBeDefined()
    })

    it('accepts options with all fields', () => {
      const options: StreamOptions = {
        toolSpecs: [
          {
            name: 'search',
            description: 'Searches',
            inputSchema: {},
          },
        ],
        systemPrompt: 'Be helpful',
        toolChoice: { auto: {} },
      }
      expect(options.toolSpecs).toHaveLength(1)
      expect(options.systemPrompt).toBe('Be helpful')
      expect(options.toolChoice).toBeDefined()
    })
  })

  describe('ModelProvider interface', () => {
    it('defines updateConfig method signature', () => {
      // Type test: this validates the interface structure compiles
      const mockProvider: ModelProvider = {
        updateConfig: (modelConfig: unknown): void => {
          expect(modelConfig).toBeDefined()
        },
        getConfig: (): unknown => {
          return {}
        },
        stream: async function* () {
          yield { type: 'messageStart', role: 'assistant' } as const
        },
      }
      expect(mockProvider.updateConfig).toBeDefined()
    })

    it('defines getConfig method signature', () => {
      const mockProvider: ModelProvider = {
        updateConfig: (): void => {},
        getConfig: (): unknown => {
          return { modelId: 'test' }
        },
        stream: async function* () {
          yield { type: 'messageStart', role: 'assistant' } as const
        },
      }
      const config = mockProvider.getConfig()
      expect(config).toBeDefined()
    })

    it('defines stream method signature returning AsyncIterable', () => {
      const mockProvider: ModelProvider = {
        updateConfig: (): void => {},
        getConfig: (): unknown => ({}),
        stream: async function* () {
          yield { type: 'messageStart', role: 'assistant' } as const
          yield { type: 'contentBlockDelta', delta: { type: 'text', text: 'Hello' } } as const
          yield { type: 'messageStop', stopReason: 'end_turn' } as const
        },
      }
      expect(mockProvider.stream).toBeDefined()
    })

    it('stream method can be async iterated', async () => {
      const mockProvider: ModelProvider = {
        updateConfig: (): void => {},
        getConfig: (): unknown => ({}),
        stream: async function* () {
          yield { type: 'messageStart', role: 'assistant' } as const
          yield { type: 'messageStop', stopReason: 'end_turn' } as const
        },
      }

      const events = []
      for await (const event of mockProvider.stream([], {})) {
        events.push(event)
      }
      expect(events).toHaveLength(2)
    })

    it('accepts provider implementation with all methods', async () => {
      let currentConfig: unknown = { modelId: 'initial' }

      const provider: ModelProvider = {
        updateConfig: (modelConfig: unknown): void => {
          currentConfig = {
            ...(currentConfig as Record<string, unknown>),
            ...(modelConfig as Record<string, unknown>),
          }
        },
        getConfig: (): unknown => {
          return currentConfig
        },
        stream: async function* (messages, options) {
          expect(messages).toBeDefined()
          expect(options).toBeDefined()
          yield { type: 'messageStart', role: 'assistant' } as const
        },
      }

      expect(provider.getConfig()).toEqual({ modelId: 'initial' })
      provider.updateConfig({ temperature: 0.7 })
      expect(provider.getConfig()).toEqual({ modelId: 'initial', temperature: 0.7 })

      let eventCount = 0
      for await (const event of provider.stream([], {})) {
        expect(event).toBeDefined()
        eventCount++
      }
      expect(eventCount).toBe(1)
    })
  })
})
