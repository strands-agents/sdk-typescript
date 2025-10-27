/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import OpenAI from 'openai'
import { OpenAIModel } from '../openai'
import { ContextWindowOverflowError } from '../../errors'
import type { Message } from '../../types/messages'
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

// Mock the OpenAI SDK
vi.mock('openai', () => {
  const mockConstructor = vi.fn().mockImplementation(() => ({}))
  return {
    default: mockConstructor,
  }
})

describe('OpenAIModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set default env var for most tests using Vitest's stubEnv
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-env')
  })

  afterEach(() => {
    vi.clearAllMocks()
    // Restore all environment variables to their original state
    vi.unstubAllEnvs()
  })

  describe('constructor', () => {
    it('creates an instance with required modelId', () => {
      const provider = new OpenAIModel({ modelId: 'gpt-4o', apiKey: 'sk-test' })
      const config = provider.getConfig()
      expect(config.modelId).toBe('gpt-4o')
    })

    it('uses custom model ID', () => {
      const customModelId = 'gpt-3.5-turbo'
      const provider = new OpenAIModel({ modelId: customModelId, apiKey: 'sk-test' })
      expect(provider.getConfig()).toStrictEqual({
        modelId: customModelId,
      })
    })

    it('uses API key from constructor parameter', () => {
      const apiKey = 'sk-explicit'
      new OpenAIModel({ modelId: 'gpt-4o', apiKey })
      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: apiKey,
        })
      )
    })

    it('uses API key from environment variable', () => {
      vi.stubEnv('OPENAI_API_KEY', 'sk-from-env')
      new OpenAIModel({ modelId: 'gpt-4o' })
      // OpenAI client should be called without explicit apiKey (uses env var internally)
      expect(OpenAI).toHaveBeenCalled()
    })

    it('explicit API key takes precedence over environment variable', () => {
      vi.stubEnv('OPENAI_API_KEY', 'sk-from-env')
      const explicitKey = 'sk-explicit'
      new OpenAIModel({ modelId: 'gpt-4o', apiKey: explicitKey })
      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: explicitKey,
        })
      )
    })

    it('throws error when no API key is available', () => {
      vi.stubEnv('OPENAI_API_KEY', '')
      expect(() => new OpenAIModel({ modelId: 'gpt-4o' })).toThrow(
        "OpenAI API key is required. Provide it via the 'apiKey' option or set the OPENAI_API_KEY environment variable."
      )
    })

    it('uses custom client configuration', () => {
      const timeout = 30000
      new OpenAIModel({ modelId: 'gpt-4o', apiKey: 'sk-test', clientConfig: { timeout } })
      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: timeout,
        })
      )
    })

    it('uses provided client instance', () => {
      vi.clearAllMocks()
      const mockClient = {} as OpenAI
      const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
      // Should not create a new OpenAI client
      expect(OpenAI).not.toHaveBeenCalled()
      expect(provider).toBeDefined()
    })

    it('provided client takes precedence over apiKey and clientConfig', () => {
      vi.clearAllMocks()
      const mockClient = {} as OpenAI
      new OpenAIModel({
        modelId: 'gpt-4o',
        apiKey: 'sk-test',
        client: mockClient,
        clientConfig: { timeout: 30000 },
      })
      // Should not create a new OpenAI client when client is provided
      expect(OpenAI).not.toHaveBeenCalled()
    })

    it('does not require API key when client is provided', () => {
      vi.clearAllMocks()
      vi.stubEnv('OPENAI_API_KEY', '')
      const mockClient = {} as OpenAI
      expect(() => new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })).not.toThrow()
    })
  })

  describe('updateConfig', () => {
    it('merges new config with existing config', () => {
      const provider = new OpenAIModel({ modelId: 'gpt-4o', apiKey: 'sk-test', temperature: 0.5 })
      provider.updateConfig({ modelId: 'gpt-4o', temperature: 0.8, maxTokens: 2048 })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'gpt-4o',
        temperature: 0.8,
        maxTokens: 2048,
      })
    })

    it('preserves fields not included in the update', () => {
      const provider = new OpenAIModel({
        apiKey: 'sk-test',
        modelId: 'gpt-3.5-turbo',
        temperature: 0.5,
        maxTokens: 1024,
      })
      provider.updateConfig({ modelId: 'gpt-3.5-turbo', temperature: 0.8 })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'gpt-3.5-turbo',
        temperature: 0.8,
        maxTokens: 1024,
      })
    })
  })

  describe('getConfig', () => {
    it('returns the current configuration', () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o',
        apiKey: 'sk-test',
        maxTokens: 1024,
        temperature: 0.7,
      })
      expect(provider.getConfig()).toStrictEqual({
        modelId: 'gpt-4o',
        maxTokens: 1024,
        temperature: 0.7,
      })
    })
  })

  describe('stream', () => {
    // Helper to create a mock OpenAI client with streaming support
    function createMockClient(streamGenerator: () => AsyncGenerator<any>): OpenAI {
      return {
        chat: {
          completions: {
            create: vi.fn(async () => streamGenerator()),
          },
        },
      } as any
    }

    describe('validation', () => {
      it('throws error when messages array is empty (Issue #1)', async () => {
        const mockClient = createMockClient(async function* () {})
        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })

        await expect(async () => {
          for await (const _ of provider.stream([])) {
            // Should not reach here
          }
        }).rejects.toThrow('At least one message is required')
      })

      it('validates system prompt is not empty (Issue #13)', async () => {
        const createMock = vi.fn(async function* () {
          yield {
            choices: [{ delta: { role: 'assistant', content: 'Hello' }, index: 0 }],
          }
          yield {
            choices: [{ finish_reason: 'stop', delta: {}, index: 0 }],
          }
        })
        const mockClient = {
          chat: {
            completions: {
              create: createMock,
            },
          },
        } as any
        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        // System prompt that's only whitespace should not be sent
        const events = await collectEvents(provider.stream(messages, { systemPrompt: '   ' }))

        // Should still get valid events
        expect(events.length).toBeGreaterThan(0)
        expect(events[0]?.type).toBe('modelMessageStartEvent')
      })

      it('throws error for streaming with n > 1 (Issue #12)', async () => {
        const mockClient = createMockClient(async function* () {})
        const provider = new OpenAIModel({
          modelId: 'gpt-4o',
          client: mockClient,
          params: { n: 2 },
        })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        await expect(async () => {
          for await (const _ of provider.stream(messages)) {
            // Should not reach here
          }
        }).rejects.toThrow('Streaming with n > 1 is not supported')
      })

      it('throws error for tool spec without name or description (Issue #16)', async () => {
        const mockClient = createMockClient(async function* () {})
        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        await expect(async () => {
          for await (const _ of provider.stream(messages, {
            toolSpecs: [{ name: '', description: 'test', inputSchema: {} }],
          })) {
            // Should not reach here
          }
        }).rejects.toThrow('Tool specification must have both name and description')
      })

      it('throws error for empty assistant message (Issue #3)', async () => {
        const mockClient = createMockClient(async function* () {})
        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [
          { role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] },
          { role: 'assistant', content: [] },
        ]

        await expect(async () => {
          for await (const _ of provider.stream(messages)) {
            // Should not reach here
          }
        }).rejects.toThrow('Assistant message must have either text content or tool calls')
      })

      it('throws error for empty tool result content (Issue #4)', async () => {
        const mockClient = createMockClient(async function* () {})
        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [
          {
            role: 'user',
            content: [{ type: 'toolResultBlock', toolUseId: 'tool-123', status: 'success', content: [] }],
          },
        ]

        await expect(async () => {
          for await (const _ of provider.stream(messages)) {
            // Should not reach here
          }
        }).rejects.toThrow('Tool result for toolUseId "tool-123" has empty content')
      })

      it('handles tool result with error status (Issue #5)', async () => {
        const createMock = vi.fn(async function* () {
          yield {
            choices: [{ delta: { role: 'assistant', content: 'Ok' }, index: 0 }],
          }
          yield {
            choices: [{ finish_reason: 'stop', delta: {}, index: 0 }],
          }
        })
        const mockClient = {
          chat: {
            completions: {
              create: createMock,
            },
          },
        } as any
        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [
          { role: 'user', content: [{ type: 'textBlock', text: 'Run tool' }] },
          {
            role: 'assistant',
            content: [
              {
                type: 'toolUseBlock',
                name: 'calculator',
                toolUseId: 'tool-123',
                input: { expr: 'invalid' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'toolResultBlock',
                toolUseId: 'tool-123',
                status: 'error',
                content: [{ type: 'toolResultTextContent', text: 'Division by zero' }],
              },
            ],
          },
        ]

        // Should not throw - error status is handled by prepending [ERROR]
        const events = await collectEvents(provider.stream(messages))

        // Verify we got a response
        expect(events.length).toBeGreaterThan(0)
        expect(events[0]?.type).toBe('modelMessageStartEvent')
      })

      it('throws error for circular reference in tool input (Issue #14)', async () => {
        const mockClient = createMockClient(async function* () {})
        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })

        const circular: any = { a: 1 }
        circular.self = circular

        const messages: Message[] = [
          { role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] },
          {
            role: 'assistant',
            content: [
              {
                type: 'toolUseBlock',
                name: 'test',
                toolUseId: 'tool-1',
                input: circular,
              },
            ],
          },
        ]

        await expect(async () => {
          for await (const _ of provider.stream(messages)) {
            // Should not reach here
          }
        }).rejects.toThrow('Failed to serialize tool input')
      })

      it('throws error for reasoning blocks (OpenAI does not support them)', async () => {
        const mockClient = createMockClient(async function* () {})
        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [
          {
            role: 'user',
            content: [{ type: 'reasoningBlock', reasoning: 'Some reasoning' }] as any,
          },
        ]

        await expect(async () => {
          for await (const _ of provider.stream(messages)) {
            // Should not reach here
          }
        }).rejects.toThrow('Reasoning blocks are not supported by OpenAI')
      })
    })

    describe('basic streaming', () => {
      it('yields correct event sequence for simple text response', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            choices: [{ delta: { role: 'assistant' }, index: 0 }],
          }
          yield {
            choices: [{ delta: { content: 'Hello' }, index: 0 }],
          }
          yield {
            choices: [{ delta: { content: ' world' }, index: 0 }],
          }
          yield {
            choices: [{ finish_reason: 'stop', delta: {}, index: 0 }],
          }
        })

        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const events = await collectEvents(provider.stream(messages))

        expect(events).toHaveLength(4)
        expect(events[0]).toEqual({ type: 'modelMessageStartEvent', role: 'assistant' })
        expect(events[1]).toEqual({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: 'Hello' },
        })
        expect(events[2]).toEqual({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: ' world' },
        })
        expect(events[3]).toEqual({ type: 'modelMessageStopEvent', stopReason: 'endTurn' })
      })

      it('emits modelMetadataEvent with usage information (Issue #11)', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            choices: [{ delta: { role: 'assistant' }, index: 0 }],
          }
          yield {
            choices: [{ finish_reason: 'stop', delta: {}, index: 0 }],
          }
          yield {
            choices: [],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }
        })

        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const events = await collectEvents(provider.stream(messages))

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

      it('handles usage with undefined properties (Issue #11)', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            choices: [{ delta: { role: 'assistant' }, index: 0 }],
          }
          yield {
            choices: [{ finish_reason: 'stop', delta: {}, index: 0 }],
          }
          yield {
            choices: [],
            usage: {}, // Empty usage object
          }
        })

        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const events = await collectEvents(provider.stream(messages))

        const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
        expect(metadataEvent).toBeDefined()
        expect(metadataEvent).toEqual({
          type: 'modelMetadataEvent',
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          },
        })
      })

      it('filters out empty string content deltas (Issue #17)', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            choices: [{ delta: { role: 'assistant' }, index: 0 }],
          }
          yield {
            choices: [{ delta: { content: '' }, index: 0 }], // Empty content
          }
          yield {
            choices: [{ delta: { content: 'Hello' }, index: 0 }],
          }
          yield {
            choices: [{ finish_reason: 'stop', delta: {}, index: 0 }],
          }
        })

        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const events = await collectEvents(provider.stream(messages))

        // Should not emit event for empty content
        const contentEvents = events.filter((e) => e.type === 'modelContentBlockDeltaEvent')
        expect(contentEvents).toHaveLength(1)
        expect((contentEvents[0] as any).delta.text).toBe('Hello')
      })

      it('prevents duplicate message start events (Issue #6)', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            choices: [{ delta: { role: 'assistant' }, index: 0 }],
          }
          yield {
            choices: [{ delta: { role: 'assistant', content: 'Hello' }, index: 0 }], // Duplicate role
          }
          yield {
            choices: [{ finish_reason: 'stop', delta: {}, index: 0 }],
          }
        })

        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        // Suppress console.warn for this test
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const events = await collectEvents(provider.stream(messages))

        // Should only have one message start event
        const startEvents = events.filter((e) => e.type === 'modelMessageStartEvent')
        expect(startEvents).toHaveLength(1)

        // The second role appearance should be detected but the duplicate start event filtered out
        // Note: This might not trigger a warning if the event is never created
        // The important thing is only one start event is emitted

        warnSpy.mockRestore()
      })
    })

    describe('tool calling', () => {
      it('handles tool use request with contentBlockStart and contentBlockStop events (Issue #7)', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            choices: [{ delta: { role: 'assistant' }, index: 0 }],
          }
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_123',
                      type: 'function',
                      function: { name: 'calculator', arguments: '' },
                    },
                  ],
                },
                index: 0,
              },
            ],
          }
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: '{"expr' } }],
                },
                index: 0,
              },
            ],
          }
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: '":"2+2"}' } }],
                },
                index: 0,
              },
            ],
          }
          yield {
            choices: [{ finish_reason: 'tool_calls', delta: {}, index: 0 }],
          }
        })

        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Calculate 2+2' }] }]

        const events = await collectEvents(provider.stream(messages))

        // Verify key events in sequence
        expect(events[0]).toEqual({ type: 'modelMessageStartEvent', role: 'assistant' })
        expect(events[1]).toEqual({
          type: 'modelContentBlockStartEvent',
          contentBlockIndex: 0,
          start: {
            type: 'toolUseStart',
            name: 'calculator',
            toolUseId: 'call_123',
          },
        })
        expect(events[2]).toEqual({
          type: 'modelContentBlockDeltaEvent',
          contentBlockIndex: 0,
          delta: {
            type: 'toolUseInputDelta',
            input: '{"expr',
          },
        })
        expect(events[3]).toEqual({
          type: 'modelContentBlockDeltaEvent',
          contentBlockIndex: 0,
          delta: {
            type: 'toolUseInputDelta',
            input: '":"2+2"}',
          },
        })
        expect(events[4]).toEqual({
          type: 'modelContentBlockStopEvent',
          contentBlockIndex: 0,
        })
        expect(events[5]).toEqual({ type: 'modelMessageStopEvent', stopReason: 'toolUse' })
      })

      it('handles multiple tool calls with correct contentBlockIndex (Issue #7, #8)', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            choices: [{ delta: { role: 'assistant' }, index: 0 }],
          }
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'tool1', arguments: '{}' },
                    },
                  ],
                },
                index: 0,
              },
            ],
          }
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 1,
                      id: 'call_2',
                      type: 'function',
                      function: { name: 'tool2', arguments: '{}' },
                    },
                  ],
                },
                index: 0,
              },
            ],
          }
          yield {
            choices: [{ finish_reason: 'tool_calls', delta: {}, index: 0 }],
          }
        })

        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        const events = await collectEvents(provider.stream(messages))

        // Should emit stop events for both tool calls
        const stopEvents = events.filter((e) => e.type === 'modelContentBlockStopEvent')
        expect(stopEvents).toHaveLength(2)
        expect(stopEvents[0]).toEqual({ type: 'modelContentBlockStopEvent', contentBlockIndex: 0 })
        expect(stopEvents[1]).toEqual({ type: 'modelContentBlockStopEvent', contentBlockIndex: 1 })
      })

      it('skips tool calls with invalid index (Issue #9)', async () => {
        const mockClient = createMockClient(async function* () {
          yield {
            choices: [{ delta: { role: 'assistant' }, index: 0 }],
          }
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: undefined as any, // Invalid index
                      id: 'call_123',
                      type: 'function',
                      function: { name: 'tool', arguments: '{}' },
                    },
                  ],
                },
                index: 0,
              },
            ],
          }
          yield {
            choices: [{ finish_reason: 'stop', delta: {}, index: 0 }],
          }
        })

        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        // Suppress console.warn for this test
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const events = await collectEvents(provider.stream(messages))

        // Should not emit any tool-related events
        const toolEvents = events.filter(
          (e) => e.type === 'modelContentBlockStartEvent' || e.type === 'modelContentBlockDeltaEvent'
        )
        expect(toolEvents).toHaveLength(0)

        // The important thing is that invalid tool calls don't crash the stream
        // and are properly skipped
        expect(events.length).toBeGreaterThan(0) // Still got message events

        warnSpy.mockRestore()
      })
    })

    describe('stop reasons', () => {
      it('maps OpenAI stop reasons to SDK stop reasons', async () => {
        const stopReasons = [
          { openai: 'stop', sdk: 'endTurn' },
          { openai: 'tool_calls', sdk: 'toolUse' },
          { openai: 'length', sdk: 'maxTokens' },
          { openai: 'content_filter', sdk: 'contentFiltered' },
        ]

        for (const { openai, sdk } of stopReasons) {
          const mockClient = createMockClient(async function* () {
            yield {
              choices: [{ delta: { role: 'assistant' }, index: 0 }],
            }
            yield {
              choices: [{ finish_reason: openai, delta: {}, index: 0 }],
            }
          })

          const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
          const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

          const events = await collectEvents(provider.stream(messages))

          const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
          expect(stopEvent).toBeDefined()
          expect((stopEvent as any).stopReason).toBe(sdk)
        }
      })
    })

    describe('error handling', () => {
      it('throws ContextWindowOverflowError for structured error with code (Issue #10)', async () => {
        const mockClient = {
          chat: {
            completions: {
              create: vi.fn(async () => {
                const error: any = new Error('Context length exceeded')
                error.code = 'context_length_exceeded'
                throw error
              }),
            },
          },
        } as any

        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        await expect(async () => {
          for await (const _ of provider.stream(messages)) {
            // Should not reach here
          }
        }).rejects.toThrow(ContextWindowOverflowError)
      })

      it('throws ContextWindowOverflowError for error with message pattern (Issue #10)', async () => {
        const mockClient = {
          chat: {
            completions: {
              create: vi.fn(async () => {
                throw new Error('maximum context length exceeded')
              }),
            },
          },
        } as any

        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        await expect(async () => {
          for await (const _ of provider.stream(messages)) {
            // Should not reach here
          }
        }).rejects.toThrow(ContextWindowOverflowError)
      })

      it('passes through other errors unchanged', async () => {
        const mockClient = {
          chat: {
            completions: {
              create: vi.fn(async () => {
                throw new Error('Invalid API key')
              }),
            },
          },
        } as any

        const provider = new OpenAIModel({ modelId: 'gpt-4o', client: mockClient })
        const messages: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Hi' }] }]

        await expect(async () => {
          for await (const _ of provider.stream(messages)) {
            // Should not reach here
          }
        }).rejects.toThrow('Invalid API key')
      })
    })
  })
})
