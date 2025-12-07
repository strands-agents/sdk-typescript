import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GeminiModel } from '../gemini.js'
import { ContextWindowOverflowError } from '../../errors.js'
import { Message, TextBlock } from '../../types/messages.js'
import { ImageBlock, DocumentBlock } from '../../types/media.js'
import { collectIterator } from '../../__fixtures__/model-test-helpers.js'

/**
 * Helper to create a mock Google GenAI client with streaming support
 */
function createMockClient(streamGenerator: () => AsyncGenerator<any>): any {
  return {
    models: {
      generateContentStream: vi.fn(async () => streamGenerator()),
    },
  }
}

// Mock the Google GenAI SDK
vi.mock('@google/genai', () => {
  const mockConstructor = vi.fn(function (_this: unknown, _options?: unknown) {
    return {
      models: {
        generateContentStream: vi.fn(),
      },
    }
  })
  return {
    GoogleGenAI: mockConstructor,
  }
})

describe('GeminiModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('creates an instance with required modelId and clientArgs', () => {
      const provider = new GeminiModel({
        modelId: 'gemini-2.5-flash',
        clientArgs: { apiKey: 'test-api-key' },
      })
      const config = provider.getConfig()
      expect(config.modelId).toBe('gemini-2.5-flash')
    })

    it('uses default model ID when not specified', () => {
      const provider = new GeminiModel({
        clientArgs: { apiKey: 'test-api-key' },
      })
      expect(provider.getConfig().modelId).toBe('gemini-2.5-flash')
    })

    it('uses custom model ID', () => {
      const customModelId = 'gemini-1.5-pro'
      const provider = new GeminiModel({
        modelId: customModelId,
        clientArgs: { apiKey: 'test-api-key' },
      })
      expect(provider.getConfig()).toStrictEqual({
        modelId: customModelId,
      })
    })

    it('accepts params configuration', () => {
      const provider = new GeminiModel({
        modelId: 'gemini-2.5-flash',
        clientArgs: { apiKey: 'test-api-key' },
        params: { temperature: 0.7, maxTokens: 1024 },
      })
      expect(provider.getConfig().params).toStrictEqual({
        temperature: 0.7,
        maxTokens: 1024,
      })
    })
  })

  describe('updateConfig', () => {
    it('merges new config with existing config', () => {
      const provider = new GeminiModel({
        modelId: 'gemini-2.5-flash',
        clientArgs: { apiKey: 'test-api-key' },
        params: { temperature: 0.5 },
      })
      provider.updateConfig({
        modelId: 'gemini-2.5-flash',
        params: { temperature: 0.8, maxTokens: 2048 },
      })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'gemini-2.5-flash',
        params: { temperature: 0.8, maxTokens: 2048 },
      })
    })

    it('preserves fields not included in the update', () => {
      const provider = new GeminiModel({
        modelId: 'gemini-2.5-flash',
        clientArgs: { apiKey: 'test-api-key' },
        params: { temperature: 0.5, maxTokens: 1024 },
      })
      provider.updateConfig({
        modelId: 'gemini-2.5-flash',
        params: { temperature: 0.8 },
      })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'gemini-2.5-flash',
        params: { temperature: 0.8, maxTokens: 1024 },
      })
    })
  })

  describe('getConfig', () => {
    it('returns the current configuration', () => {
      const provider = new GeminiModel({
        modelId: 'gemini-2.5-flash',
        clientArgs: { apiKey: 'test-api-key' },
        params: { temperature: 0.7, maxTokens: 1024 },
      })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'gemini-2.5-flash',
        params: { temperature: 0.7, maxTokens: 1024 },
      })
    })
  })

  describe('stream', () => {
    describe('validation', () => {
      it('throws error when messages array is empty', async () => {
        const mockClient = createMockClient(async function* () {})
        const provider = new GeminiModel({
          modelId: 'gemini-2.5-flash',
          clientArgs: { apiKey: 'test-api-key' },
        })
        // @ts-expect-error - Accessing private property for testing
        provider._client = mockClient

        await expect(async () => {
          await collectIterator(provider.stream([]))
        }).rejects.toThrow('At least one message is required')
      })
    })

    describe('text generation', () => {
      it('streams text content correctly', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            candidates: [
              {
                content: {
                  parts: [{ text: 'Hello' }],
                },
              },
            ],
          }
          yield {
            candidates: [
              {
                content: {
                  parts: [{ text: ' world' }],
                },
              },
            ],
          }
          yield {
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [{ text: '!' }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              totalTokenCount: 15,
            },
          }
        })

        const provider = new GeminiModel({
          modelId: 'gemini-2.5-flash',
          clientArgs: { apiKey: 'test-api-key' },
        })
        // @ts-expect-error - Accessing private property for testing
        provider._client = mockClient

        const messages: Message[] = [new Message({ role: 'user', content: [new TextBlock('Say hello')] })]

        const events = await collectIterator(provider.stream(messages))

        expect(events).toEqual([
          { type: 'modelMessageStartEvent', role: 'assistant' },
          { type: 'modelContentBlockStartEvent' },
          { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: 'Hello' } },
          { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: ' world' } },
          { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: '!' } },
          { type: 'modelContentBlockStopEvent' },
          { type: 'modelMessageStopEvent', stopReason: 'endTurn' },
          {
            type: 'modelMetadataEvent',
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
            },
            metrics: {
              latencyMs: 0,
            },
          },
        ])
      })
    })

    describe('tool use', () => {
      it('handles tool use blocks correctly', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        name: 'calculator',
                        args: { operation: 'add', a: 2, b: 2 },
                      },
                    },
                  ],
                },
              },
            ],
          }
          yield {
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 20,
              totalTokenCount: 25,
            },
          }
        })

        const provider = new GeminiModel({
          modelId: 'gemini-2.5-flash',
          clientArgs: { apiKey: 'test-api-key' },
        })
        // @ts-expect-error - Accessing private property for testing
        provider._client = mockClient

        const messages: Message[] = [new Message({ role: 'user', content: [new TextBlock('Calculate 2+2')] })]

        const events = await collectIterator(provider.stream(messages))

        expect(events).toEqual([
          { type: 'modelMessageStartEvent', role: 'assistant' },
          {
            type: 'modelContentBlockStartEvent',
            start: {
              type: 'toolUseStart',
              name: 'calculator',
              toolUseId: 'calculator',
            },
          },
          {
            type: 'modelContentBlockDeltaEvent',
            delta: {
              type: 'toolUseInputDelta',
              input: JSON.stringify({ operation: 'add', a: 2, b: 2 }),
            },
          },
          { type: 'modelContentBlockStopEvent' },
          { type: 'modelMessageStopEvent', stopReason: 'toolUse' },
          {
            type: 'modelMetadataEvent',
            usage: {
              inputTokens: 20,
              outputTokens: 5,
              totalTokens: 25,
            },
            metrics: {
              latencyMs: 0,
            },
          },
        ])
      })
    })

    describe('stop reasons', () => {
      it('maps MAX_TOKENS finish reason correctly', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            candidates: [
              {
                finishReason: 'MAX_TOKENS',
                content: {
                  parts: [{ text: 'Partial' }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              totalTokenCount: 1000,
            },
          }
        })

        const provider = new GeminiModel({
          modelId: 'gemini-2.5-flash',
          clientArgs: { apiKey: 'test-api-key' },
        })
        // @ts-expect-error - Accessing private property for testing
        provider._client = mockClient

        const messages: Message[] = [new Message({ role: 'user', content: [new TextBlock('Test')] })]

        const events = await collectIterator(provider.stream(messages))

        const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
        expect(stopEvent).toEqual({
          type: 'modelMessageStopEvent',
          stopReason: 'maxTokens',
        })
      })
    })

    describe('error handling', () => {
      it('throws ContextWindowOverflowError on token limit', async () => {
        // eslint-disable-next-line require-yield
        const mockClient = createMockClient(async function* () {
          const error = new Error('Input exceeds the maximum number of tokens') as Error & { status?: string }
          error.status = 'INVALID_ARGUMENT'
          throw error
        })

        const provider = new GeminiModel({
          modelId: 'gemini-2.5-flash',
          clientArgs: { apiKey: 'test-api-key' },
        })
        // @ts-expect-error - Accessing private property for testing
        provider._client = mockClient

        const messages: Message[] = [new Message({ role: 'user', content: [new TextBlock('Test')] })]

        await expect(async () => {
          await collectIterator(provider.stream(messages))
        }).rejects.toThrow(ContextWindowOverflowError)
      })

      it('re-throws throttling errors', async () => {
        // eslint-disable-next-line require-yield
        const mockClient = createMockClient(async function* () {
          const error = new Error('Resource exhausted') as Error & { status?: string }
          error.status = 'RESOURCE_EXHAUSTED'
          throw error
        })

        const provider = new GeminiModel({
          modelId: 'gemini-2.5-flash',
          clientArgs: { apiKey: 'test-api-key' },
        })
        // @ts-expect-error - Accessing private property for testing
        provider._client = mockClient

        const messages: Message[] = [new Message({ role: 'user', content: [new TextBlock('Test')] })]

        await expect(async () => {
          await collectIterator(provider.stream(messages))
        }).rejects.toThrow('Resource exhausted')
      })
    })

    describe('system prompt', () => {
      it('handles string system prompt', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [{ text: 'Response' }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              totalTokenCount: 15,
            },
          }
        })

        const provider = new GeminiModel({
          modelId: 'gemini-2.5-flash',
          clientArgs: { apiKey: 'test-api-key' },
        })
        // @ts-expect-error - Accessing private property for testing
        provider._client = mockClient

        const messages: Message[] = [new Message({ role: 'user', content: [new TextBlock('Test')] })]

        const events = await collectIterator(provider.stream(messages, { systemPrompt: 'You are helpful' }))

        expect(events.length).toBeGreaterThan(0)
        expect(mockClient.models.generateContentStream).toHaveBeenCalledWith(
          expect.objectContaining({
            config: expect.objectContaining({
              systemInstruction: 'You are helpful',
            }),
          })
        )
      })
    })

    describe('tool specs', () => {
      it('formats tool specs correctly', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [{ text: 'Response' }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              totalTokenCount: 15,
            },
          }
        })

        const provider = new GeminiModel({
          modelId: 'gemini-2.5-flash',
          clientArgs: { apiKey: 'test-api-key' },
        })
        // @ts-expect-error - Accessing private property for testing
        provider._client = mockClient

        const messages: Message[] = [new Message({ role: 'user', content: [new TextBlock('Test')] })]

        const toolSpecs = [
          {
            name: 'calculator',
            description: 'Performs calculations',
            inputSchema: {
              type: 'object' as const,
              properties: {
                a: { type: 'number' as const },
                b: { type: 'number' as const },
              },
            },
          },
        ]

        await collectIterator(provider.stream(messages, { toolSpecs }))

        expect(mockClient.models.generateContentStream).toHaveBeenCalledWith(
          expect.objectContaining({
            config: expect.objectContaining({
              tools: [
                {
                  functionDeclarations: [
                    {
                      name: 'calculator',
                      description: 'Performs calculations',
                      parametersJsonSchema: {
                        type: 'object',
                        properties: {
                          a: { type: 'number' },
                          b: { type: 'number' },
                        },
                      },
                    },
                  ],
                },
              ],
            }),
          })
        )
      })
    })

    describe('content block formatting', () => {
      it('formats image blocks with bytes', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [{ text: 'Image received' }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              totalTokenCount: 15,
            },
          }
        })

        const provider = new GeminiModel({
          modelId: 'gemini-2.5-flash',
          clientArgs: { apiKey: 'test-api-key' },
        })
        // @ts-expect-error - Accessing private property for testing
        provider._client = mockClient

        const imageBytes = new Uint8Array([1, 2, 3, 4])
        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [
              new ImageBlock({
                format: 'png',
                source: { bytes: imageBytes },
              }),
            ],
          }),
        ]

        await collectIterator(provider.stream(messages))

        const callArgs = mockClient.models.generateContentStream.mock.calls[0][0]
        expect(callArgs.contents[0].parts[0]).toHaveProperty('inlineData')
        expect(callArgs.contents[0].parts[0].inlineData.mimeType).toBe('image/png')
      })

      it('formats document blocks with bytes', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [{ text: 'Document received' }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              totalTokenCount: 15,
            },
          }
        })

        const provider = new GeminiModel({
          modelId: 'gemini-2.5-flash',
          clientArgs: { apiKey: 'test-api-key' },
        })
        // @ts-expect-error - Accessing private property for testing
        provider._client = mockClient

        const docBytes = new Uint8Array([1, 2, 3, 4])
        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [
              new DocumentBlock({
                name: 'test.pdf',
                format: 'pdf',
                source: { bytes: docBytes },
              }),
            ],
          }),
        ]

        await collectIterator(provider.stream(messages))

        const callArgs = mockClient.models.generateContentStream.mock.calls[0][0]
        expect(callArgs.contents[0].parts[0]).toHaveProperty('inlineData')
        expect(callArgs.contents[0].parts[0].inlineData.mimeType).toBe('application/pdf')
      })
    })
  })
})
