import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { isNode } from '../../__fixtures__/environment.js'
import { BedrockModel } from '../bedrock.js'
import { ContextWindowOverflowError } from '../../errors.js'
import type { Message } from '../../types/messages.js'
import { TextBlock, GuardContentBlock, CachePointBlock } from '../../types/messages.js'
import type { StreamOptions } from '../model.js'
import { collectIterator } from '../../__fixtures__/model-test-helpers.js'

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
vi.mock('@aws-sdk/client-bedrock-runtime', async (importOriginal) => {
  const originalModule = await importOriginal<typeof import('@aws-sdk/client-bedrock-runtime')>()

  // Mock command classes that the code under test will instantiate
  const ConverseStreamCommand = vi.fn()
  const ConverseCommand = vi.fn()

  const mockSend = vi.fn(async (command: unknown) => {
    // Check which constructor was used to create the command object
    if (command instanceof ConverseStreamCommand) {
      // Return a streaming response
      return {
        stream: (async function* (): AsyncGenerator<unknown> {
          yield { messageStart: { role: 'assistant' } }
          yield { contentBlockStart: {} }
          yield { contentBlockDelta: { delta: { text: 'Hello' } } }
          yield { contentBlockStop: {} }
          yield { messageStop: { stopReason: 'end_turn' } }
          yield {
            metadata: {
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              metrics: { latencyMs: 100 },
            },
          }
        })(),
      }
    }

    if (command instanceof ConverseCommand) {
      // Return a non-streaming (full) response for the non-streaming API
      return {
        output: {
          message: {
            role: 'assistant',
            content: [{ text: 'Hello' }],
          },
        },
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        metrics: { latencyMs: 100 },
      }
    }

    throw new Error('Unhandled command type in mock')
  })

  // Create a mock ValidationException class
  class MockValidationException extends Error {
    constructor(opts: { message: string; $metadata: Record<string, unknown> }) {
      super(opts.message)
      this.name = 'ValidationException'
    }
  }

  return {
    ...originalModule,
    BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    ConverseStreamCommand,
    ConverseCommand,
    ValidationException: MockValidationException,
  }
})

describe('BedrockModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clean up AWS_REGION env var in Node.js only
    if (isNode && process.env) {
      delete process.env.AWS_REGION
    }
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

      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

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
      collectIterator(provider.stream(messages, options))

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
          type: 'message',
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
      collectIterator(provider.stream(messages))

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
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'toolResultBlock',
              toolUseId: 'tool-123',
              status: 'success',
              content: [
                { type: 'textBlock', text: 'Result: 8' },
                { type: 'jsonBlock', json: { hello: 'world' } },
              ],
            },
          ],
        },
      ]

      // Start the stream
      collectIterator(provider.stream(messages))

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
          type: 'message',
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
      collectIterator(provider.stream(messages))

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
          type: 'message',
          role: 'user',
          content: [
            { type: 'textBlock', text: 'Message with cache point' },
            { type: 'cachePointBlock', cacheType: 'default' },
          ],
        },
      ]

      collectIterator(provider.stream(messages))

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

  describe.each([
    { mode: 'streaming', stream: true },
    { mode: 'non-streaming', stream: false },
  ])('BedrockModel in $mode mode', ({ stream }) => {
    it('yields and validates text events correctly', async () => {
      const mockSend = vi.fn(async () => {
        if (stream) {
          return {
            stream: (async function* (): AsyncGenerator<unknown> {
              yield { messageStart: { role: 'assistant' } }
              yield { contentBlockStart: {} }
              yield { contentBlockDelta: { delta: { text: 'Hello' } } }
              yield { contentBlockStop: {} }
              yield { messageStop: { stopReason: 'end_turn' } }
              yield {
                metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, metrics: { latencyMs: 100 } },
              }
            })(),
          }
        } else {
          return {
            output: { message: { role: 'assistant', content: [{ text: 'Hello' }] } },
            stopReason: 'end_turn',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            metrics: { latencyMs: 100 },
          }
        }
      })

      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)

      const provider = new BedrockModel({ stream })
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const events = await collectIterator(provider.stream(messages))

      expect(events).toContainEqual({ role: 'assistant', type: 'modelMessageStartEvent' })
      expect(events).toContainEqual({ type: 'modelContentBlockStartEvent' })
      expect(events).toContainEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'textDelta', text: 'Hello' },
      })
      expect(events).toContainEqual({ type: 'modelContentBlockStopEvent' })
      expect(events).toContainEqual({ type: 'modelMessageStopEvent', stopReason: 'endTurn' })
      expect(events).toContainEqual({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        metrics: { latencyMs: 100 },
      })
    })

    it('yields and validates toolUse events correctly', async () => {
      const mockSend = vi.fn(async () => {
        if (stream) {
          return {
            stream: (async function* (): AsyncGenerator<unknown> {
              yield { messageStart: { role: 'assistant' } }
              yield {
                contentBlockStart: {
                  start: { toolUse: { toolUseId: 'tool-use-123', name: 'get_weather' } },
                },
              }
              yield {
                contentBlockDelta: {
                  delta: { toolUse: { input: '{"location":"San Francisco"}' } },
                },
              }
              yield { contentBlockStop: {} }
              yield { messageStop: { stopReason: 'tool_use' } }
              yield {
                metadata: {
                  usage: { inputTokens: 10, outputTokens: 25, totalTokens: 35 },
                  metrics: { latencyMs: 120 },
                },
              }
            })(),
          }
        } else {
          return {
            output: {
              message: {
                role: 'assistant',
                content: [
                  { toolUse: { toolUseId: 'tool-use-123', name: 'get_weather', input: { location: 'San Francisco' } } },
                ],
              },
            },
            stopReason: 'tool_use',
            usage: { inputTokens: 10, outputTokens: 25, totalTokens: 35 },
            metrics: { latencyMs: 120 },
          }
        }
      })
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)

      const provider = new BedrockModel({ stream })
      const messages: Message[] = [
        { type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Weather?' }] },
      ]
      const events = await collectIterator(provider.stream(messages))
      const startEvent = events.find((e) => e.type === 'modelContentBlockStartEvent')
      const inputDeltaEvent = events.find(
        (e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'toolUseInputDelta'
      )

      expect(events).toContainEqual({ role: 'assistant', type: 'modelMessageStartEvent' })
      expect(startEvent).toStrictEqual({
        type: 'modelContentBlockStartEvent',
        start: { type: 'toolUseStart', name: 'get_weather', toolUseId: 'tool-use-123' },
      })
      expect(inputDeltaEvent).toStrictEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'toolUseInputDelta', input: '{"location":"San Francisco"}' },
      })
      expect(events).toContainEqual({ type: 'modelContentBlockStopEvent' })
      expect(events).toContainEqual({ stopReason: 'toolUse', type: 'modelMessageStopEvent' })
      expect(events).toContainEqual({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 25, totalTokens: 35 },
        metrics: { latencyMs: 120 },
      })
    })

    it('yields and validates reasoningText events correctly', async () => {
      const mockSend = vi.fn(async () => {
        if (stream) {
          return {
            stream: (async function* (): AsyncGenerator<unknown> {
              yield { messageStart: { role: 'assistant' } }
              yield { contentBlockStart: {} }
              yield {
                contentBlockDelta: { delta: { reasoningContent: { text: 'Thinking...' } } },
              }
              yield { contentBlockStop: {} }
              yield { messageStop: { stopReason: 'end_turn' } }
              yield {
                metadata: {
                  usage: { inputTokens: 15, outputTokens: 30, totalTokens: 45 },
                  metrics: { latencyMs: 150 },
                },
              }
            })(),
          }
        } else {
          return {
            output: {
              message: {
                role: 'assistant',
                content: [{ reasoningContent: { reasoningText: { text: 'Thinking...' } } }],
              },
            },
            stopReason: 'end_turn',
            usage: { inputTokens: 15, outputTokens: 30, totalTokens: 45 },
            metrics: { latencyMs: 150 },
          }
        }
      })
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)

      const provider = new BedrockModel({ stream })
      const messages: Message[] = [
        { type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'A question.' }] },
      ]
      const events = await collectIterator(provider.stream(messages))

      expect(events).toContainEqual({ role: 'assistant', type: 'modelMessageStartEvent' })
      expect(events).toContainEqual({ type: 'modelContentBlockStartEvent' })
      expect(events).toContainEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'reasoningContentDelta', text: 'Thinking...' },
      })
      expect(events).toContainEqual({ type: 'modelContentBlockStopEvent' })
      expect(events).toContainEqual({ stopReason: 'endTurn', type: 'modelMessageStopEvent' })
      expect(events).toContainEqual({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 15, outputTokens: 30, totalTokens: 45 },
        metrics: { latencyMs: 150 },
      })
    })

    it('yields and validates redactedContent events correctly', async () => {
      const redactedBytes = new Uint8Array([1, 2, 3])

      const mockSend = vi.fn(async () => {
        if (stream) {
          return {
            stream: (async function* (): AsyncGenerator<unknown> {
              yield { messageStart: { role: 'assistant' } }
              yield { contentBlockStart: {} }
              yield {
                contentBlockDelta: {
                  delta: { reasoningContent: { redactedContent: redactedBytes } },
                },
              }
              yield { contentBlockStop: {} }
              yield { messageStop: { stopReason: 'end_turn' } }
              yield {
                metadata: { usage: { inputTokens: 15, outputTokens: 5, totalTokens: 20 }, metrics: { latencyMs: 110 } },
              }
            })(),
          }
        } else {
          return {
            output: {
              message: {
                role: 'assistant',
                content: [{ reasoningContent: { redactedContent: redactedBytes } }],
              },
            },
            stopReason: 'end_turn',
            usage: { inputTokens: 15, outputTokens: 5, totalTokens: 20 },
            metrics: { latencyMs: 110 },
          }
        }
      })
      vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSend }) as never)

      const provider = new BedrockModel({ stream })
      const messages: Message[] = [
        { type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'A sensitive question.' }] },
      ]
      const events = await collectIterator(provider.stream(messages))

      expect(events).toContainEqual({ role: 'assistant', type: 'modelMessageStartEvent' })
      expect(events).toContainEqual({ type: 'modelContentBlockStartEvent' })
      expect(events).toContainEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'reasoningContentDelta', redactedContent: redactedBytes },
      })
      expect(events).toContainEqual({ type: 'modelContentBlockStopEvent' })
      expect(events).toContainEqual({ stopReason: 'endTurn', type: 'modelMessageStopEvent' })
      expect(events).toContainEqual({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 15, outputTokens: 5, totalTokens: 20 },
        metrics: { latencyMs: 110 },
      })
    })

    describe('error handling', async () => {
      const { ValidationException } = await import('@aws-sdk/client-bedrock-runtime')
      it.each([
        {
          name: 'ContextWindowOverflowError for context overflow',
          error: new Error('Input is too long for requested model'),
          expected: ContextWindowOverflowError,
        },
        {
          name: 'ValidationException for invalid input',
          error: new ValidationException({ message: 'ValidationException', $metadata: {} }),
          expected: ValidationException,
        },
      ])('throws $name', async ({ error, expected }) => {
        vi.clearAllMocks()
        const mockSendError = vi.fn().mockRejectedValue(error)
        vi.mocked(BedrockRuntimeClient).mockImplementation(() => ({ send: mockSendError }) as never)

        const provider = new BedrockModel()
        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

        await expect(collectIterator(provider.stream(messages))).rejects.toThrow(expected)
      })
    })
  })

  describe('stream', () => {
    it('handles tool use input delta', async () => {
      setupMockSend(async function* () {
        yield { messageStart: { role: 'assistant' } }
        yield {
          contentBlockStart: { start: { toolUse: { name: 'calc', toolUseId: 'id' } } },
        }
        yield { contentBlockDelta: { delta: { toolUse: { input: '{"a": 1}' } } } }
        yield { contentBlockStop: {} }
        yield { messageStop: { stopReason: 'tool_use' } }
        yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
      })

      const provider = new BedrockModel()
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectIterator(provider.stream(messages))

      expect(events).toContainEqual({
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
        yield { contentBlockStart: {} }
        yield {
          contentBlockDelta: {
            delta: { reasoningContent: { text: 'thinking...', signature: 'sig123' } },
          },
        }
        yield {
          contentBlockDelta: {
            delta: { reasoningContent: { redactedContent: new Uint8Array(1) } },
          },
        }
        yield { contentBlockStop: {} }
        yield { messageStop: { stopReason: 'end_turn' } }
        yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
      })

      const provider = new BedrockModel()
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectIterator(provider.stream(messages))

      expect(events).toContainEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'reasoningContentDelta',
          text: 'thinking...',
          signature: 'sig123',
        },
      })
      expect(events).toContainEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'reasoningContentDelta',
          redactedContent: new Uint8Array(1),
        },
      })
    })

    it('handles reasoning content delta with only text, skips unsupported types', async () => {
      setupMockSend(async function* () {
        yield { messageStart: { role: 'assistant' } }
        yield { contentBlockStart: {} }
        yield {
          contentBlockDelta: {
            delta: { reasoningContent: { text: 'thinking...' } },
          },
        }
        yield {
          contentBlockDelta: {
            delta: { unknown: 'type' },
          },
        }
        yield { contentBlockStop: {} }
        yield { messageStop: { stopReason: 'end_turn' } }
        yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
        yield { unknown: 'type' }
      })

      const provider = new BedrockModel()
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectIterator(provider.stream(messages))

      const reasoningDelta = events.find(
        (e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'reasoningContentDelta'
      )
      expect(reasoningDelta).toBeDefined()
      if (
        reasoningDelta?.type === 'modelContentBlockDeltaEvent' &&
        reasoningDelta.delta.type === 'reasoningContentDelta'
      ) {
        expect(reasoningDelta.delta.text).toBe('thinking...')
        expect(reasoningDelta.delta.signature).toBeUndefined()
      }
    })

    it('handles reasoning content delta with only signature', async () => {
      setupMockSend(async function* () {
        yield { messageStart: { role: 'assistant' } }
        yield { contentBlockStart: {} }
        yield {
          contentBlockDelta: {
            delta: { reasoningContent: { signature: 'sig123' } },
          },
        }
        yield { contentBlockStop: {} }
        yield { messageStop: { stopReason: 'end_turn' } }
        yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
      })

      const provider = new BedrockModel()
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectIterator(provider.stream(messages))

      const reasoningDelta = events.find(
        (e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'reasoningContentDelta'
      )
      expect(reasoningDelta).toBeDefined()
      if (
        reasoningDelta?.type === 'modelContentBlockDeltaEvent' &&
        reasoningDelta.delta.type === 'reasoningContentDelta'
      ) {
        expect(reasoningDelta.delta.text).toBeUndefined()
        expect(reasoningDelta.delta.signature).toBe('sig123')
      }
    })

    it('handles cache usage metrics', async () => {
      setupMockSend(async function* () {
        yield { messageStart: { role: 'assistant' } }
        yield { contentBlockStart: {} }
        yield { contentBlockDelta: { delta: { text: 'Hello' } } }
        yield { contentBlockStop: {} }
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
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectIterator(provider.stream(messages))

      const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
      expect(metadataEvent).toBeDefined()
      if (metadataEvent?.type === 'modelMetadataEvent') {
        expect(metadataEvent.usage?.cacheReadInputTokens).toBe(80)
        expect(metadataEvent.usage?.cacheWriteInputTokens).toBe(20)
      }
    })

    it('handles trace in metadata', async () => {
      setupMockSend(async function* () {
        yield { messageStart: { role: 'assistant' } }
        yield { contentBlockStart: {} }
        yield { contentBlockDelta: { delta: { text: 'Hello' } } }
        yield { contentBlockStop: {} }
        yield { messageStop: { stopReason: 'end_turn' } }
        yield {
          metadata: {
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            trace: { guardrail: { action: 'INTERVENED' } },
          },
        }
      })

      const provider = new BedrockModel()
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectIterator(provider.stream(messages))

      const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
      expect(metadataEvent).toBeDefined()
      if (metadataEvent?.type === 'modelMetadataEvent') {
        expect(metadataEvent.trace).toBeDefined()
      }
    })

    it('handles additionalModelResponseFields', async () => {
      setupMockSend(async function* () {
        yield { messageStart: { role: 'assistant' } }
        yield { contentBlockStart: {} }
        yield { contentBlockDelta: { delta: { text: 'Hello' } } }
        yield { contentBlockStop: {} }
        yield { messageStop: { stopReason: 'end_turn', additionalModelResponseFields: { customField: 'value' } } }
        yield { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
      })

      const provider = new BedrockModel()
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]

      const events = await collectIterator(provider.stream(messages))

      const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(stopEvent).toBeDefined()
      if (stopEvent?.type === 'modelMessageStopEvent') {
        expect(stopEvent.additionalModelResponseFields).toStrictEqual({ customField: 'value' })
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
          const messages: Message[] = [
            { type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] },
          ]

          const events = []
          for await (const event of provider.stream(messages)) {
            events.push(event)
          }

          const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
          expect(stopEvent).toBeDefined()
          if (stopEvent?.type === 'modelMessageStopEvent') {
            expect(stopEvent.stopReason).toBe(expectedReason)
          }
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
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const options: StreamOptions = {
        systemPrompt: 'You are a helpful assistant',
      }

      collectIterator(provider.stream(messages, options))

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
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const options: StreamOptions = {
        systemPrompt: [
          { type: 'textBlock', text: 'You are a helpful assistant' },
          { type: 'textBlock', text: 'Additional context here' },
        ],
      }

      collectIterator(provider.stream(messages, options))

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
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const options: StreamOptions = {
        systemPrompt: [
          { type: 'textBlock', text: 'You are a helpful assistant' },
          { type: 'textBlock', text: 'Large context document' },
          { type: 'cachePointBlock', cacheType: 'default' },
        ],
      }

      collectIterator(provider.stream(messages, options))

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
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const options: StreamOptions = {
        systemPrompt: [
          { type: 'textBlock', text: 'You are a helpful assistant' },
          { type: 'cachePointBlock', cacheType: 'default' },
        ],
      }

      collectIterator(provider.stream(messages, options))

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
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const options: StreamOptions = {
        systemPrompt: [],
      }

      collectIterator(provider.stream(messages, options))

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

    it('formats array system prompt with guard content', async () => {
      const provider = new BedrockModel()
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const options: StreamOptions = {
        systemPrompt: [
          new TextBlock('You are a helpful assistant'),
          new GuardContentBlock({
            text: {
              qualifiers: ['grounding_source'],
              text: 'This content should be evaluated for grounding.',
            },
          }),
        ],
      }

      collectIterator(provider.stream(messages, options))

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
          {
            guardContent: {
              text: {
                text: 'This content should be evaluated for grounding.',
                qualifiers: ['grounding_source'],
              },
            },
          },
        ],
      })
    })

    it('formats mixed system prompt with text, guard content, and cache points', async () => {
      const provider = new BedrockModel()
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const options: StreamOptions = {
        systemPrompt: [
          new TextBlock('You are a helpful assistant'),
          new GuardContentBlock({
            text: {
              qualifiers: ['grounding_source', 'query'],
              text: 'Guard content',
            },
          }),
          new TextBlock('Additional context'),
          new CachePointBlock({ cacheType: 'default' }),
        ],
      }

      collectIterator(provider.stream(messages, options))

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
          {
            guardContent: {
              text: {
                text: 'Guard content',
                qualifiers: ['grounding_source', 'query'],
              },
            },
          },
          { text: 'Additional context' },
          { cachePoint: { type: 'default' } },
        ],
      })
    })

    it('formats guard content with all qualifier types', async () => {
      const provider = new BedrockModel()
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const options: StreamOptions = {
        systemPrompt: [
          new GuardContentBlock({
            text: {
              qualifiers: ['grounding_source', 'query', 'guard_content'],
              text: 'Multi-qualifier guard content',
            },
          }),
        ],
      }

      collectIterator(provider.stream(messages, options))

      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
        modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
        messages: [
          {
            role: 'user',
            content: [{ text: 'Hello' }],
          },
        ],
        system: [
          {
            guardContent: {
              text: {
                text: 'Multi-qualifier guard content',
                qualifiers: ['grounding_source', 'query', 'guard_content'],
              },
            },
          },
        ],
      })
    })

    it('formats guard content with image in system prompt', async () => {
      const provider = new BedrockModel()
      const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
      const imageBytes = new Uint8Array([1, 2, 3, 4])
      const options: StreamOptions = {
        systemPrompt: [
          new GuardContentBlock({
            image: {
              format: 'jpeg',
              source: { bytes: imageBytes },
            },
          }),
        ],
      }

      collectIterator(provider.stream(messages, options))

      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
        modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
        messages: [
          {
            role: 'user',
            content: [{ text: 'Hello' }],
          },
        ],
        system: [
          {
            guardContent: {
              image: {
                format: 'jpeg',
                source: { bytes: imageBytes },
              },
            },
          },
        ],
      })
    })
  })

  describe('guard content in messages', async () => {
    const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime')
    const mockConverseStreamCommand = vi.mocked(ConverseStreamCommand)

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('formats guard content with text in message', async () => {
      const provider = new BedrockModel()
      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [
            new TextBlock('Verify this information:'),
            new GuardContentBlock({
              text: {
                qualifiers: ['grounding_source'],
                text: 'The capital of France is Paris.',
              },
            }),
          ],
        },
      ]

      collectIterator(provider.stream(messages))

      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
        modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
        messages: [
          {
            role: 'user',
            content: [
              { text: 'Verify this information:' },
              {
                guardContent: {
                  text: {
                    text: 'The capital of France is Paris.',
                    qualifiers: ['grounding_source'],
                  },
                },
              },
            ],
          },
        ],
      })
    })

    it('formats guard content with image in message', async () => {
      const provider = new BedrockModel()
      const imageBytes = new Uint8Array([1, 2, 3, 4])
      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [
            new TextBlock('Is this image safe?'),
            new GuardContentBlock({
              image: {
                format: 'jpeg',
                source: { bytes: imageBytes },
              },
            }),
          ],
        },
      ]

      collectIterator(provider.stream(messages))

      expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
        modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
        messages: [
          {
            role: 'user',
            content: [
              { text: 'Is this image safe?' },
              {
                guardContent: {
                  image: {
                    format: 'jpeg',
                    source: { bytes: imageBytes },
                  },
                },
              },
            ],
          },
        ],
      })
    })
  })

  describe('includeToolResultStatus configuration', async () => {
    const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime')
    const mockConverseStreamCommand = vi.mocked(ConverseStreamCommand)

    describe('when includeToolResultStatus is true', () => {
      it('always includes status field in tool results', async () => {
        const provider = new BedrockModel({ includeToolResultStatus: true })
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'toolResultBlock',
                toolUseId: 'tool-123',
                status: 'success',
                content: [{ type: 'textBlock', text: 'Result' }],
              },
            ],
          },
        ]

        collectIterator(provider.stream(messages))

        expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
          messages: [
            {
              content: [
                {
                  toolResult: {
                    content: [{ text: 'Result' }],
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
    })

    describe('when includeToolResultStatus is false', () => {
      it('never includes status field in tool results', async () => {
        const provider = new BedrockModel({ includeToolResultStatus: false })
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'toolResultBlock',
                toolUseId: 'tool-123',
                status: 'success',
                content: [{ type: 'textBlock', text: 'Result' }],
              },
            ],
          },
        ]

        collectIterator(provider.stream(messages))

        expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
          messages: [
            {
              content: [
                {
                  toolResult: {
                    content: [{ text: 'Result' }],
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
    })

    describe('when includeToolResultStatus is auto', () => {
      it('includes status field for Claude models', async () => {
        const provider = new BedrockModel({
          modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          includeToolResultStatus: 'auto',
        })
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'toolResultBlock',
                toolUseId: 'tool-123',
                status: 'success',
                content: [{ type: 'textBlock', text: 'Result' }],
              },
            ],
          },
        ]

        collectIterator(provider.stream(messages))

        expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
          messages: [
            {
              content: [
                {
                  toolResult: {
                    content: [{ text: 'Result' }],
                    status: 'success',
                    toolUseId: 'tool-123',
                  },
                },
              ],
              role: 'user',
            },
          ],
          modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        })
      })
    })

    describe('when includeToolResultStatus is undefined (default)', () => {
      it('follows auto logic for non-Claude models', async () => {
        const provider = new BedrockModel({
          modelId: 'amazon.nova-lite-v1:0',
        })
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'toolResultBlock',
                toolUseId: 'tool-123',
                status: 'success',
                content: [{ type: 'textBlock', text: 'Result' }],
              },
            ],
          },
        ]

        collectIterator(provider.stream(messages))

        expect(mockConverseStreamCommand).toHaveBeenLastCalledWith({
          messages: [
            {
              content: [
                {
                  toolResult: {
                    content: [{ text: 'Result' }],
                    toolUseId: 'tool-123',
                  },
                },
              ],
              role: 'user',
            },
          ],
          modelId: 'amazon.nova-lite-v1:0',
        })
      })
    })
  })
})
