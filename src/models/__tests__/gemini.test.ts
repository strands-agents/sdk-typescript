import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GoogleGenAI } from '@google/genai'
import { collectIterator } from '../../__fixtures__/model-test-helpers.js'
import { GeminiModel } from '../gemini/model.js'
import { ContextWindowOverflowError } from '../../errors.js'
import type { Message } from '../../types/messages.js'

/**
 * Helper to create a mock Gemini client with streaming support
 */
function createMockClient(streamGenerator: () => AsyncGenerator<Record<string, unknown>>): GoogleGenAI {
  return {
    models: {
      generateContentStream: vi.fn(async () => streamGenerator()),
    },
  } as unknown as GoogleGenAI
}

describe('GeminiModel', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key')
  })

  describe('constructor', () => {
    it('creates instance with API key', () => {
      const provider = new GeminiModel({ apiKey: 'test-key' })
      expect(provider).toBeInstanceOf(GeminiModel)
    })

    it('creates instance with pre-configured client', () => {
      const mockClient = createMockClient(async function* () {
        yield { candidates: [{ finishReason: 'STOP' }] }
      })

      const provider = new GeminiModel({ client: mockClient })
      expect(provider).toBeInstanceOf(GeminiModel)
    })

    it('throws error when no API key provided and no env variable', () => {
      vi.stubEnv('GEMINI_API_KEY', '')

      expect(() => new GeminiModel()).toThrow('Gemini API key is required')
    })

    it('does not require API key when client is provided', () => {
      vi.stubEnv('GEMINI_API_KEY', '')

      const mockClient = createMockClient(async function* () {
        yield { candidates: [{ finishReason: 'STOP' }] }
      })

      expect(() => new GeminiModel({ client: mockClient })).not.toThrow()
    })
  })

  describe('updateConfig', () => {
    it('merges new config with existing config', () => {
      const provider = new GeminiModel({ apiKey: 'test-key', modelId: 'gemini-2.5-flash' })
      provider.updateConfig({ params: { temperature: 0.5 } })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'gemini-2.5-flash',
        params: { temperature: 0.5 },
      })
    })
  })

  describe('getConfig', () => {
    it('returns the current configuration', () => {
      const provider = new GeminiModel({
        apiKey: 'test-key',
        modelId: 'gemini-2.5-flash',
        params: { maxOutputTokens: 1024, temperature: 0.7 },
      })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'gemini-2.5-flash',
        params: { maxOutputTokens: 1024, temperature: 0.7 },
      })
    })
  })

  describe('stream', () => {
    it('throws error when messages array is empty', async () => {
      const provider = new GeminiModel({ apiKey: 'test-key' })

      await expect(async () => {
        await collectIterator(provider.stream([]))
      }).rejects.toThrow('At least one message is required')
    })

    it('emits message start and stop events', async () => {
      const mockClient = createMockClient(async function* () {
        yield {
          candidates: [
            {
              content: { parts: [{ text: 'Hello' }] },
            },
          ],
        }
        yield { candidates: [{ finishReason: 'STOP' }] }
      })

      const provider = new GeminiModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      const events = await collectIterator(provider.stream(messages))

      expect(events[0]).toEqual({ type: 'modelMessageStartEvent', role: 'assistant' })
      expect(events[events.length - 1]).toEqual({ type: 'modelMessageStopEvent', stopReason: 'endTurn' })
    })

    it('emits text content block events', async () => {
      const mockClient = createMockClient(async function* () {
        yield {
          candidates: [
            {
              content: { parts: [{ text: 'Hello' }] },
            },
          ],
        }
        yield {
          candidates: [
            {
              content: { parts: [{ text: ' world' }] },
            },
          ],
        }
        yield { candidates: [{ finishReason: 'STOP' }] }
      })

      const provider = new GeminiModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      const events = await collectIterator(provider.stream(messages))

      expect(events).toHaveLength(6)
      expect(events[0]).toEqual({ type: 'modelMessageStartEvent', role: 'assistant' })
      expect(events[1]).toEqual({ type: 'modelContentBlockStartEvent' })
      expect(events[2]).toEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'textDelta', text: 'Hello' },
      })
      expect(events[3]).toEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'textDelta', text: ' world' },
      })
      expect(events[4]).toEqual({ type: 'modelContentBlockStopEvent' })
      expect(events[5]).toEqual({ type: 'modelMessageStopEvent', stopReason: 'endTurn' })
    })

    it('emits usage metadata when available', async () => {
      const mockClient = createMockClient(async function* () {
        yield {
          candidates: [
            {
              content: { parts: [{ text: 'Hi' }] },
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            totalTokenCount: 15,
          },
        }
        yield { candidates: [{ finishReason: 'STOP' }] }
      })

      const provider = new GeminiModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      const events = await collectIterator(provider.stream(messages))

      const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
      expect(metadataEvent).toBeDefined()
      expect(metadataEvent).toEqual({
        type: 'modelMetadataEvent',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      })
    })

    it('handles MAX_TOKENS finish reason', async () => {
      const mockClient = createMockClient(async function* () {
        yield {
          candidates: [
            {
              content: { parts: [{ text: 'Truncated' }] },
            },
          ],
        }
        yield { candidates: [{ finishReason: 'MAX_TOKENS' }] }
      })

      const provider = new GeminiModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      const events = await collectIterator(provider.stream(messages))

      const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(stopEvent).toBeDefined()
      expect(stopEvent!.stopReason).toBe('maxTokens')
    })
  })

  describe('error handling', () => {
    it('throws ContextWindowOverflowError for context overflow errors', async () => {
      const mockClient = {
        models: {
          generateContentStream: vi.fn(async () => {
            throw new Error(
              JSON.stringify({
                error: {
                  status: 'INVALID_ARGUMENT',
                  message: 'Request exceeds the maximum number of tokens allowed',
                },
              })
            )
          }),
        },
      } as unknown as GoogleGenAI

      const provider = new GeminiModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      await expect(async () => {
        await collectIterator(provider.stream(messages))
      }).rejects.toThrow(ContextWindowOverflowError)
    })

    it('rethrows unrecognized errors', async () => {
      const mockClient = {
        models: {
          generateContentStream: vi.fn(async () => {
            throw new Error('Network error')
          }),
        },
      } as unknown as GoogleGenAI

      const provider = new GeminiModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      await expect(async () => {
        await collectIterator(provider.stream(messages))
      }).rejects.toThrow('Network error')
    })
  })

  describe('system prompt', () => {
    /**
     * Helper to create a mock client that captures the request config
     */
    function createMockClientWithCapture(captureContainer: { config: unknown }): GoogleGenAI {
      return {
        models: {
          generateContentStream: vi.fn(async ({ config }: { config: unknown }) => {
            captureContainer.config = config
            return (async function* () {
              yield { candidates: [{ finishReason: 'STOP' }] }
            })()
          }),
        },
      } as unknown as GoogleGenAI
    }

    it('passes string system prompt to config', async () => {
      const captured: { config: unknown } = { config: null }
      const mockClient = createMockClientWithCapture(captured)

      const provider = new GeminiModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      await collectIterator(provider.stream(messages, { systemPrompt: 'You are a helpful assistant' }))

      expect(captured.config).toBeDefined()
      const config = captured.config as { systemInstruction?: string }
      expect(config.systemInstruction).toBe('You are a helpful assistant')
    })

    it('ignores empty string system prompt', async () => {
      const captured: { config: unknown } = { config: null }
      const mockClient = createMockClientWithCapture(captured)

      const provider = new GeminiModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      await collectIterator(provider.stream(messages, { systemPrompt: '   ' }))

      expect(captured.config).toBeDefined()
      const config = captured.config as { systemInstruction?: string }
      expect(config.systemInstruction).toBeUndefined()
    })
  })

  describe('message formatting', () => {
    /**
     * Helper to create a mock client that captures the request contents
     */
    function createMockClientWithCapture(captureContainer: { contents: unknown }): GoogleGenAI {
      return {
        models: {
          generateContentStream: vi.fn(async ({ contents }: { contents: unknown }) => {
            captureContainer.contents = contents
            return (async function* () {
              yield { candidates: [{ finishReason: 'STOP' }] }
            })()
          }),
        },
      } as unknown as GoogleGenAI
    }

    it('formats user messages correctly', async () => {
      const captured: { contents: unknown } = { contents: null }
      const mockClient = createMockClientWithCapture(captured)

      const provider = new GeminiModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      await collectIterator(provider.stream(messages))

      expect(captured.contents).toBeDefined()
      const contents = captured.contents as Array<{ role: string; parts: Array<{ text: string }> }>
      expect(contents).toHaveLength(1)
      expect(contents[0]?.role).toBe('user')
      expect(contents[0]?.parts[0]?.text).toBe('Hello')
    })

    it('formats assistant messages correctly', async () => {
      const captured: { contents: unknown } = { contents: null }
      const mockClient = createMockClientWithCapture(captured)

      const provider = new GeminiModel({ client: mockClient })
      const messages: Message[] = [
        { type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'textBlock', text: 'Hello!' }] },
        { type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'How are you?' }] },
      ]

      await collectIterator(provider.stream(messages))

      expect(captured.contents).toBeDefined()
      const contents = captured.contents as Array<{ role: string; parts: Array<{ text: string }> }>
      expect(contents).toHaveLength(3)
      expect(contents[0]?.role).toBe('user')
      expect(contents[1]?.role).toBe('model')
      expect(contents[2]?.role).toBe('user')
    })
  })
})
