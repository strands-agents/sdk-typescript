import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { BedrockModel } from '../bedrock'
import { ContextWindowOverflowError } from '../../errors'
import type { Message } from '../../types/messages'
import type { StreamOptions } from '../model'
import type { ModelStreamEvent } from '../streaming'

/**
 * Helper function to collect all events from a stream.
 */
async function collectEvents(stream: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = []
  for await (const event of stream) {
    events.push(event)
  }
  return events
}

/**
 * Helper function to setup mock send with custom stream generator.
 */
function setupMockSend(streamGenerator: () => AsyncGenerator<unknown>): void {
  vi.clearAllMocks()
  const mockSend = vi.fn(
    async (): Promise<{ stream: AsyncIterable<unknown> }> => ({
      stream: streamGenerator(),
    })
  )
  vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)
}

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

describe('BedrockModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.AWS_REGION
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('creates an instance with default configuration', () => {
      const provider = new BedrockModel()
      const config = provider.getConfig()
      expect(config.modelId).toBeDefined()
    })

    it('uses provided model ID ', () => {
      const customModelId = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
      const provider = new BedrockModel({ modelId: customModelId })
      expect(provider.getConfig()).toStrictEqual({
        modelId: customModelId,
      })
    })

    it('uses provided region', () => {
      const customRegion = 'eu-west-1'
      new BedrockModel({ region: customRegion })
      expect(BedrockRuntimeClient).toHaveBeenCalledWith({
        region: customRegion,
        customUserAgent: 'strands-agents-ts-sdk',
      })
    })

    it('extends custom user agent if provided', () => {
      const customAgent = 'my-app/1.0'
      new BedrockModel({ region: 'us-west-2', clientConfig: { customUserAgent: customAgent } })
      expect(BedrockRuntimeClient).toHaveBeenCalledWith({
        region: 'us-west-2',
        customUserAgent: 'my-app/1.0 strands-agents-ts-sdk',
      })
    })

    it('passes custom endpoint to client', () => {
      const endpoint = 'https://vpce-abc.bedrock-runtime.us-west-2.vpce.amazonaws.com'
      const region = 'us-west-2'
      new BedrockModel({ region, clientConfig: { endpoint } })
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
      new BedrockModel({ region, clientConfig: { credentials } })
      expect(BedrockRuntimeClient).toHaveBeenCalledWith({
        region,
        credentials,
        customUserAgent: 'strands-agents-ts-sdk',
      })
    })
  })

  describe('updateConfig', () => {
    it('merges new config with existing config', () => {
      const provider = new BedrockModel({ region: 'us-west-2', temperature: 0.5 })
      provider.updateConfig({ temperature: 0.8, maxTokens: 2048 })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
        temperature: 0.8,
        maxTokens: 2048,
      })
    })

    it('preserves fields not included in the update', () => {
      const provider = new BedrockModel({
        region: 'us-west-2',
        modelId: 'custom-model',
        temperature: 0.5,
        maxTokens: 1024,
      })
      provider.updateConfig({ temperature: 0.8 })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'custom-model',
        temperature: 0.8,
        maxTokens: 1024,
      })
    })
  })

  describe('getConfig', () => {
    it('returns the current configuration', () => {
      const provider = new BedrockModel({
        region: 'us-west-2',
        modelId: 'test-model',
        maxTokens: 1024,
        temperature: 0.7,
      })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'test-model',
        maxTokens: 1024,
        temperature: 0.7,
      })
    })
  })

  describe('format_message', async () => {
    const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime')
    const mockConverseStreamCommand = vi.mocked(ConverseStreamCommand)
    it('formats the request to bedrock properly', async () => {
      const provider = new BedrockModel({
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

      // Trigger the stream to make the request, but ignore the events for now
      collectEvents(provider.stream(messages, options))

      // Verify ConverseStreamCommand was called with properly formatted request
      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
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

    it('formats tool use messages', async () => {
      const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime')
      const mockConverseStreamCommand = vi.mocked(ConverseStreamCommand)
      const provider = new BedrockModel()
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

      // Run the stream but ignore the output
      collectEvents(provider.stream(messages))

      // Verify ConverseStreamCommand was called with properly formatted request
      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'assistant',
              content: expect.arrayContaining([
                expect.objectContaining({
                  toolUse: expect.objectContaining({
                    name: 'calculator',
                    toolUseId: 'tool-123',
                    input: { a: 5, b: 3 },
                  }),
                }),
              ]),
            }),
          ]),
        })
      )
    })

    it('formats tool result messages', async () => {
      const provider = new BedrockModel()
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

      // Start the stream
      collectEvents(provider.stream(messages))

      // Verify ConverseStreamCommand was called with properly formatted request
      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
        messages: [
          {
            content: [
              {
                toolResult: {
                  content: [
                    {
                      text: 'Result: 8',
                    },
                    {
                      json: {
                        hello: 'world',
                      },
                    },
                  ],
                  status: 'success',
                  toolUseId: 'tool-123',
                },
              },
            ],
            role: 'user',
          },
        ],
        modelId: expect.any(String),
      })
    })

    it('formats reasoning messages properly', async () => {
      const provider = new BedrockModel()
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

      // Start the stream but don't await it
      collectEvents(provider.stream(messages))

      // Verify ConverseStreamCommand was called with properly formatted request
      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
        messages: [
          {
            role: 'user',
            content: [
              {
                reasoningContent: {
                  reasoningText: {
                    signature: 'World',
                    text: 'Hello',
                  },
                },
              },
              {
                reasoningContent: {
                  redactedContent: new Uint8Array(1),
                },
              },
            ],
          },
        ],
        modelId: expect.any(String),
      })
    })

    it('formats cache point blocks in messages', async () => {
      const provider = new BedrockModel()
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'textBlock', text: 'Message with cache point' },
            { type: 'cachePointBlock', cacheType: 'default' },
          ],
        },
      ]

      collectEvents(provider.stream(messages))

      // Verify ConverseStreamCommand was called with properly formatted request
      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
        messages: [
          {
            role: 'user',
            content: [{ text: 'Message with cache point' }, { cachePoint: { type: 'default' } }],
          },
        ],
        modelId: expect.any(String),
      })
    })
  })

  describe('stream', () => {
    it('yields and validate events', async () => {
      const provider = new BedrockModel()
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectEvents(provider.stream(messages))

      expect(events).toStrictEqual([
        {
          role: 'assistant',
          type: 'modelMessageStartEvent',
        },
        {
          type: 'modelContentBlockStartEvent',
        },
        {
          delta: {
            text: 'Hello',
            type: 'textDelta',
          },
          type: 'modelContentBlockDeltaEvent',
        },
        {
          type: 'modelContentBlockStopEvent',
        },
        {
          stopReason: 'endTurn',
          type: 'modelMessageStopEvent',
        },
        {
          metrics: {
            latencyMs: 100,
          },
          type: 'modelMetadataEvent',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
        },
      ])
    })

    it('throws ContextWindowOverflowError for context overflow', async () => {
      vi.clearAllMocks()
      const mockSendError = vi.fn().mockRejectedValue(new Error('Input is too long for requested model'))
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSendError }) as never)

      const provider = new BedrockModel()
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      let eventCount = 0
      await expect(async () => {
        await collectEvents(provider.stream(messages))
      }).rejects.toThrow(ContextWindowOverflowError)

      // Verify no events were yielded before error was thrown
      expect(eventCount).toBe(0)
    })

    it('throws ValidationException', async () => {
      vi.clearAllMocks()
      const { ValidationException } = await import('@aws-sdk/client-bedrock-runtime')
      const error = new ValidationException({ message: 'ValidationException', $metadata: {} })
      const mockSendError = vi.fn().mockRejectedValue(error)
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSendError }) as never)

      const provider = new BedrockModel()
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      let eventCount = 0
      await expect(async () => {
        await collectEvents(provider.stream(messages))
      }).rejects.toThrow(ValidationException)

      // Verify no events were yielded before error was thrown
      expect(eventCount).toBe(0)
    })

    it('handles tool use input delta', async () => {
      setupMockSend(async function* () {
        yield { messageStart: { role: 'assistant' } }
        yield {
          contentBlockStart: { contentBlockIndex: 0, start: { toolUse: { name: 'calc', toolUseId: 'id' } } },
        }
        yield { contentBlockDelta: { delta: { toolUse: { input: '{"a": 1}' } }, contentBlockIndex: 0 } }
        yield { contentBlockStop: { contentBlockIndex: 0 } }
        yield { messageStop: { stopReason: 'tool_use' } }
        yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
      })

      const provider = new BedrockModel()
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectEvents(provider.stream(messages))

      expect(events[2]).toStrictEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'toolUseInputDelta',
          input: '{"a": 1}',
        },
      })
    })

    it('handles reasoning content delta with both text and signature, as well as redactedContent', async () => {
      setupMockSend(async function* () {
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
      })

      const provider = new BedrockModel()
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectEvents(provider.stream(messages))

      expect(events[2]).toStrictEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'reasoningDelta',
          text: 'thinking...',
          signature: 'sig123',
        },
      })
      expect(events[3]).toStrictEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'reasoningDelta',
          redactedContent: new Uint8Array(1),
        },
      })
    })

    it('handles reasoning content delta with only text, skips unsupported types', async () => {
      setupMockSend(async function* () {
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
      })

      const provider = new BedrockModel()
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectEvents(provider.stream(messages))

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
      setupMockSend(async function* () {
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
      })

      const provider = new BedrockModel()
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectEvents(provider.stream(messages))

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
      setupMockSend(async function* () {
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
      })

      const provider = new BedrockModel()
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectEvents(provider.stream(messages))

      const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
      expect(metadataEvent).toBeDefined()
      expect(metadataEvent?.usage?.cacheReadInputTokens).toBe(80)
      expect(metadataEvent?.usage?.cacheWriteInputTokens).toBe(20)
    })

    it('handles trace in metadata', async () => {
      setupMockSend(async function* () {
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
      })

      const provider = new BedrockModel()
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectEvents(provider.stream(messages))

      const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
      expect(metadataEvent).toBeDefined()
      expect(metadataEvent?.trace).toBeDefined()
    })

    it('handles additionalModelResponseFields', async () => {
      setupMockSend(async function* () {
        yield { messageStart: { role: 'assistant' } }
        yield { contentBlockStart: { contentBlockIndex: 0 } }
        yield { contentBlockDelta: { delta: { text: 'Hello' }, contentBlockIndex: 0 } }
        yield { contentBlockStop: { contentBlockIndex: 0 } }
        yield { messageStop: { stopReason: 'end_turn', additionalModelResponseFields: { customField: 'value' } } }
        yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
      })

      const provider = new BedrockModel()
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectEvents(provider.stream(messages))

      const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(stopEvent).toBeDefined()
      if (stopEvent?.type === 'modelMessageStopEvent') {
        expect(stopEvent.additionalModelResponseFields).toBeDefined()
      }
    })

    describe('handles all stop reason types', () => {
      const stopReasons = [
        ['end_turn', 'endTurn'],
        ['tool_use', 'toolUse'],
        ['max_tokens', 'maxTokens'],
        ['stop_sequence', 'stopSequence'],
        ['content_filtered', 'contentFiltered'],
        ['guardrail_intervened', 'guardrailIntervened'],
        ['model_context_window_exceeded', 'modelContextWindowExceeded'],
        ['new_stop_reason', 'newStopReason'],
      ]
      for (const [bedrockReason, expectedReason] of stopReasons) {
        it(`handles ${bedrockReason} stop reason types`, async () => {
          setupMockSend(async function* () {
            yield { messageStart: { role: 'assistant' } }
            yield { messageStop: { stopReason: bedrockReason } }
            yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
          })

          const provider = new BedrockModel()
          const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

          const events = []
          for await (const event of provider.stream(messages)) {
            events.push(event)
          }

          const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
          expect(stopEvent).toBeDefined()
          expect(stopEvent?.stopReason).toBe(expectedReason)
        })
      }
    })
  })

  describe('system prompt formatting', async () => {
    const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime')
    const mockConverseStreamCommand = vi.mocked(ConverseStreamCommand)

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('formats string system prompt with cachePrompt config', async () => {
      const provider = new BedrockModel({ cachePrompt: 'default' })
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const options: StreamOptions = {
        systemPrompt: 'You are a helpful assistant',
      }

      collectEvents(provider.stream(messages, options))

      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
        modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
        messages: [
          {
            role: 'user',
            content: [{ text: 'Hello' }],
          },
        ],
        system: [{ text: 'You are a helpful assistant' }, { cachePoint: { type: 'default' } }],
      })
    })

    it('formats array system prompt with text blocks only', async () => {
      const provider = new BedrockModel()
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const options: StreamOptions = {
        systemPrompt: [
          { type: 'textBlock', text: 'You are a helpful assistant' },
          { type: 'textBlock', text: 'Additional context here' },
        ],
      }

      collectEvents(provider.stream(messages, options))

      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
        modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
        messages: [
          {
            role: 'user',
            content: [{ text: 'Hello' }],
          },
        ],
        system: [{ text: 'You are a helpful assistant' }, { text: 'Additional context here' }],
      })
    })

    it('formats array system prompt with cache points', async () => {
      const provider = new BedrockModel()
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const options: StreamOptions = {
        systemPrompt: [
          { type: 'textBlock', text: 'You are a helpful assistant' },
          { type: 'textBlock', text: 'Large context document' },
          { type: 'cachePointBlock', cacheType: 'default' },
        ],
      }

      collectEvents(provider.stream(messages, options))

      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
        modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
        messages: [
          {
            role: 'user',
            content: [{ text: 'Hello' }],
          },
        ],
        system: [
          { text: 'You are a helpful assistant' },
          { text: 'Large context document' },
          { cachePoint: { type: 'default' } },
        ],
      })
    })

    it('warns when both array system prompt and cachePrompt config are provided', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const provider = new BedrockModel({ cachePrompt: 'default' })
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const options: StreamOptions = {
        systemPrompt: [
          { type: 'textBlock', text: 'You are a helpful assistant' },
          { type: 'cachePointBlock', cacheType: 'default' },
        ],
      }

      collectEvents(provider.stream(messages, options))

      // Verify warning was logged
      expect(warnSpy).toHaveBeenCalledWith(
        'cachePrompt config is ignored when systemPrompt is an array. Use explicit cache points in the array instead.'
      )

      // Verify array is used as-is (cachePrompt config ignored)
      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
        modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
        messages: [
          {
            role: 'user',
            content: [{ text: 'Hello' }],
          },
        ],
        system: [{ text: 'You are a helpful assistant' }, { cachePoint: { type: 'default' } }],
      })

      warnSpy.mockRestore()
    })

    it('handles empty array system prompt', async () => {
      const provider = new BedrockModel()
      const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const options: StreamOptions = {
        systemPrompt: [],
      }

      collectEvents(provider.stream(messages, options))

      // Empty array should not set system field
      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
        modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
        messages: [
          {
            role: 'user',
            content: [{ text: 'Hello' }],
          },
        ],
      })
    })
  })
})
