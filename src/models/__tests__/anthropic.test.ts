import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { isNode } from '../../__fixtures__/environment.js'
import { AnthropicModel } from '../anthropic.js'
import { ContextWindowOverflowError } from '../../errors.js'
import { collectIterator } from '../../__fixtures__/model-test-helpers.js'
import type { Message } from '../../types/messages.js'
import { TextBlock, CachePointBlock, GuardContentBlock } from '../../types/messages.js'
import { ImageBlock, DocumentBlock } from '../../types/media.js'

/**
 * Helper to create a mock Anthropic client with streaming support
 */
function createMockClient(streamGenerator: () => AsyncGenerator<unknown>): Anthropic {
  return {
    messages: {
      stream: vi.fn(() => streamGenerator()),
    },
  } as unknown as Anthropic
}

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  const mockConstructor = vi.fn(function () {
    return {
      messages: {
        stream: vi.fn(),
      },
    }
  })
  return {
    default: mockConstructor,
  }
})

describe('AnthropicModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    if (isNode) {
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-env')
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
    if (isNode) {
      vi.unstubAllEnvs()
    }
  })

  describe('constructor', () => {
    it('creates an instance with default configuration', () => {
      const provider = new AnthropicModel({ apiKey: 'sk-ant-test' })
      const config = provider.getConfig()
      expect(config.modelId).toBe('claude-sonnet-4-5-20250929')
      expect(config.maxTokens).toBe(4096)
    })

    it('uses provided model ID', () => {
      const customModelId = 'claude-3-opus-20240229'
      const provider = new AnthropicModel({ modelId: customModelId, apiKey: 'sk-ant-test' })
      expect(provider.getConfig().modelId).toBe(customModelId)
    })

    it('uses API key from constructor parameter', () => {
      const apiKey = 'sk-explicit'
      new AnthropicModel({ apiKey })
      expect(Anthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey,
        })
      )
    })

    if (isNode) {
      it('uses API key from environment variable', () => {
        vi.stubEnv('ANTHROPIC_API_KEY', 'sk-from-env')
        new AnthropicModel()
        expect(Anthropic).toHaveBeenCalled()
      })

      it('throws error when no API key is available', () => {
        vi.stubEnv('ANTHROPIC_API_KEY', '')
        expect(() => new AnthropicModel()).toThrow('Anthropic API key is required')
      })
    }

    it('uses provided client instance', () => {
      const mockClient = {} as Anthropic
      const provider = new AnthropicModel({ client: mockClient })
      expect(Anthropic).not.toHaveBeenCalled()
      expect(provider).toBeDefined()
    })
  })

  describe('updateConfig', () => {
    it('merges new config with existing config', () => {
      const provider = new AnthropicModel({ apiKey: 'sk-test', temperature: 0.5 })
      provider.updateConfig({ temperature: 0.8, maxTokens: 8192 })
      expect(provider.getConfig()).toMatchObject({
        temperature: 0.8,
        maxTokens: 8192,
      })
    })
  })

  describe('stream event handling', () => {
    it('yields correct event sequence for simple text response', async () => {
      const mockClient = createMockClient(async function* () {
        yield { type: 'message_start', message: { role: 'assistant', usage: { input_tokens: 10 } } }
        yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }
        yield { type: 'message_stop' }
      })

      const provider = new AnthropicModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      const events = await collectIterator(provider.stream(messages))

      expect(events).toHaveLength(6)
      expect(events[0]).toEqual({ type: 'modelMessageStartEvent', role: 'assistant' })
      expect(events[1]).toEqual({ type: 'modelContentBlockStartEvent' })
      expect(events[2]).toEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'textDelta', text: 'Hello' },
      })
      expect(events[3]).toEqual({ type: 'modelContentBlockStopEvent' })
      expect(events[4]).toEqual({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })
      expect(events[5]).toEqual({ type: 'modelMessageStopEvent', stopReason: 'endTurn' })
    })

    it('handles tool use events', async () => {
      const mockClient = createMockClient(async function* () {
        yield { type: 'message_start', message: { role: 'assistant', usage: { input_tokens: 10 } } }
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tool_1', name: 'calc' },
        }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a"' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ':1}' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 10 } }
        yield { type: 'message_stop' }
      })

      const provider = new AnthropicModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      const events = await collectIterator(provider.stream(messages))

      expect(events).toContainEqual({
        type: 'modelContentBlockStartEvent',
        start: { type: 'toolUseStart', name: 'calc', toolUseId: 'tool_1' },
      })
      expect(events).toContainEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'toolUseInputDelta', input: '{"a"' },
      })
      expect(events).toContainEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'toolUseInputDelta', input: ':1}' },
      })
      expect(events).toContainEqual({ type: 'modelMessageStopEvent', stopReason: 'toolUse' })
    })

    it('handles thinking/reasoning events', async () => {
      const mockClient = createMockClient(async function* () {
        yield { type: 'message_start', message: { role: 'assistant', usage: { input_tokens: 10 } } }
        // Thinking block
        yield { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Hmm...' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig_123' } }
        yield { type: 'content_block_stop', index: 0 }
        // Text block
        yield { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }
        yield { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Answer' } }
        yield { type: 'content_block_stop', index: 1 }

        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }
        yield { type: 'message_stop' }
      })

      const provider = new AnthropicModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      const events = await collectIterator(provider.stream(messages))

      // Check for thinking deltas
      expect(events).toContainEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'reasoningContentDelta', text: 'Hmm...' },
      })
      expect(events).toContainEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'reasoningContentDelta', signature: 'sig_123' },
      })
    })

    it('handles redacted thinking events', async () => {
      const mockClient = createMockClient(async function* () {
        yield { type: 'message_start', message: { role: 'assistant', usage: { input_tokens: 10 } } }
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'redacted_thinking', data: 'data' },
        }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }
        yield { type: 'message_stop' }
      })

      const provider = new AnthropicModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      const events = await collectIterator(provider.stream(messages))

      expect(events).toContainEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'reasoningContentDelta', redactedContent: 'data' },
      })
    })

    it('handles text payload directly in content_block_start (optimization)', async () => {
      const mockClient = createMockClient(async function* () {
        yield { type: 'message_start', message: { role: 'assistant', usage: { input_tokens: 10 } } }
        yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Full text' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }
        yield { type: 'message_stop' }
      })

      const provider = new AnthropicModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      const events = await collectIterator(provider.stream(messages))

      expect(events).toContainEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'textDelta', text: 'Full text' },
      })
    })

    it('handles error during stream', async () => {
      const mockClient = createMockClient(async function* () {
        yield { type: 'ping' } // Satisfy linter require-yield
        throw new Error('API Error')
      })
      const provider = new AnthropicModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      await expect(collectIterator(provider.stream(messages))).rejects.toThrow('API Error')
    })

    it('maps overload error to ContextWindowOverflowError', async () => {
      const mockClient = createMockClient(async function* () {
        yield { type: 'ping' } // Satisfy linter require-yield
        throw new Error('prompt is too long')
      })
      const provider = new AnthropicModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

      await expect(collectIterator(provider.stream(messages))).rejects.toThrow(ContextWindowOverflowError)
    })
  })

  describe('request formatting', () => {
    // Helper to capture request arguments
    const setupCapture = () => {
      const captured: { request: any } = { request: null }
      const mockClient = {
        messages: {
          stream: vi.fn((req) => {
            captured.request = req
            return (async function* () {})()
          }),
        },
      } as any
      return { captured, mockClient }
    }

    it('formats basic request correctly', async () => {
      const { captured, mockClient } = setupCapture()
      const provider = new AnthropicModel({
        modelId: 'claude-3-opus',
        maxTokens: 1000,
        temperature: 0.7,
        client: mockClient,
      })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      await collectIterator(provider.stream(messages))

      expect(captured.request).toEqual({
        model: 'claude-3-opus',
        max_tokens: 1000,
        temperature: 0.7,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        stream: true,
      })
    })

    it('formats tools correctly', async () => {
      const { captured, mockClient } = setupCapture()
      const provider = new AnthropicModel({ client: mockClient })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]
      const toolSpecs = [
        {
          name: 'calc',
          description: 'calculate',
          inputSchema: { type: 'object' as const, properties: {} },
        },
      ]

      await collectIterator(provider.stream(messages, { toolSpecs, toolChoice: { auto: {} } }))

      expect(captured.request.tools).toHaveLength(1)
      expect(captured.request.tools[0]).toEqual({
        name: 'calc',
        description: 'calculate',
        input_schema: { type: 'object', properties: {} },
      })
      expect(captured.request.tool_choice).toEqual({ type: 'auto' })
    })

    describe('Prompt Caching (Lookahead logic)', () => {
      it('attaches cache control to message content block followed by cache point', async () => {
        const { captured, mockClient } = setupCapture()
        const provider = new AnthropicModel({ client: mockClient })
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [
              new TextBlock('Cached content'),
              // Use 'default' here; provider converts it to 'ephemeral' for Anthropic
              new CachePointBlock({ cacheType: 'default' }),
              new TextBlock('Non-cached content'),
            ],
          },
        ]

        await collectIterator(provider.stream(messages))

        const content = captured.request.messages[0].content
        expect(content).toHaveLength(2) // 3 blocks reduced to 2 (cache point merged)
        expect(content[0]).toEqual({
          type: 'text',
          text: 'Cached content',
          cache_control: { type: 'ephemeral' },
        })
        expect(content[1]).toEqual({
          type: 'text',
          text: 'Non-cached content',
        })
      })

      it('formats system prompt string without cache', async () => {
        const { captured, mockClient } = setupCapture()
        const provider = new AnthropicModel({ client: mockClient })
        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        await collectIterator(provider.stream(messages, { systemPrompt: 'System instruction' }))

        expect(captured.request.system).toBe('System instruction')
      })

      it('formats system prompt array with cache points', async () => {
        const { captured, mockClient } = setupCapture()
        const provider = new AnthropicModel({ client: mockClient })
        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]
        const systemPrompt = [
          new TextBlock('Heavy context'),
          new CachePointBlock({ cacheType: 'default' }),
          new TextBlock('Light context'),
        ]

        await collectIterator(provider.stream(messages, { systemPrompt }))

        expect(Array.isArray(captured.request.system)).toBe(true)
        const system = captured.request.system
        expect(system).toHaveLength(2)
        expect(system[0]).toEqual({
          type: 'text',
          text: 'Heavy context',
          cache_control: { type: 'ephemeral' },
        })
        expect(system[1]).toEqual({
          type: 'text',
          text: 'Light context',
        })
      })
    })

    describe('Media blocks', () => {
      it('formats images correctly', async () => {
        const { captured, mockClient } = setupCapture()
        const provider = new AnthropicModel({ client: mockClient })
        const imageBytes = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [
              new ImageBlock({
                format: 'png',
                source: { bytes: imageBytes },
              }),
            ],
          },
        ]

        await collectIterator(provider.stream(messages))

        const content = captured.request.messages[0].content[0]
        expect(content.type).toBe('image')
        expect(content.source.media_type).toBe('image/png')
        // Base64 of "Hello" is "SGVsbG8="
        expect(content.source.data).toBe('SGVsbG8=')
      })

      it('formats PDFs correctly', async () => {
        const { captured, mockClient } = setupCapture()
        const provider = new AnthropicModel({ client: mockClient })
        const pdfBytes = new Uint8Array([1, 2, 3])
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [
              new DocumentBlock({
                name: 'doc.pdf',
                format: 'pdf',
                source: { bytes: pdfBytes },
              }),
            ],
          },
        ]

        await collectIterator(provider.stream(messages))

        const content = captured.request.messages[0].content[0]
        expect(content.type).toBe('document')
        expect(content.source.media_type).toBe('application/pdf')
      })

      it('logs warning for unsupported GuardContentBlock in user message', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) // Spy on console.warn (via logger)
        const { captured, mockClient } = setupCapture()
        const provider = new AnthropicModel({ client: mockClient })
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [
              new GuardContentBlock({
                text: { text: 'guard', qualifiers: ['query'] },
              }),
            ],
          },
        ]

        await collectIterator(provider.stream(messages))

        // Should result in empty content if blocked
        expect(captured.request.messages[0].content).toHaveLength(0)
        warnSpy.mockRestore()
      })
    })

    describe('Tool Results', () => {
      it('formats simple text tool result', async () => {
        const { captured, mockClient } = setupCapture()
        const provider = new AnthropicModel({ client: mockClient })
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'toolResultBlock',
                toolUseId: 't1',
                status: 'success',
                content: [{ type: 'textBlock', text: '42' }],
              },
            ],
          },
        ]

        await collectIterator(provider.stream(messages))

        const content = captured.request.messages[0].content[0]
        expect(content.type).toBe('tool_result')
        expect(content.tool_use_id).toBe('t1')
        expect(content.content).toBe('42') // Simplified to string
        expect(content.is_error).toBe(false)
      })

      it('formats mixed tool result (json/image)', async () => {
        const { captured, mockClient } = setupCapture()
        const provider = new AnthropicModel({ client: mockClient })
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'toolResultBlock',
                toolUseId: 't1',
                status: 'error',
                content: [
                  { type: 'jsonBlock', json: { error: 'failed' } },
                  { type: 'textBlock', text: 'Details here' },
                ],
              },
            ],
          },
        ]

        await collectIterator(provider.stream(messages))

        const content = captured.request.messages[0].content[0]
        expect(content.type).toBe('tool_result')
        expect(content.is_error).toBe(true)
        expect(Array.isArray(content.content)).toBe(true)
        // JSON is stringified in Anthropic tool result content
        expect(content.content[0]).toEqual({ type: 'text', text: '{"error":"failed"}' })
        expect(content.content[1]).toEqual({ type: 'text', text: 'Details here' })
      })
    })
  })
})
