import { describe, it, expect } from 'vitest'
import { TestMessageModelProvider } from '../test-message-model'
import { collectGenerator, collectIterator } from '../model-test-helpers'

describe('TestMessageModelProvider', () => {
  describe('constructor', () => {
    it('creates provider with no arguments', () => {
      const provider = new TestMessageModelProvider()
      expect(provider).toBeDefined()
      expect(provider.getConfig()).toEqual({ modelId: 'test-model' })
    })

    it('creates provider with single content block', () => {
      const provider = new TestMessageModelProvider({ type: 'textBlock', text: 'Hello' })
      expect(provider).toBeDefined()
    })

    it('creates provider with array of content blocks', () => {
      const provider = new TestMessageModelProvider([
        { type: 'textBlock', text: 'First' },
        { type: 'textBlock', text: 'Second' },
      ])
      expect(provider).toBeDefined()
    })

    it('creates provider with multiple turns', () => {
      const provider = new TestMessageModelProvider(
        { type: 'textBlock', text: 'First' },
        { type: 'textBlock', text: 'Second' }
      )
      expect(provider).toBeDefined()
    })

    it('creates provider with Error object', () => {
      const error = new Error('Test error')
      const provider = new TestMessageModelProvider(error)
      expect(provider).toBeDefined()
    })

    it('creates provider with mixed content and errors', () => {
      const provider = new TestMessageModelProvider({ type: 'textBlock', text: 'Hello' }, new Error('Test error'))
      expect(provider).toBeDefined()
    })
  })

  describe('addTurn', () => {
    it('adds turn and returns this for chaining', () => {
      const provider = new TestMessageModelProvider()
      const result = provider.addTurn({ type: 'textBlock', text: 'Hello' })
      expect(result).toBe(provider)
    })

    it('adds turn with explicit stopReason', () => {
      const provider = new TestMessageModelProvider()
      const result = provider.addTurn({ type: 'textBlock', text: 'Hello' }, 'maxTokens')
      expect(result).toBe(provider)
    })

    it('adds Error turn', () => {
      const provider = new TestMessageModelProvider()
      const error = new Error('Test error')
      const result = provider.addTurn(error)
      expect(result).toBe(provider)
    })

    it('chains multiple addTurn calls', () => {
      const provider = new TestMessageModelProvider()
      const result = provider
        .addTurn({ type: 'textBlock', text: 'First' })
        .addTurn({ type: 'textBlock', text: 'Second' })
      expect(result).toBe(provider)
    })
  })

  describe('stopReason auto-derivation', () => {
    it('derives toolUse for content with ToolUseBlock', async () => {
      const provider = new TestMessageModelProvider({
        type: 'toolUseBlock',
        name: 'calculator',
        toolUseId: 'test-1',
        input: { operation: 'add' },
      })
      const { result } = await collectGenerator(provider.streamAggregated([]))
      expect(result.stopReason).toBe('toolUse')
    })

    it('derives endTurn for content with TextBlock only', async () => {
      const provider = new TestMessageModelProvider({ type: 'textBlock', text: 'Hello' })
      const { result } = await collectGenerator(provider.streamAggregated([]))
      expect(result.stopReason).toBe('endTurn')
    })

    it('derives endTurn for content with ReasoningBlock', async () => {
      const provider = new TestMessageModelProvider({ type: 'reasoningBlock', text: 'thinking...' })
      const { result } = await collectGenerator(provider.streamAggregated([]))
      expect(result.stopReason).toBe('endTurn')
    })

    it('derives toolUse for mixed content including ToolUse', async () => {
      const provider = new TestMessageModelProvider([
        { type: 'textBlock', text: 'Let me check' },
        {
          type: 'toolUseBlock',
          name: 'calculator',
          toolUseId: 'test-1',
          input: {},
        },
      ])
      const { result } = await collectGenerator(provider.streamAggregated([]))
      expect(result.stopReason).toBe('toolUse')
    })

    it('uses explicit stopReason when provided', async () => {
      const provider = new TestMessageModelProvider().addTurn({ type: 'textBlock', text: 'Hello' }, 'maxTokens')
      const { result } = await collectGenerator(provider.streamAggregated([]))
      expect(result.stopReason).toBe('maxTokens')
    })
  })

  describe('turn management', () => {
    it('reuses single turn indefinitely', async () => {
      const provider = new TestMessageModelProvider({ type: 'textBlock', text: 'Hello' })

      // First call
      const { result: result1 } = await collectGenerator(provider.streamAggregated([]))
      expect(result1.message.content[0]).toEqual({ type: 'textBlock', text: 'Hello' })

      // Second call should return same content
      const { result: result2 } = await collectGenerator(provider.streamAggregated([]))
      expect(result2.message.content[0]).toEqual({ type: 'textBlock', text: 'Hello' })

      // Third call should still work
      const { result: result3 } = await collectGenerator(provider.streamAggregated([]))
      expect(result3.message.content[0]).toEqual({ type: 'textBlock', text: 'Hello' })
    })

    it('advances through multiple turns correctly', async () => {
      const provider = new TestMessageModelProvider(
        { type: 'textBlock', text: 'First' },
        { type: 'textBlock', text: 'Second' }
      )

      // First call
      const { result: result1 } = await collectGenerator(provider.streamAggregated([]))
      expect(result1.message.content[0]).toEqual({ type: 'textBlock', text: 'First' })

      // Second call
      const { result: result2 } = await collectGenerator(provider.streamAggregated([]))
      expect(result2.message.content[0]).toEqual({ type: 'textBlock', text: 'Second' })
    })

    it('throws error when turns exhausted', async () => {
      const provider = new TestMessageModelProvider(
        { type: 'textBlock', text: 'First' },
        { type: 'textBlock', text: 'Second' }
      )

      // First and second calls succeed
      await collectGenerator(provider.streamAggregated([]))
      await collectGenerator(provider.streamAggregated([]))

      // Third call should throw
      await expect(collectGenerator(provider.streamAggregated([]))).rejects.toThrow('All turns have been consumed')
    })

    it('throws error when Error turn is reached', async () => {
      const error = new Error('Test error')
      const provider = new TestMessageModelProvider(error)

      await expect(collectGenerator(provider.streamAggregated([]))).rejects.toThrow('Test error')
    })

    it('throws error on correct turn in multi-turn scenario', async () => {
      const error = new Error('Second turn error')
      const provider = new TestMessageModelProvider({ type: 'textBlock', text: 'First' }, error)

      // First call succeeds
      const { result } = await collectGenerator(provider.streamAggregated([]))
      expect(result.message.content[0]).toEqual({ type: 'textBlock', text: 'First' })

      // Second call throws error
      await expect(collectGenerator(provider.streamAggregated([]))).rejects.toThrow('Second turn error')
    })
  })

  describe('event generation', () => {
    it('generates correct events for TextBlock', async () => {
      const provider = new TestMessageModelProvider({ type: 'textBlock', text: 'Hello, world!' })
      const events = await collectIterator(provider.stream([]))

      expect(events).toEqual([
        { type: 'modelMessageStartEvent', role: 'assistant' },
        { type: 'modelContentBlockStartEvent', contentBlockIndex: 0 },
        {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: 'Hello, world!' },
          contentBlockIndex: 0,
        },
        { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 },
        { type: 'modelMessageStopEvent', stopReason: 'endTurn' },
      ])
    })

    it('generates correct events for ToolUseBlock', async () => {
      const provider = new TestMessageModelProvider({
        type: 'toolUseBlock',
        name: 'calculator',
        toolUseId: 'test-1',
        input: { operation: 'add', a: 1, b: 2 },
      })
      const events = await collectIterator(provider.stream([]))

      expect(events).toEqual([
        { type: 'modelMessageStartEvent', role: 'assistant' },
        {
          type: 'modelContentBlockStartEvent',
          contentBlockIndex: 0,
          start: { type: 'toolUseStart', name: 'calculator', toolUseId: 'test-1' },
        },
        {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'toolUseInputDelta', input: '{"operation":"add","a":1,"b":2}' },
          contentBlockIndex: 0,
        },
        { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 },
        { type: 'modelMessageStopEvent', stopReason: 'toolUse' },
      ])
    })

    it('generates correct events for ReasoningBlock', async () => {
      const provider = new TestMessageModelProvider({ type: 'reasoningBlock', text: 'thinking...' })
      const events = await collectIterator(provider.stream([]))

      expect(events).toEqual([
        { type: 'modelMessageStartEvent', role: 'assistant' },
        { type: 'modelContentBlockStartEvent', contentBlockIndex: 0 },
        {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'reasoningContentDelta', text: 'thinking...' },
          contentBlockIndex: 0,
        },
        { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 },
        { type: 'modelMessageStopEvent', stopReason: 'endTurn' },
      ])
    })

    it('generates correct events for CachePointBlock', async () => {
      const provider = new TestMessageModelProvider([
        { type: 'textBlock', text: 'Hello' },
        { type: 'cachePointBlock', cacheType: 'default' },
      ])
      const events = await collectIterator(provider.stream([]))

      // CachePointBlock doesn't generate delta events, only start/stop
      expect(events).toContainEqual({ type: 'modelMessageStartEvent', role: 'assistant' })
      expect(events).toContainEqual({ type: 'modelMessageStopEvent', stopReason: 'endTurn' })
    })

    it('generates correct events for multiple ContentBlocks', async () => {
      const provider = new TestMessageModelProvider([
        { type: 'textBlock', text: 'First' },
        { type: 'textBlock', text: 'Second' },
        { type: 'textBlock', text: 'Third' },
      ])
      const events = await collectIterator(provider.stream([]))

      expect(events).toHaveLength(11) // 1 start + 3*(start+delta+stop) + 1 stop
      expect(events[0]).toEqual({ type: 'modelMessageStartEvent', role: 'assistant' })
      expect(events[events.length - 1]).toEqual({ type: 'modelMessageStopEvent', stopReason: 'endTurn' })
    })

    it('handles empty content array', async () => {
      const provider = new TestMessageModelProvider([])
      const events = await collectIterator(provider.stream([]))

      expect(events).toEqual([
        { type: 'modelMessageStartEvent', role: 'assistant' },
        { type: 'modelMessageStopEvent', stopReason: 'endTurn' },
      ])
    })
  })

  describe('integration with streamAggregated', () => {
    it('returns correct message from streamAggregated', async () => {
      const provider = new TestMessageModelProvider({ type: 'textBlock', text: 'Hello' })
      const { result } = await collectGenerator(provider.streamAggregated([]))

      expect(result.message).toEqual({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'textBlock', text: 'Hello' }],
      })
    })

    it('returns correct stopReason from streamAggregated', async () => {
      const provider = new TestMessageModelProvider().addTurn({ type: 'textBlock', text: 'Hello' }, 'maxTokens')
      const { result } = await collectGenerator(provider.streamAggregated([]))

      expect(result.stopReason).toBe('maxTokens')
    })

    it('yields all events correctly', async () => {
      const provider = new TestMessageModelProvider({ type: 'textBlock', text: 'Hello' })
      const { items } = await collectGenerator(provider.streamAggregated([]))

      // Should include all ModelStreamEvents and the final ContentBlock
      expect(items.some((item) => 'type' in item && item.type === 'modelMessageStartEvent')).toBe(true)
      expect(items.some((item) => 'type' in item && item.type === 'modelMessageStopEvent')).toBe(true)
      expect(items.some((item) => 'type' in item && item.type === 'textBlock')).toBe(true)
    })

    it('reconstructs ContentBlocks correctly', async () => {
      const provider = new TestMessageModelProvider([
        { type: 'textBlock', text: 'Hello' },
        {
          type: 'toolUseBlock',
          name: 'test',
          toolUseId: 'id-1',
          input: { key: 'value' },
        },
      ])
      const { result } = await collectGenerator(provider.streamAggregated([]))

      expect(result.message.content).toEqual([
        { type: 'textBlock', text: 'Hello' },
        {
          type: 'toolUseBlock',
          name: 'test',
          toolUseId: 'id-1',
          input: { key: 'value' },
        },
      ])
    })
  })

  describe('updateConfig and getConfig', () => {
    it('updates config correctly', () => {
      const provider = new TestMessageModelProvider()
      provider.updateConfig({ modelId: 'custom-model' })
      expect(provider.getConfig()).toEqual({ modelId: 'custom-model' })
    })

    it('merges config correctly', () => {
      const provider = new TestMessageModelProvider()
      provider.updateConfig({ modelId: 'model-1' })
      provider.updateConfig({ modelId: 'model-2' })
      expect(provider.getConfig()).toEqual({ modelId: 'model-2' })
    })
  })
})
