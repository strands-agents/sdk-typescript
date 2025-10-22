import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { BedrockModelProvider } from '../bedrock'
import { ContextWindowOverflowError } from '../../errors'
import type { Message } from '../../types/messages'
import type { StreamOptions } from '../model'

// Mock the AWS SDK
vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  const mockSend = vi.fn(
    async (): Promise<{ stream: AsyncIterable<unknown> }> => ({
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
    })
  )

  // Create a mock ValidationException class
  class MockValidationException extends Error {
    constructor(opts: { message: string; $metadata: Record<string, unknown> }) {
      super(opts.message)
      this.name = 'ValidationException'
    }
  }

  return {
    BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    ConverseStreamCommand: vi.fn(),
    ValidationException: MockValidationException,
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
    it('creates an instance with default configuration when region is provided', () => {
      const provider = new BedrockModelProvider({ region: 'us-west-2' })
      const config = provider.getConfig()
      expect(config.modelId).toBeDefined()
      expect(config.modelId).toContain('anthropic.claude')
    })

    it('uses provided model ID', () => {
      const customModelId = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
      const provider = new BedrockModelProvider({ region: 'us-west-2', modelId: customModelId })
      expect(provider.getConfig().modelId).toBe(customModelId)
    })

    it('uses provided region', () => {
      const customRegion = 'eu-west-1'
      new BedrockModelProvider({ region: customRegion })
      expect(BedrockRuntimeClient).toHaveBeenCalledWith({
        region: customRegion,
        customUserAgent: 'strands-agents-ts-sdk',
      })
    })

    it('extends custom user agent if provided', () => {
      const customAgent = 'my-app/1.0'
      new BedrockModelProvider({ region: 'us-west-2', clientConfig: { customUserAgent: customAgent } })
      expect(BedrockRuntimeClient).toHaveBeenCalledWith({
        region: 'us-west-2',
        customUserAgent: 'my-app/1.0 strands-agents-ts-sdk',
      })
    })

    it('passes custom endpoint to client', () => {
      const endpoint = 'https://vpce-abc.bedrock-runtime.us-west-2.vpce.amazonaws.com'
      const region = 'us-west-2'
      new BedrockModelProvider({ region, clientConfig: { endpoint } })
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
      new BedrockModelProvider({ region, clientConfig: { credentials } })
      expect(BedrockRuntimeClient).toHaveBeenCalledWith({
        region,
        credentials,
        customUserAgent: 'strands-agents-ts-sdk',
      })
    })
  })

  describe('updateConfig', () => {
    it('merges new config with existing config', () => {
      const provider = new BedrockModelProvider({ region: 'us-west-2', temperature: 0.5 })
      provider.updateConfig({ temperature: 0.8, maxTokens: 2048 })
      const config = provider.getConfig()
      expect(config.temperature).toBe(0.8)
      expect(config.maxTokens).toBe(2048)
    })

    it('preserves fields not included in the update', () => {
      const provider = new BedrockModelProvider({
        region: 'us-west-2',
        modelId: 'custom-model',
        temperature: 0.5,
        maxTokens: 1024,
      })
      provider.updateConfig({ temperature: 0.8 })
      const config = provider.getConfig()
      expect(config.modelId).toBe('custom-model')
      expect(config.temperature).toBe(0.8)
      expect(config.maxTokens).toBe(1024)
    })
  })

  describe('getConfig', () => {
    it('returns the current configuration', () => {
      const provider = new BedrockModelProvider({
        region: 'us-west-2',
        modelId: 'test-model',
        maxTokens: 1024,
        temperature: 0.7,
      })
      const config = provider.getConfig()
      expect(config.modelId).toBe('test-model')
      expect(config.maxTokens).toBe(1024)
      expect(config.temperature).toBe(0.7)
    })
  })

  describe('format_message', () => {
    it('formats the request to bedrock properly', async () => {
      const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime')
      const mockConverseStreamCommand = vi.mocked(ConverseStreamCommand)

      const provider = new BedrockModelProvider({
        region: 'us-west-2',
        modelId: 'test-model',
        maxTokens: 1024,
        temperature: 0.7,
        topP: 0.9,
        stopSequences: ['STOP'],
        cachePrompt: 'default',
        cacheTools: 'default',
        additionalResponseFieldPaths: ['Hello!'],
        additionalRequestFields: ['World!'],
        additionalArgs: {
          MyExtraArg: 'ExtraArg',
        },
      })

      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const options: StreamOptions = {
        systemPrompt: 'You are a helpful assistant',
        toolSpecs: [
          {
            name: 'calculator',
            description: 'Perform calculations',
            inputSchema: { type: 'object', properties: { expression: { type: 'string' } } },
          },
        ],
        toolChoice: { auto: {} },
      }

      // Trigger the stream to make the request
      const stream = provider.stream(messages, options)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _event of stream) {
        break // Just need to trigger the request
      }

      // Verify ConverseStreamCommand was called with properly formatted request
      expect(mockConverseStreamCommand).toHaveBeenCalledWith({
        MyExtraArg: 'ExtraArg',
        additionalModelRequestFields: ['World!'],
        additionalModelResponseFieldPaths: ['Hello!'],
        modelId: 'test-model',
        messages: [
          {
            role: 'user',
            content: [{ text: 'Hello' }],
          },
        ],
        system: [{ text: 'You are a helpful assistant' }, { cachePoint: { type: 'default' } }],
        toolConfig: {
          toolChoice: { auto: {} },
          tools: [
            {
              toolSpec: {
                name: 'calculator',
                description: 'Perform calculations',
                inputSchema: { json: { type: 'object', properties: { expression: { type: 'string' } } } },
              },
            },
            { cachePoint: { type: 'default' } },
          ],
        },
        inferenceConfig: {
          maxTokens: 1024,
          temperature: 0.7,
          topP: 0.9,
          stopSequences: ['STOP'],
        },
      })
    })
  })

  describe('stream', () => {
    it('yields message start event', async () => {
      const provider = new BedrockModelProvider({ region: 'us-west-2' })
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
      const provider = new BedrockModelProvider({ region: 'us-west-2' })
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
      const provider = new BedrockModelProvider({ region: 'us-west-2' })
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
      const provider = new BedrockModelProvider({ region: 'us-west-2' })
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
      const provider = new BedrockModelProvider({ region: 'us-west-2' })
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
      const provider = new BedrockModelProvider({ region: 'us-west-2' })
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            {
              type: 'toolResultBlock',
              toolUseId: 'tool-123',
              status: 'success',
              content: [
                { type: 'toolResultTextContent', text: 'Result: 8' },
                { type: 'toolResultJsonContent', json: { hello: 'world' } },
              ],
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

    it('formats reasoning messages properly', async () => {
      const provider = new BedrockModelProvider({ region: 'us-west-2' })
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            {
              type: 'reasoningBlock',
              text: 'Hello',
              signature: 'World',
            },
            {
              type: 'reasoningBlock',
              redactedContent: new Uint8Array(1),
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

      const provider = new BedrockModelProvider({ region: 'us-west-2' })
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of provider.stream(messages)) {
          // Should not reach here
        }
      }).rejects.toThrow(ContextWindowOverflowError)
    })

    it('throws ValidationException', async () => {
      vi.clearAllMocks()
      const { ValidationException } = await import('@aws-sdk/client-bedrock-runtime')
      const error = new ValidationException({ message: 'ValidationException', $metadata: {} })
      const mockSendError = vi.fn().mockRejectedValue(error)
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSendError }) as never)

      const provider = new BedrockModelProvider({ region: 'us-west-2' })
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of provider.stream(messages)) {
          // Should not reach here
        }
      }).rejects.toThrow(ValidationException)
    })

    it('handles tool use input delta', async () => {
      vi.clearAllMocks()
      const mockSend = vi.fn(
        async (): Promise<{ stream: AsyncIterable<unknown> }> => ({
          stream: (async function* (): AsyncGenerator<unknown> {
            yield { messageStart: { role: 'assistant' } }
            yield { contentBlockStart: { contentBlockIndex: 0, start: { toolUse: { name: 'calc', toolUseId: 'id' } } } }
            yield { contentBlockDelta: { delta: { toolUse: { input: '{"a": 1}' } }, contentBlockIndex: 0 } }
            yield { contentBlockStop: { contentBlockIndex: 0 } }
            yield { messageStop: { stopReason: 'tool_use' } }
            yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
          })(),
        })
      )
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)

      const provider = new BedrockModelProvider({ region: 'us-west-2' })
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = []
      for await (const event of provider.stream(messages)) {
        events.push(event)
      }

      const toolDelta = events.find(
        (e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'toolUseInputDelta'
      )
      expect(toolDelta).toBeDefined()
      if (toolDelta?.type === 'modelContentBlockDeltaEvent' && toolDelta.delta.type === 'toolUseInputDelta') {
        expect(toolDelta.delta.input).toBe('{"a": 1}')
      }
    })

    it('handles reasoning content delta with both text and signature, as well as redactedContent', async () => {
      vi.clearAllMocks()
      const mockSend = vi.fn(
        async (): Promise<{ stream: AsyncIterable<unknown> }> => ({
          stream: (async function* (): AsyncGenerator<unknown> {
            yield { messageStart: { role: 'assistant' } }
            yield { contentBlockStart: { contentBlockIndex: 0 } }
            yield {
              contentBlockDelta: {
                delta: { reasoningContent: { text: 'thinking...', signature: 'sig123' } },
                contentBlockIndex: 0,
              },
            }
            yield {
              contentBlockDelta: {
                delta: { reasoningContent: { redactedContent: new Uint8Array(1) } },
                contentBlockIndex: 0,
              },
            }
            yield { contentBlockStop: { contentBlockIndex: 0 } }
            yield { messageStop: { stopReason: 'end_turn' } }
            yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
          })(),
        })
      )
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)

      const provider = new BedrockModelProvider({ region: 'us-west-2' })
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = []
      for await (const event of provider.stream(messages)) {
        events.push(event)
      }

      const reasoningDelta = events.find(
        (e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'reasoningDelta'
      )
      expect(reasoningDelta).toBeDefined()
      if (reasoningDelta?.type === 'modelContentBlockDeltaEvent' && reasoningDelta.delta.type === 'reasoningDelta') {
        expect(reasoningDelta.delta.text).toBe('thinking...')
        expect(reasoningDelta.delta.signature).toBe('sig123')
      }
    })

    it('handles reasoning content delta with only text, skips unsupported types', async () => {
      vi.clearAllMocks()
      const mockSend = vi.fn(
        async (): Promise<{ stream: AsyncIterable<unknown> }> => ({
          stream: (async function* (): AsyncGenerator<unknown> {
            yield { messageStart: { role: 'assistant' } }
            yield { contentBlockStart: { contentBlockIndex: 0 } }
            yield {
              contentBlockDelta: {
                delta: { reasoningContent: { text: 'thinking...' } },
                contentBlockIndex: 0,
              },
            }
            yield {
              contentBlockDelta: {
                delta: { unknown: 'type' },
                contentBlockIndex: 0,
              },
            }
            yield { contentBlockStop: { contentBlockIndex: 0 } }
            yield { messageStop: { stopReason: 'end_turn' } }
            yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
            yield { unknown: 'type' }
          })(),
        })
      )
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)

      const provider = new BedrockModelProvider({ region: 'us-west-2' })
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = []
      for await (const event of provider.stream(messages)) {
        events.push(event)
      }

      const reasoningDelta = events.find(
        (e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'reasoningDelta'
      )
      expect(reasoningDelta).toBeDefined()
      if (reasoningDelta?.type === 'modelContentBlockDeltaEvent' && reasoningDelta.delta.type === 'reasoningDelta') {
        expect(reasoningDelta.delta.text).toBe('thinking...')
        expect(reasoningDelta.delta.signature).toBeUndefined()
      }
    })

    it('handles reasoning content delta with only signature', async () => {
      vi.clearAllMocks()
      const mockSend = vi.fn(
        async (): Promise<{ stream: AsyncIterable<unknown> }> => ({
          stream: (async function* (): AsyncGenerator<unknown> {
            yield { messageStart: { role: 'assistant' } }
            yield { contentBlockStart: { contentBlockIndex: 0 } }
            yield {
              contentBlockDelta: {
                delta: { reasoningContent: { signature: 'sig123' } },
                contentBlockIndex: 0,
              },
            }
            yield { contentBlockStop: { contentBlockIndex: 0 } }
            yield { messageStop: { stopReason: 'end_turn' } }
            yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
          })(),
        })
      )
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)

      const provider = new BedrockModelProvider({ region: 'us-west-2' })
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = []
      for await (const event of provider.stream(messages)) {
        events.push(event)
      }

      const reasoningDelta = events.find(
        (e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'reasoningDelta'
      )
      expect(reasoningDelta).toBeDefined()
      if (reasoningDelta?.type === 'modelContentBlockDeltaEvent' && reasoningDelta.delta.type === 'reasoningDelta') {
        expect(reasoningDelta.delta.text).toBeUndefined()
        expect(reasoningDelta.delta.signature).toBe('sig123')
      }
    })

    it('handles cache usage metrics', async () => {
      vi.clearAllMocks()
      const mockSend = vi.fn(
        async (): Promise<{ stream: AsyncIterable<unknown> }> => ({
          stream: (async function* (): AsyncGenerator<unknown> {
            yield { messageStart: { role: 'assistant' } }
            yield { contentBlockStart: { contentBlockIndex: 0 } }
            yield { contentBlockDelta: { delta: { text: 'Hello' }, contentBlockIndex: 0 } }
            yield { contentBlockStop: { contentBlockIndex: 0 } }
            yield { messageStop: { stopReason: 'end_turn' } }
            yield {
              metadata: {
                usage: {
                  inputTokens: 100,
                  outputTokens: 50,
                  totalTokens: 150,
                  cacheReadInputTokens: 80,
                  cacheWriteInputTokens: 20,
                },
              },
            }
          })(),
        })
      )
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)

      const provider = new BedrockModelProvider({ region: 'us-west-2' })
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = []
      for await (const event of provider.stream(messages)) {
        events.push(event)
      }

      const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
      expect(metadataEvent).toBeDefined()
      if (metadataEvent?.type === 'modelMetadataEvent') {
        expect(metadataEvent.usage?.cacheReadInputTokens).toBe(80)
        expect(metadataEvent.usage?.cacheWriteInputTokens).toBe(20)
      }
    })

    it('handles trace in metadata', async () => {
      vi.clearAllMocks()
      const mockSend = vi.fn(
        async (): Promise<{ stream: AsyncIterable<unknown> }> => ({
          stream: (async function* (): AsyncGenerator<unknown> {
            yield { messageStart: { role: 'assistant' } }
            yield { contentBlockStart: { contentBlockIndex: 0 } }
            yield { contentBlockDelta: { delta: { text: 'Hello' }, contentBlockIndex: 0 } }
            yield { contentBlockStop: { contentBlockIndex: 0 } }
            yield { messageStop: { stopReason: 'end_turn' } }
            yield {
              metadata: {
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                trace: { guardrail: { action: 'INTERVENED' } },
              },
            }
          })(),
        })
      )
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)

      const provider = new BedrockModelProvider({ region: 'us-west-2' })
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = []
      for await (const event of provider.stream(messages)) {
        events.push(event)
      }

      const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
      expect(metadataEvent).toBeDefined()
      if (metadataEvent?.type === 'modelMetadataEvent') {
        expect(metadataEvent.trace).toBeDefined()
      }
    })

    it('handles additionalModelResponseFields', async () => {
      vi.clearAllMocks()
      const mockSend = vi.fn(
        async (): Promise<{ stream: AsyncIterable<unknown> }> => ({
          stream: (async function* (): AsyncGenerator<unknown> {
            yield { messageStart: { role: 'assistant' } }
            yield { contentBlockStart: { contentBlockIndex: 0 } }
            yield { contentBlockDelta: { delta: { text: 'Hello' }, contentBlockIndex: 0 } }
            yield { contentBlockStop: { contentBlockIndex: 0 } }
            yield { messageStop: { stopReason: 'end_turn', additionalModelResponseFields: { customField: 'value' } } }
            yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
          })(),
        })
      )
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)

      const provider = new BedrockModelProvider({ region: 'us-west-2' })
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = []
      for await (const event of provider.stream(messages)) {
        events.push(event)
      }

      const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(stopEvent).toBeDefined()
      if (stopEvent?.type === 'modelMessageStopEvent') {
        expect(stopEvent.additionalModelResponseFields).toBeDefined()
      }
    })

    it('handles all stop reason types', async () => {
      const stopReasons = [
        ['end_turn', 'endTurn'],
        ['tool_use', 'toolUse'],
        ['max_tokens', 'maxTokens'],
        ['stop_sequence', 'stopSequence'],
        ['content_filtered', 'contentFiltered'],
        ['guardrail_intervened', 'guardrailIntervened'],
        ['model_context_window_exceeded', 'modelContextWindowExceeded'],
      ]

      for (const [bedrockReason, expectedReason] of stopReasons) {
        vi.clearAllMocks()
        const mockSend = vi.fn(
          async (): Promise<{ stream: AsyncIterable<unknown> }> => ({
            stream: (async function* (): AsyncGenerator<unknown> {
              yield { messageStart: { role: 'assistant' } }
              yield { messageStop: { stopReason: bedrockReason } }
              yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
            })(),
          })
        )
        vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)

        const provider = new BedrockModelProvider({ region: 'us-west-2' })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

        const events = []
        for await (const event of provider.stream(messages)) {
          events.push(event)
        }

        const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
        expect(stopEvent).toBeDefined()
        expect(stopEvent?.stopReason).toBe(expectedReason)
      }
    })

    it('throws exception for error event types', async () => {
      vi.clearAllMocks()
      const testError = new Error('Internal server error')
      const mockSend = vi.fn(
        async (): Promise<{ stream: AsyncIterable<unknown> }> => ({
          stream: (async function* (): AsyncGenerator<unknown> {
            yield { messageStart: { role: 'assistant' } }
            yield { internalServerException: testError }
          })(),
        })
      )
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)

      const provider = new BedrockModelProvider({ region: 'us-west-2' })
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of provider.stream(messages)) {
          // Should throw before finishing
        }
      }).rejects.toThrow()
    })
  })
})
