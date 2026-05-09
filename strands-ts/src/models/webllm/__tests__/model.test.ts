// ABOUTME: Unit tests for the WebLLM model provider using a mocked MLC engine.
// ABOUTME: Runs in both node and browser environments (engine is fully mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { WebLLMModel } from '../model.js'
import { Message, TextBlock, ToolUseBlock, ToolResultBlock, JsonBlock } from '../../../types/messages.js'
import { collectIterator } from '../../../__fixtures__/model-test-helpers.js'
import { warnOnce } from '../../../logging/warn-once.js'
import { resetWebLLMModuleCache } from '../cache.js'

type CreateMock = Mock<(req: unknown) => Promise<AsyncIterable<unknown>>>

/**
 * Builds a mock MLCEngineInterface-compatible object whose
 * `chat.completions.create` yields the given chunks.
 */
function makeMockEngine(chunks: unknown[]): {
  engine: {
    chat: { completions: { create: CreateMock } }
    unload: Mock
    reload: Mock
  }
  create: CreateMock
} {
  const create = vi.fn(async () => {
    async function* gen(): AsyncGenerator<unknown> {
      for (const c of chunks) yield c
    }
    return gen()
  }) as unknown as CreateMock
  const engine = {
    chat: { completions: { create } },
    unload: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
  }
  return { engine, create }
}

vi.mock('../../../logging/warn-once.js', () => ({
  warnOnce: vi.fn(),
}))

describe('WebLLMModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWebLLMModuleCache()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('creates an instance with default modelId warning', () => {
      new WebLLMModel()
      expect(warnOnce).toHaveBeenCalledWith(
        expect.objectContaining({ warn: expect.any(Function) }),
        expect.stringContaining('using default WebLLM modelId')
      )
    })

    it('does not warn when modelId is explicitly set', () => {
      new WebLLMModel({ modelId: 'Phi-3.5-mini-instruct-q4f16_1-MLC' })
      expect(warnOnce).not.toHaveBeenCalled()
    })

    it('stores provided config', () => {
      const model = new WebLLMModel({
        modelId: 'custom-model',
        temperature: 0.3,
        maxTokens: 512,
        topP: 0.9,
      })
      expect(model.getConfig()).toStrictEqual({
        modelId: 'custom-model',
        temperature: 0.3,
        maxTokens: 512,
        topP: 0.9,
      })
    })

    it('accepts an external engine without triggering module load', async () => {
      const { engine } = makeMockEngine([])
      const model = new WebLLMModel({ engine: engine as never, modelId: 'test' })
      expect(model.getConfig().modelId).toBe('test')
    })
  })

  describe('updateConfig', () => {
    it('merges new config with existing config', () => {
      const model = new WebLLMModel({ modelId: 'm', temperature: 0.5 })
      model.updateConfig({ temperature: 0.8, maxTokens: 1024 })
      expect(model.getConfig()).toStrictEqual({
        modelId: 'm',
        temperature: 0.8,
        maxTokens: 1024,
      })
    })
  })

  describe('stream', () => {
    it('yields correct events for a simple text response', async () => {
      const { engine } = makeMockEngine([
        { choices: [{ delta: { role: 'assistant' } }] },
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' world' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
      ])
      const model = new WebLLMModel({ engine: engine as never, modelId: 'test' })
      const messages = [new Message({ role: 'user', content: [new TextBlock('Hi')] })]

      const events = await collectIterator(model.stream(messages))

      expect(events).toEqual([
        { type: 'modelMessageStartEvent', role: 'assistant' },
        { type: 'modelContentBlockStartEvent' },
        { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: 'Hello' } },
        { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: ' world' } },
        { type: 'modelContentBlockStopEvent' },
        { type: 'modelMetadataEvent', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } },
        { type: 'modelMessageStopEvent', stopReason: 'endTurn' },
      ])
    })

    it('emits metadata before message stop when usage arrives mid-stream', async () => {
      // Some WebLLM builds emit usage on the same chunk as finish_reason.
      const { engine } = makeMockEngine([
        { choices: [{ delta: { role: 'assistant' } }] },
        { choices: [{ delta: { content: 'Hi' } }] },
        {
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      ])
      const model = new WebLLMModel({ engine: engine as never, modelId: 'test' })
      const events = await collectIterator(
        model.stream([new Message({ role: 'user', content: [new TextBlock('Hi')] })])
      )
      const metaIndex = events.findIndex((e) => e.type === 'modelMetadataEvent')
      const stopIndex = events.findIndex((e) => e.type === 'modelMessageStopEvent')
      expect(metaIndex).toBeGreaterThan(-1)
      expect(stopIndex).toBeGreaterThan(metaIndex)
    })

    it('maps tool calls to content block start/delta/stop events', async () => {
      const { engine } = makeMockEngine([
        { choices: [{ delta: { role: 'assistant' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'tool_1',
                    type: 'function',
                    function: { name: 'add', arguments: '{"a":1' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: ',"b":2}' } }],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ])
      const model = new WebLLMModel({ engine: engine as never, modelId: 'test' })
      const events = await collectIterator(
        model.stream([new Message({ role: 'user', content: [new TextBlock('add')] })])
      )
      expect(events).toContainEqual({
        type: 'modelContentBlockStartEvent',
        start: { type: 'toolUseStart', name: 'add', toolUseId: 'tool_1' },
      })
      expect(events).toContainEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'toolUseInputDelta', input: '{"a":1' },
      })
      expect(events).toContainEqual({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'toolUseInputDelta', input: ',"b":2}' },
      })
      expect(events).toContainEqual({ type: 'modelMessageStopEvent', stopReason: 'toolUse' })
    })

    it('maps `length` finish reason to maxTokens stop reason', async () => {
      const { engine } = makeMockEngine([
        { choices: [{ delta: { role: 'assistant' } }] },
        { choices: [{ delta: { content: 'partial' } }] },
        { choices: [{ delta: {}, finish_reason: 'length' }] },
      ])
      const model = new WebLLMModel({ engine: engine as never, modelId: 'test' })
      const events = await collectIterator(
        model.stream([new Message({ role: 'user', content: [new TextBlock('Hi')] })])
      )
      expect(events).toContainEqual({ type: 'modelMessageStopEvent', stopReason: 'maxTokens' })
    })

    it('throws when called with no messages', async () => {
      const { engine } = makeMockEngine([])
      const model = new WebLLMModel({ engine: engine as never, modelId: 'test' })
      await expect(collectIterator(model.stream([]))).rejects.toThrow('At least one message is required')
    })

    it('propagates errors from the engine', async () => {
      const create = vi.fn(async () => {
        throw new Error('engine boom')
      }) as unknown as CreateMock
      const engine = {
        chat: { completions: { create } },
        unload: vi.fn(async () => undefined),
      }
      const model = new WebLLMModel({ engine: engine as never, modelId: 'test' })
      await expect(
        collectIterator(model.stream([new Message({ role: 'user', content: [new TextBlock('Hi')] })]))
      ).rejects.toThrow('engine boom')
    })
  })

  describe('request formatting', () => {
    async function captureRequest(
      streamOptions: Parameters<WebLLMModel['stream']>[1],
      messages: Message[],
      config: ConstructorParameters<typeof WebLLMModel>[0] = {}
    ): Promise<unknown> {
      let captured: unknown
      const create = vi.fn(async (req: unknown) => {
        captured = req
        async function* gen(): AsyncGenerator<unknown> {
          yield { choices: [{ delta: { role: 'assistant' } }] }
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
        }
        return gen()
      }) as unknown as CreateMock
      const engine = {
        chat: { completions: { create } },
        unload: vi.fn(async () => undefined),
      }
      const model = new WebLLMModel({ ...config, engine: engine as never, modelId: 'test' })
      await collectIterator(model.stream(messages, streamOptions))
      return captured
    }

    it('emits an OpenAI-compatible streaming request with config fields', async () => {
      const req = (await captureRequest(undefined, [new Message({ role: 'user', content: [new TextBlock('hello')] })], {
        temperature: 0.4,
        maxTokens: 128,
        topP: 0.9,
        frequencyPenalty: 0.2,
        presencePenalty: 0.1,
      })) as Record<string, unknown>

      expect(req).toMatchObject({
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.4,
        max_tokens: 128,
        top_p: 0.9,
        frequency_penalty: 0.2,
        presence_penalty: 0.1,
        messages: [{ role: 'user', content: 'hello' }],
      })
    })

    it('includes a system message when systemPrompt is a string', async () => {
      const req = (await captureRequest({ systemPrompt: 'Be brief.' }, [
        new Message({ role: 'user', content: [new TextBlock('Hi')] }),
      ])) as { messages: Array<{ role: string; content: string }> }
      expect(req.messages[0]).toEqual({ role: 'system', content: 'Be brief.' })
    })

    it('flattens system prompt content blocks to a single string', async () => {
      const req = (await captureRequest(
        {
          systemPrompt: [new TextBlock('You are '), new TextBlock('helpful')],
        },
        [new Message({ role: 'user', content: [new TextBlock('Hi')] })]
      )) as { messages: Array<{ role: string; content: string }> }
      expect(req.messages[0]).toEqual({ role: 'system', content: 'You are helpful' })
    })

    it('formats tool specs and tool_choice', async () => {
      const req = (await captureRequest(
        {
          toolSpecs: [
            {
              name: 'add',
              description: 'Add two numbers',
              inputSchema: {
                type: 'object' as const,
                properties: { a: { type: 'number' }, b: { type: 'number' } },
              },
            },
          ],
          toolChoice: { any: {} },
        },
        [new Message({ role: 'user', content: [new TextBlock('2+2')] })]
      )) as { tools: unknown[]; tool_choice: unknown }
      expect(req.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'add',
            description: 'Add two numbers',
            parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
          },
        },
      ])
      expect(req.tool_choice).toBe('required')
    })

    it('maps `tool` tool_choice to named function', async () => {
      const req = (await captureRequest(
        {
          toolSpecs: [
            { name: 'foo', description: 'does foo', inputSchema: { type: 'object' as const, properties: {} } },
          ],
          toolChoice: { tool: { name: 'foo' } },
        },
        [new Message({ role: 'user', content: [new TextBlock('go')] })]
      )) as { tool_choice: unknown }
      expect(req.tool_choice).toEqual({ type: 'function', function: { name: 'foo' } })
    })

    it('emits assistant tool_calls from history', async () => {
      const req = (await captureRequest(undefined, [
        new Message({ role: 'user', content: [new TextBlock('add 1+2')] }),
        new Message({
          role: 'assistant',
          content: [new ToolUseBlock({ name: 'add', toolUseId: 't1', input: { a: 1, b: 2 } })],
        }),
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 't1',
              status: 'success',
              content: [new JsonBlock({ json: 3 })],
            }),
          ],
        }),
      ])) as { messages: Array<Record<string, unknown>> }

      expect(req.messages).toEqual([
        { role: 'user', content: 'add 1+2' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 't1', type: 'function', function: { name: 'add', arguments: '{"a":1,"b":2}' } }],
        },
        { role: 'tool', tool_call_id: 't1', content: '3' },
      ])
    })

    it('wraps errored tool results with [ERROR] prefix', async () => {
      const req = (await captureRequest(undefined, [
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 't1',
              status: 'error',
              content: [new TextBlock('boom')],
            }),
          ],
        }),
      ])) as { messages: Array<Record<string, unknown>> }
      expect(req.messages[0]).toEqual({ role: 'tool', tool_call_id: 't1', content: '[ERROR] boom' })
    })

    it('throws when a tool spec lacks name or description', async () => {
      const create = vi.fn(async () => {
        async function* gen(): AsyncGenerator<unknown> {
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
        }
        return gen()
      }) as unknown as CreateMock
      const engine = {
        chat: { completions: { create } },
        unload: vi.fn(async () => undefined),
      }
      const model = new WebLLMModel({ engine: engine as never, modelId: 'test' })
      await expect(
        collectIterator(
          model.stream([new Message({ role: 'user', content: [new TextBlock('Hi')] })], {
            toolSpecs: [{ name: '', description: 'x' } as never],
          })
        )
      ).rejects.toThrow('Tool specification must have both name and description')
    })
  })

  describe('unload', () => {
    it('is a no-op when the engine was externally provided', async () => {
      const { engine } = makeMockEngine([])
      const model = new WebLLMModel({ engine: engine as never, modelId: 'test' })
      await model.unload()
      expect(engine.unload).not.toHaveBeenCalled()
    })
  })
})
