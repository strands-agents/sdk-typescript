import { describe, it, expect } from 'vitest'
import { runAgentLoop } from '../agent-loop'
import { TestModelProvider, collectGenerator } from '../../__fixtures__/model-test-helpers'
import { createMockTool } from '../../__fixtures__/tool-helpers'
import { ToolRegistry } from '../../tools/registry'
import type { Message } from '../../types/messages'
import { MaxTokensError } from '../../errors'

describe('runAgentLoop', () => {
  describe('when handling simple completion without tools', () => {
    it('yields events and returns final messages array', async () => {
      const provider = new TestModelProvider(async function* () {
        yield { type: 'modelMessageStartEvent', role: 'assistant' }
        yield { type: 'modelContentBlockStartEvent', contentBlockIndex: 0 }
        yield {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: 'Hello, how can I help?' },
          contentBlockIndex: 0,
        }
        yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 }
        yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
      })

      const registry = new ToolRegistry()
      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Hi' }],
        },
      ]

      const { items } = await collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))

      // Verify agent events are present
      expect(items).toContainEqual({ type: 'beforeInvocationEvent' })
      expect(items).toContainEqual({ type: 'beforeModelEvent', messages: expect.any(Array) })
      expect(items).toContainEqual({
        type: 'afterModelEvent',
        message: expect.objectContaining({ role: 'assistant' }),
        stopReason: expect.any(String),
      })
      expect(items).toContainEqual({ type: 'afterInvocationEvent' })

      // Verify model events are passed through
      expect(items).toContainEqual({ type: 'modelMessageStartEvent', role: 'assistant' })

      // Verify final messages array contains assistant response
      expect(messages).toHaveLength(2)
      expect(messages[1]).toEqual({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'textBlock', text: 'Hello, how can I help?' }],
      })
    })
  })

  describe('when handling single tool use cycle', () => {
    it('executes tool and continues loop until completion', async () => {
      let callCount = 0
      const provider = new TestModelProvider()
      provider.setEventGenerator(async function* () {
        if (callCount === 0) {
          callCount++
          // First call: model requests tool
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield {
            type: 'modelContentBlockStartEvent',
            contentBlockIndex: 0,
            start: { type: 'toolUseStart', name: 'calculator', toolUseId: 'tool-1' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: '{"operation":"add","a":5,"b":3}' },
            contentBlockIndex: 0,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 }
          yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' }
        } else {
          // Second call: model responds with result
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent', contentBlockIndex: 0 }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'The result is 8' },
            contentBlockIndex: 0,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 }
          yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
        }
      })

      const mockTool = createMockTool('calculator', () => ({
        toolUseId: 'tool-1',
        status: 'success',
        content: [{ type: 'toolResultTextContent', text: '8' }],
      }))

      const registry = new ToolRegistry()
      registry.register(mockTool)

      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'What is 5+3?' }],
        },
      ]

      const { items } = await collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))

      // Verify tool execution events
      expect(items).toContainEqual({
        type: 'beforeToolsEvent',
        message: expect.objectContaining({ role: 'assistant' }),
      })
      expect(items).toContainEqual({
        type: 'afterToolsEvent',
        message: expect.objectContaining({ role: 'user' }),
      })

      // Verify only one beforeInvocationEvent
      const beforeEvents = items.filter((e) => e.type === 'beforeInvocationEvent')
      expect(beforeEvents).toHaveLength(1)

      // Verify two iterations by counting beforeModelEvent
      const modelEvents = items.filter((e) => e.type === 'beforeModelEvent')
      expect(modelEvents.length).toBeGreaterThanOrEqual(2)

      // Verify final messages include tool use and result
      expect(messages).toHaveLength(4) // user, assistant with tool use, user with tool result, assistant with final response
      if (!messages[1] || !messages[1].content[0]) {
        throw new Error('Expected content at index 1')
      }
      expect(messages[1].content[0]).toMatchObject({
        type: 'toolUseBlock',
        name: 'calculator',
        toolUseId: 'tool-1',
      })
      if (!messages[2] || !messages[2].content[0]) {
        throw new Error('Expected content at index 2')
      }
      expect(messages[2].content[0]).toMatchObject({
        type: 'toolResultBlock',
        toolUseId: 'tool-1',
        status: 'success',
      })
    })
  })

  describe('when handling multiple tool uses in sequence', () => {
    it('executes all tools sequentially', async () => {
      let callCount = 0
      const provider = new TestModelProvider()
      provider.setEventGenerator(async function* () {
        if (callCount === 0) {
          callCount++
          // Model requests two tools
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield {
            type: 'modelContentBlockStartEvent',
            contentBlockIndex: 0,
            start: { type: 'toolUseStart', name: 'tool1', toolUseId: 'id-1' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: '{}' },
            contentBlockIndex: 0,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 }
          yield {
            type: 'modelContentBlockStartEvent',
            contentBlockIndex: 1,
            start: { type: 'toolUseStart', name: 'tool2', toolUseId: 'id-2' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: '{}' },
            contentBlockIndex: 1,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 1 }
          yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' }
        } else {
          // Final response
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent', contentBlockIndex: 0 }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'Done' },
            contentBlockIndex: 0,
          }
          yield { type: 'modelContentBlockStopEvent', contentBlockIndex: 0 }
          yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
        }
      })

      const tool1 = createMockTool('tool1', () => ({
        toolUseId: 'id-1',
        status: 'success',
        content: [{ type: 'toolResultTextContent', text: 'result1' }],
      }))

      const tool2 = createMockTool('tool2', () => ({
        toolUseId: 'id-2',
        status: 'success',
        content: [{ type: 'toolResultTextContent', text: 'result2' }],
      }))

      const registry = new ToolRegistry()
      registry.register([tool1, tool2])

      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Test' }],
        },
      ]

      await collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))

      // Verify both tool results are present
      const toolResultMessage = messages[2]
      if (!toolResultMessage) {
        throw new Error('Expected tool result message at index 2')
      }
      expect(toolResultMessage.content).toHaveLength(2)
      expect(toolResultMessage.content[0]).toMatchObject({
        type: 'toolResultBlock',
        toolUseId: 'id-1',
      })
      expect(toolResultMessage.content[1]).toMatchObject({
        type: 'toolResultBlock',
        toolUseId: 'id-2',
      })
    })
  })

  describe('when handling multiple agentic loop iterations', () => {
    it('continues through multiple tool-use cycles', async () => {
      let callCount = 0
      const provider = new TestModelProvider()
      provider.setEventGenerator(async function* () {
        if (callCount === 0) {
          callCount++
          // First iteration: request tool
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield {
            type: 'modelContentBlockStartEvent',
            start: { type: 'toolUseStart', name: 'tool1', toolUseId: 'id-1' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: '{}' },
          }
          yield { type: 'modelContentBlockStopEvent' }
          yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' }
        } else if (callCount === 1) {
          callCount++
          // Second iteration: request another tool
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield {
            type: 'modelContentBlockStartEvent',
            start: { type: 'toolUseStart', name: 'tool2', toolUseId: 'id-2' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: '{}' },
          }
          yield { type: 'modelContentBlockStopEvent' }
          yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' }
        } else {
          // Third iteration: end
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent' }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'Complete' },
          }
          yield { type: 'modelContentBlockStopEvent' }
          yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
        }
      })

      const tool1 = createMockTool('tool1', () => ({
        toolUseId: 'id-1',
        status: 'success',
        content: [{ type: 'toolResultTextContent', text: 'r1' }],
      }))

      const tool2 = createMockTool('tool2', () => ({
        toolUseId: 'id-2',
        status: 'success',
        content: [{ type: 'toolResultTextContent', text: 'r2' }],
      }))

      const registry = new ToolRegistry()
      registry.register([tool1, tool2])

      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Test' }],
        },
      ]

      const { items } = await collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))

      // Verify only one beforeInvocationEvent
      const beforeEvents = items.filter((e) => e.type === 'beforeInvocationEvent')
      expect(beforeEvents).toHaveLength(1)

      // Verify three iterations by counting beforeModelEvent
      const modelEvents = items.filter((e) => e.type === 'beforeModelEvent')
      expect(modelEvents).toHaveLength(3)

      // Verify final message count (1 user + 2 assistant tool use + 2 user tool results + 1 assistant final)
      expect(messages).toHaveLength(6)
    })
  })

  describe('when handling transactional message success', () => {
    it('adds assistant message to array after first model event', async () => {
      const provider = new TestModelProvider(async function* () {
        yield { type: 'modelMessageStartEvent', role: 'assistant' }
        yield { type: 'modelContentBlockStartEvent' }
        yield {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: 'Response' },
        }
        yield { type: 'modelContentBlockStopEvent' }
        yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
      })

      const registry = new ToolRegistry()
      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Test' }],
        },
      ]

      await collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))

      // Verify assistant message was added
      expect(messages).toHaveLength(2)
      if (!messages[1]) {
        throw new Error('Expected assistant message at index 1')
      }
      expect(messages[1].role).toBe('assistant')
    })
  })

  describe('when handling transactional message with early error', () => {
    it('throws error without adding message to array', async () => {
      // eslint-disable-next-line require-yield
      const provider = new TestModelProvider(async function* () {
        throw new Error('Model error before any events')
      })

      const registry = new ToolRegistry()
      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Test' }],
        },
      ]

      // Verify error is thrown
      await expect(
        collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))
      ).rejects.toThrow('Model error before any events')
    })
  })

  describe('when model throws error after first event', () => {
    it('propagates error with messages array preserved', async () => {
      const provider = new TestModelProvider(async function* () {
        yield { type: 'modelMessageStartEvent', role: 'assistant' }
        throw new Error('Error after first event')
      })

      const registry = new ToolRegistry()
      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Test' }],
        },
      ]

      // Verify error is thrown
      await expect(
        collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))
      ).rejects.toThrow('Error after first event')
    })
  })

  describe('when tool throws exception', () => {
    it('propagates the error from the tool', async () => {
      const provider = new TestModelProvider(async function* () {
        yield { type: 'modelMessageStartEvent', role: 'assistant' }
        yield {
          type: 'modelContentBlockStartEvent',
          start: { type: 'toolUseStart', name: 'badTool', toolUseId: 'id-1' },
        }
        yield {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'toolUseInputDelta', input: '{}' },
        }
        yield { type: 'modelContentBlockStopEvent' }
        yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' }
      })

      // eslint-disable-next-line require-yield
      const badTool = createMockTool('badTool', async function* () {
        throw new Error('Tool execution failed')
      })

      const registry = new ToolRegistry()
      registry.register(badTool)

      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Test' }],
        },
      ]

      await expect(
        collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))
      ).rejects.toThrow('Tool execution failed')
    })

    it('does not add assistant message with tool uses when tool execution fails', async () => {
      const provider = new TestModelProvider(async function* () {
        yield { type: 'modelMessageStartEvent', role: 'assistant' }
        yield {
          type: 'modelContentBlockStartEvent',
          start: { type: 'toolUseStart', name: 'badTool', toolUseId: 'id-1' },
        }
        yield {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'toolUseInputDelta', input: '{}' },
        }
        yield { type: 'modelContentBlockStopEvent' }
        yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' }
      })

      // eslint-disable-next-line require-yield
      const badTool = createMockTool('badTool', async function* () {
        throw new Error('Tool execution failed')
      })

      const registry = new ToolRegistry()
      registry.register(badTool)

      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Test' }],
        },
      ]

      try {
        await collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))
        throw new Error('Expected error to be thrown')
      } catch (error) {
        if (error instanceof Error && error.message === 'Tool execution failed') {
          // Verify that messages array only contains the initial user message
          // The assistant message with tool uses should NOT be present since tool execution failed
          expect(messages).toHaveLength(1)
          expect(messages[0]).toEqual({
            type: 'message',
            role: 'user',
            content: [{ type: 'textBlock', text: 'Test' }],
          })
        } else {
          throw error
        }
      }
    })
  })

  describe('when tool is not found in registry', () => {
    it('returns error tool result and continues loop', async () => {
      let callCount = 0
      const provider = new TestModelProvider()
      provider.setEventGenerator(async function* () {
        if (callCount === 0) {
          callCount++
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield {
            type: 'modelContentBlockStartEvent',
            start: { type: 'toolUseStart', name: 'nonexistent', toolUseId: 'id-1' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: '{}' },
          }
          yield { type: 'modelContentBlockStopEvent' }
          yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' }
        } else {
          // Model handles the error and responds
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent' }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'Tool not available' },
          }
          yield { type: 'modelContentBlockStopEvent' }
          yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
        }
      })

      const registry = new ToolRegistry()

      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Test' }],
        },
      ]

      await collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))

      // Verify error tool result was returned
      const toolResultMessage = messages[2]
      if (!toolResultMessage || !toolResultMessage.content[0]) {
        throw new Error('Expected tool result message at index 2')
      }
      expect(toolResultMessage.content[0]).toMatchObject({
        type: 'toolResultBlock',
        toolUseId: 'id-1',
        status: 'error',
      })

      // Verify loop continued and completed
      expect(messages).toHaveLength(4) // user, assistant tool use, user error result, assistant final
    })
  })

  describe('when maxTokens stop reason occurs', () => {
    it('throws MaxTokensError', async () => {
      const provider = new TestModelProvider(async function* () {
        yield { type: 'modelMessageStartEvent', role: 'assistant' }
        yield { type: 'modelContentBlockStartEvent' }
        yield {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: 'Partial' },
        }
        yield { type: 'modelContentBlockStopEvent' }
        yield { type: 'modelMessageStopEvent', stopReason: 'maxTokens' }
      })

      const registry = new ToolRegistry()
      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Test' }],
        },
      ]

      await expect(
        collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))
      ).rejects.toThrow(MaxTokensError)
    })
  })

  describe('when verifying event streaming', () => {
    it('yields all events in correct order', async () => {
      const provider = new TestModelProvider(async function* () {
        yield { type: 'modelMessageStartEvent', role: 'assistant' }
        yield { type: 'modelContentBlockStartEvent' }
        yield {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: 'Test' },
        }
        yield { type: 'modelContentBlockStopEvent' }
        yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
      })

      const registry = new ToolRegistry()
      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Hi' }],
        },
      ]

      const { items } = await collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))

      // Extract event types in order
      const eventTypes = items.map((item) => item.type)

      // Verify event order
      expect(eventTypes.indexOf('beforeInvocationEvent')).toBeLessThan(eventTypes.indexOf('beforeModelEvent'))
      expect(eventTypes.indexOf('beforeModelEvent')).toBeLessThan(eventTypes.indexOf('modelMessageStartEvent'))
      expect(eventTypes.indexOf('modelMessageStopEvent')).toBeLessThan(eventTypes.indexOf('afterModelEvent'))
      expect(eventTypes.indexOf('afterModelEvent')).toBeLessThan(eventTypes.indexOf('afterInvocationEvent'))
    })
  })

  describe('when constructing ContentBlocks via streamAggregated', () => {
    it('handles TextBlock correctly', async () => {
      const provider = new TestModelProvider(async function* () {
        yield { type: 'modelMessageStartEvent', role: 'assistant' }
        yield { type: 'modelContentBlockStartEvent' }
        yield {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: 'Hello' },
        }
        yield { type: 'modelContentBlockStopEvent' }
        yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
      })

      const registry = new ToolRegistry()
      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Hi' }],
        },
      ]

      await collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))

      if (!messages[1] || !messages[1].content[0]) {
        throw new Error('Expected content at index 1')
      }
      expect(messages[1].content[0]).toEqual({
        type: 'textBlock',
        text: 'Hello',
      })
    })

    it('handles ToolUseBlock correctly', async () => {
      let callCount = 0
      const provider = new TestModelProvider()
      provider.setEventGenerator(async function* () {
        if (callCount === 0) {
          callCount++
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield {
            type: 'modelContentBlockStartEvent',
            start: { type: 'toolUseStart', name: 'test', toolUseId: 'id-1' },
          }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'toolUseInputDelta', input: '{"key":"value"}' },
          }
          yield { type: 'modelContentBlockStopEvent' }
          yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' }
        } else {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          yield { type: 'modelContentBlockStartEvent' }
          yield {
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: 'Done' },
          }
          yield { type: 'modelContentBlockStopEvent' }
          yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
        }
      })

      const tool = createMockTool('test', () => ({
        toolUseId: 'id-1',
        status: 'success',
        content: [{ type: 'toolResultTextContent', text: 'ok' }],
      }))

      const registry = new ToolRegistry()
      registry.register(tool)

      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Hi' }],
        },
      ]

      await collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))

      const toolUseBlock = messages[1]?.content[0]
      if (!toolUseBlock || toolUseBlock.type !== 'toolUseBlock') {
        throw new Error('Expected tool use block at messages[1].content[0]')
      }
      expect(toolUseBlock).toEqual({
        type: 'toolUseBlock',
        name: 'test',
        toolUseId: 'id-1',
        input: { key: 'value' },
      })
    })

    it('handles ReasoningBlock correctly', async () => {
      const provider = new TestModelProvider(async function* () {
        yield { type: 'modelMessageStartEvent', role: 'assistant' }
        yield { type: 'modelContentBlockStartEvent' }
        yield {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'reasoningContentDelta', text: 'thinking...' },
        }
        yield { type: 'modelContentBlockStopEvent' }
        yield { type: 'modelContentBlockStartEvent' }
        yield {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: 'Response' },
        }
        yield { type: 'modelContentBlockStopEvent' }
        yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
      })

      const registry = new ToolRegistry()
      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Hi' }],
        },
      ]

      await collectGenerator(runAgentLoop({ model: provider, messages, toolRegistry: registry }))

      if (!messages[1] || !messages[1].content[0]) {
        throw new Error('Expected content blocks at index 1')
      }
      expect(messages[1].content[0]).toEqual({
        type: 'reasoningBlock',
        text: 'thinking...',
      })
      if (!messages[1].content[1]) {
        throw new Error('Expected second content block at index 1')
      }
      expect(messages[1].content[1]).toEqual({
        type: 'textBlock',
        text: 'Response',
      })
    })
  })
})
