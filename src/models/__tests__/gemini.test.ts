import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GoogleGenAI } from '@google/genai'
import { collectIterator } from '../../__fixtures__/model-test-helpers.js'
import { GeminiModel } from '../gemini/model.js'
import { ContextWindowOverflowError } from '../../errors.js'
import type { Message, ContentBlock } from '../../types/messages.js'
import { CachePointBlock, GuardContentBlock, ReasoningBlock, ToolUseBlock } from '../../types/messages.js'
import { formatMessages } from '../gemini/adapters.js'
import { ImageBlock, DocumentBlock, VideoBlock } from '../../types/media.js'

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
      const provider = new GeminiModel({ apiKey: 'test-key', modelId: 'gemini-2.0-flash' })
      expect(provider.getConfig().modelId).toBe('gemini-2.0-flash')
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

      await expect(collectIterator(provider.stream([]))).rejects.toThrow('At least one message is required')
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

      await expect(collectIterator(provider.stream(messages))).rejects.toThrow(ContextWindowOverflowError)
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

      await expect(collectIterator(provider.stream(messages))).rejects.toThrow('Network error')
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

  describe('content type formatting', () => {
    describe('image content', () => {
      it('formats image with bytes source as inlineData', () => {
        const imageBlock = new ImageBlock({
          format: 'png',
          source: { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
        })
        const messages: Message[] = [{ type: 'message', role: 'user', content: [imageBlock as ContentBlock] }]

        const contents = formatMessages(messages)

        expect(contents).toHaveLength(1)
        const part = contents[0]!.parts![0]!
        expect(part).toHaveProperty('inlineData')
        expect((part as { inlineData: { mimeType: string } }).inlineData.mimeType).toBe('image/png')
      })

      it('formats image with URL source as fileData', () => {
        const imageBlock = new ImageBlock({
          format: 'jpeg',
          source: { url: 'https://example.com/image.jpg' },
        })
        const messages: Message[] = [{ type: 'message', role: 'user', content: [imageBlock as ContentBlock] }]

        const contents = formatMessages(messages)

        expect(contents).toHaveLength(1)
        const part = contents[0]!.parts![0]!
        expect(part).toHaveProperty('fileData')
        expect((part as { fileData: { fileUri: string; mimeType: string } }).fileData.fileUri).toBe(
          'https://example.com/image.jpg'
        )
        expect((part as { fileData: { fileUri: string; mimeType: string } }).fileData.mimeType).toBe('image/jpeg')
      })

      it('skips image with S3 source and logs warning', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const imageBlock = new ImageBlock({
          format: 'png',
          source: { s3Location: { uri: 's3://test/image.png' } },
        })
        const messages: Message[] = [{ type: 'message', role: 'user', content: [imageBlock as ContentBlock] }]

        const contents = formatMessages(messages)

        // Message with no valid parts is not included
        expect(contents).toHaveLength(0)
        expect(warnSpy).toHaveBeenCalled()
        warnSpy.mockRestore()
      })
    })

    describe('document content', () => {
      it('formats document with bytes source as inlineData', () => {
        const docBlock = new DocumentBlock({
          name: 'test.pdf',
          format: 'pdf',
          source: { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
        })
        const messages: Message[] = [{ type: 'message', role: 'user', content: [docBlock as ContentBlock] }]

        const contents = formatMessages(messages)

        expect(contents).toHaveLength(1)
        const part = contents[0]!.parts![0]!
        expect(part).toHaveProperty('inlineData')
        expect((part as { inlineData: { mimeType: string } }).inlineData.mimeType).toBe('application/pdf')
      })

      it('formats document with text source as text part', () => {
        const docBlock = new DocumentBlock({
          name: 'test.txt',
          format: 'txt',
          source: { text: 'Document content here' },
        })
        const messages: Message[] = [{ type: 'message', role: 'user', content: [docBlock as ContentBlock] }]

        const contents = formatMessages(messages)

        expect(contents).toHaveLength(1)
        const part = contents[0]!.parts![0]!
        expect(part).toEqual({ text: 'Document content here' })
      })

      it('formats document with content block source as text', () => {
        const docBlock = new DocumentBlock({
          name: 'test.txt',
          format: 'txt',
          source: { content: [{ text: 'Line 1' }, { text: 'Line 2' }] },
        })
        const messages: Message[] = [{ type: 'message', role: 'user', content: [docBlock as ContentBlock] }]

        const contents = formatMessages(messages)

        expect(contents).toHaveLength(1)
        const part = contents[0]!.parts![0]!
        expect(part).toEqual({ text: 'Line 1\nLine 2' })
      })
    })

    describe('video content', () => {
      it('formats video with bytes source as inlineData', () => {
        const videoBlock = new VideoBlock({
          format: 'mp4',
          source: { bytes: new Uint8Array([0x00, 0x00, 0x00, 0x1c]) },
        })
        const messages: Message[] = [{ type: 'message', role: 'user', content: [videoBlock as ContentBlock] }]

        const contents = formatMessages(messages)

        expect(contents).toHaveLength(1)
        const part = contents[0]!.parts![0]!
        expect(part).toHaveProperty('inlineData')
        expect((part as { inlineData: { mimeType: string } }).inlineData.mimeType).toBe('video/mp4')
      })
    })

    describe('reasoning content', () => {
      it('formats reasoning block with thought flag', () => {
        const reasoningBlock = new ReasoningBlock({ text: 'Let me think about this...' })
        const messages: Message[] = [{ type: 'message', role: 'assistant', content: [reasoningBlock as ContentBlock] }]

        const contents = formatMessages(messages)

        expect(contents).toHaveLength(1)
        const part = contents[0]!.parts![0]!
        expect(part).toHaveProperty('text', 'Let me think about this...')
        expect(part).toHaveProperty('thought', true)
      })

      it('includes thought signature when present', () => {
        const reasoningBlock = new ReasoningBlock({ text: 'Thinking...', signature: 'sig123' })
        const messages: Message[] = [{ type: 'message', role: 'assistant', content: [reasoningBlock as ContentBlock] }]

        const contents = formatMessages(messages)

        const part = contents[0]!.parts![0]! as { thoughtSignature?: Uint8Array }
        expect(part.thoughtSignature).toBeDefined()
        expect(new TextDecoder().decode(part.thoughtSignature)).toBe('sig123')
      })

      it('skips reasoning block with empty text', () => {
        const reasoningBlock = new ReasoningBlock({ text: '' })
        const messages: Message[] = [{ type: 'message', role: 'assistant', content: [reasoningBlock as ContentBlock] }]

        const contents = formatMessages(messages)

        expect(contents).toHaveLength(0)
      })
    })

    describe('unsupported content types', () => {
      it('skips cache point blocks with warning', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const cacheBlock = new CachePointBlock({ cacheType: 'default' })
        const messages: Message[] = [{ type: 'message', role: 'user', content: [cacheBlock as ContentBlock] }]

        const contents = formatMessages(messages)

        expect(contents).toHaveLength(0)
        warnSpy.mockRestore()
      })

      it('skips guard content blocks with warning', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const guardBlock = new GuardContentBlock({ text: { qualifiers: ['guard_content'], text: 'test' } })
        const messages: Message[] = [{ type: 'message', role: 'user', content: [guardBlock as ContentBlock] }]

        const contents = formatMessages(messages)

        expect(contents).toHaveLength(0)
        warnSpy.mockRestore()
      })

      it('skips tool use blocks with warning', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const toolUseBlock = new ToolUseBlock({ toolUseId: 'test-id', name: 'testTool', input: {} })
        const messages: Message[] = [{ type: 'message', role: 'assistant', content: [toolUseBlock as ContentBlock] }]

        const contents = formatMessages(messages)

        expect(contents).toHaveLength(0)
        warnSpy.mockRestore()
      })
    })
  })

  describe('reasoning content streaming', () => {
    it('emits reasoning content delta events for thought parts', async () => {
      const mockClient = createMockClient(async function* () {
        yield {
          candidates: [
            {
              content: { parts: [{ text: 'Thinking...', thought: true }] },
            },
          ],
        }
        yield { candidates: [{ finishReason: 'STOP' }] }
      })

      const provider = new GeminiModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      const events = await collectIterator(provider.stream(messages))

      expect(events).toHaveLength(5)
      expect(events[0]).toEqual({ type: 'modelMessageStartEvent', role: 'assistant' })
      expect(events[1]).toEqual({ type: 'modelContentBlockStartEvent' })
      expect(events[2]).toEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'reasoningContentDelta', text: 'Thinking...' },
      })
      expect(events[3]).toEqual({ type: 'modelContentBlockStopEvent' })
      expect(events[4]).toEqual({ type: 'modelMessageStopEvent', stopReason: 'endTurn' })
    })

    it('handles transition from reasoning to text content', async () => {
      const mockClient = createMockClient(async function* () {
        yield {
          candidates: [
            {
              content: { parts: [{ text: 'Let me think...', thought: true }] },
            },
          ],
        }
        yield {
          candidates: [
            {
              content: { parts: [{ text: 'Here is my answer' }] },
            },
          ],
        }
        yield { candidates: [{ finishReason: 'STOP' }] }
      })

      const provider = new GeminiModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      const events = await collectIterator(provider.stream(messages))

      // Should have: messageStart, blockStart (reasoning), delta (reasoning), blockStop,
      //              blockStart (text), delta (text), blockStop, messageStop
      expect(events).toHaveLength(8)

      // Reasoning block
      expect(events[1]).toEqual({ type: 'modelContentBlockStartEvent' })
      expect(events[2]).toEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'reasoningContentDelta', text: 'Let me think...' },
      })
      expect(events[3]).toEqual({ type: 'modelContentBlockStopEvent' })

      // Text block
      expect(events[4]).toEqual({ type: 'modelContentBlockStartEvent' })
      expect(events[5]).toEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'textDelta', text: 'Here is my answer' },
      })
      expect(events[6]).toEqual({ type: 'modelContentBlockStopEvent' })
      expect(events[7]).toEqual({ type: 'modelMessageStopEvent', stopReason: 'endTurn' })
    })

    it('includes signature in reasoning delta when present', async () => {
      const mockClient = createMockClient(async function* () {
        yield {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Thinking...',
                    thought: true,
                    thoughtSignature: new TextEncoder().encode('sig456'),
                  },
                ],
              },
            },
          ],
        }
        yield { candidates: [{ finishReason: 'STOP' }] }
      })

      const provider = new GeminiModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      const events = await collectIterator(provider.stream(messages))

      const deltaEvent = events.find(
        (e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'reasoningContentDelta'
      )
      expect(deltaEvent).toBeDefined()
      expect((deltaEvent as { delta: { signature?: string } }).delta.signature).toBe('sig456')
    })
  })
})
