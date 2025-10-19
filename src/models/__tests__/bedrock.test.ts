import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { BedrockModelProvider, DEFAULT_BEDROCK_MODEL_ID, type BedrockModelConfig } from '@/models/bedrock'
import { ContextWindowOverflowError, ModelThrottledError } from '@/errors'
import type { Message } from '@/types/messages'

// Mock the AWS SDK
vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  const mockSend = vi.fn(async (): Promise<{ stream: AsyncIterable<unknown> }> => ({
    stream: (async function* (): AsyncGenerator<unknown> {
      yield { messageStart: { role: 'assistant' } }
      yield { contentBlockStart: { contentBlockIndex: 0 } }
      yield { contentBlockDelta: { delta: { text: 'Hello' }, contentBlockIndex: 0 } }
      yield { contentBlockStop: { contentBlockIndex: 0 } }
      yield { messageStop: { stopReason: 'end_turn' } }
      yield {
        metadata: {
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
          metrics: {
            latencyMs: 100,
          },
        },
      }
    })(),
  }))

  // Create a mock ThrottlingException class
  class MockThrottlingException extends Error {
    constructor(opts: { message: string; $metadata: Record<string, unknown> }) {
      super(opts.message)
      this.name = 'ThrottlingException'
    }
  }

  return {
    BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    ConverseStreamCommand: vi.fn(),
    ThrottlingException: MockThrottlingException,
  }
})

describe('BedrockModelProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.AWS_REGION
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('creates an instance with default model ID', () => {
      const provider = new BedrockModelProvider({}, {})
      expect(provider.getConfig().modelId).toBe(DEFAULT_BEDROCK_MODEL_ID)
    })

    it('uses provided model ID', () => {
      const customModelId = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
      const provider = new BedrockModelProvider({ modelId: customModelId }, {})
      expect(provider.getConfig().modelId).toBe(customModelId)
    })

    it('uses provided region in clientConfig', () => {
      const customRegion = 'eu-west-1'
      new BedrockModelProvider({}, { region: customRegion })
      expect(BedrockRuntimeClient).toHaveBeenCalledWith({
        region: customRegion,
        customUserAgent: 'strands-agents-ts-sdk',
      })
    })

    it('passes custom endpoint to client', () => {
      const endpoint = 'https://vpce-abc.bedrock-runtime.us-west-2.vpce.amazonaws.com'
      const region = 'us-west-2'
      new BedrockModelProvider({}, { endpoint, region })
      expect(BedrockRuntimeClient).toHaveBeenCalledWith({
        region,
        endpoint,
        customUserAgent: 'strands-agents-ts-sdk',
      })
    })

    it('passes custom credentials to client', () => {
      const credentials = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      }
      const region = 'us-west-2'
      new BedrockModelProvider({}, { credentials, region })
      expect(BedrockRuntimeClient).toHaveBeenCalledWith({
        region,
        credentials,
        customUserAgent: 'strands-agents-ts-sdk',
      })
    })
  })

  describe('updateConfig', () => {
    it('merges new config with existing config', () => {
      const provider = new BedrockModelProvider({ temperature: 0.5 }, {})
      provider.updateConfig({ temperature: 0.8, maxTokens: 2048 })
      const config = provider.getConfig()
      expect(config.temperature).toBe(0.8)
      expect(config.maxTokens).toBe(2048)
    })

    it('preserves fields not included in the update', () => {
      const provider = new BedrockModelProvider({ modelId: 'custom-model', temperature: 0.5, maxTokens: 1024 }, {})
      provider.updateConfig({ temperature: 0.8 })
      const config = provider.getConfig()
      expect(config.modelId).toBe('custom-model')
      expect(config.temperature).toBe(0.8)
      expect(config.maxTokens).toBe(1024)
    })
  })

  describe('getConfig', () => {
    it('returns the current configuration', () => {
      const modelConfig: BedrockModelConfig = {
        modelId: 'test-model',
        maxTokens: 1024,
        temperature: 0.7,
      }
      const provider = new BedrockModelProvider(modelConfig, {})
      const config = provider.getConfig()
      expect(config.modelId).toBe('test-model')
      expect(config.maxTokens).toBe(1024)
      expect(config.temperature).toBe(0.7)
    })
  })

  describe('stream', () => {
    it('yields message start event', async () => {
      const provider = new BedrockModelProvider({}, {})
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      
      const events = []
      for await (const event of provider.stream(messages)) {
        events.push(event)
      }
      
      const messageStartEvent = events.find((e) => e.type === 'modelMessageStartEvent')
      expect(messageStartEvent).toBeDefined()
      expect(messageStartEvent?.role).toBe('assistant')
    })

    it('yields content block delta events', async () => {
      const provider = new BedrockModelProvider({}, {})
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      
      const events = []
      for await (const event of provider.stream(messages)) {
        events.push(event)
      }
      
      const deltaEvents = events.filter((e) => e.type === 'modelContentBlockDeltaEvent')
      expect(deltaEvents.length).toBeGreaterThan(0)
      expect(deltaEvents[0]?.delta.type).toBe('textDelta')
    })

    it('yields message stop event with correct stop reason', async () => {
      const provider = new BedrockModelProvider({}, {})
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      
      const events = []
      for await (const event of provider.stream(messages)) {
        events.push(event)
      }
      
      const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(messageStopEvent).toBeDefined()
      expect(messageStopEvent?.stopReason).toBe('endTurn')
    })

    it('yields metadata event with usage', async () => {
      const provider = new BedrockModelProvider({}, {})
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      
      const events = []
      for await (const event of provider.stream(messages)) {
        events.push(event)
      }
      
      const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
      expect(metadataEvent).toBeDefined()
      expect(metadataEvent?.usage?.inputTokens).toBe(10)
      expect(metadataEvent?.usage?.outputTokens).toBe(5)
    })

    it('formats tool use messages', async () => {
      const provider = new BedrockModelProvider({}, {})
      const messages: Message[] = [
        {
          role: 'assistant',
          content: [
            {
              type: 'toolUseBlock',
              name: 'calculator',
              toolUseId: 'tool-123',
              input: { a: 5, b: 3 },
            },
          ],
        },
      ]
      
      const stream = provider.stream(messages)
      const events = []
      for await (const event of stream) {
        events.push(event)
      }
      
      expect(events.length).toBeGreaterThan(0)
    })

    it('formats tool result messages', async () => {
      const provider = new BedrockModelProvider({}, {})
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            {
              type: 'toolResultBlock',
              toolUseId: 'tool-123',
              status: 'success',
              content: [{ type: 'toolResultTextContent', text: 'Result: 8' }],
            },
          ],
        },
      ]
      
      const stream = provider.stream(messages)
      const events = []
      for await (const event of stream) {
        events.push(event)
      }
      
      expect(events.length).toBeGreaterThan(0)
    })

    it('throws ContextWindowOverflowError for context overflow', async () => {
      vi.clearAllMocks()
      const mockSendError = vi.fn().mockRejectedValue(new Error('Input is too long for requested model'))
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSendError }) as never)
      
      const provider = new BedrockModelProvider({}, {})
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      
      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of provider.stream(messages)) {
          // Should not reach here
        }
      }).rejects.toThrow(ContextWindowOverflowError)
    })

    it('throws ModelThrottledError for throttling', async () => {
      vi.clearAllMocks()
      const { ThrottlingException } = await import('@aws-sdk/client-bedrock-runtime')
      const error = new ThrottlingException({ message: 'Rate limit exceeded', $metadata: {} })
      const mockSendError = vi.fn().mockRejectedValue(error)
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSendError }) as never)
      
      const provider = new BedrockModelProvider({}, {})
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      
      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of provider.stream(messages)) {
          // Should not reach here
        }
      }).rejects.toThrow(ModelThrottledError)
    })
  })
})
