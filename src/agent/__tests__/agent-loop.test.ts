import { describe, it, expect } from 'vitest'
import { TestModelProvider, collectGenerator } from '../../__fixtures__/model-test-helpers'
import { createMockTool } from '../../__fixtures__/tool-helpers'
import { MaxTokensError } from '../../errors'
import { Agent } from '../agent'
import type { AgentStreamEvent } from '../streaming'

describe('Agent', () => {
  describe('invoke', () => {
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

        const agent = new Agent({ model: provider })
        const { items, result } = await collectGenerator(agent.invoke('Hi'))

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
        expect(result.lastMessage).toEqual({
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

        const agent = new Agent({ model: provider, tools: [mockTool] })

        const { items } = await collectGenerator(agent.invoke('What is 5+3?'))

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

        // Verify final messages include tool use and result by inspecting the message history
        // sent to the model in the second call.
        const secondModelEvent = modelEvents[1]
        const messagesForSecondCall = secondModelEvent?.messages
        expect(messagesForSecondCall).toHaveLength(3) // user, assistant tool use, user tool result

        expect(messagesForSecondCall?.[1]?.content[0]).toMatchObject({
          type: 'toolUseBlock',
          name: 'calculator',
          toolUseId: 'tool-1',
        })
        expect(messagesForSecondCall?.[2]?.content[0]).toMatchObject({
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

        const agent = new Agent({ model: provider, tools: [tool1, tool2] })

        const { items } = await collectGenerator(agent.invoke('Test'))

        // Verify both tool results are present in the message sent to the model
        const beforeModelEvents = items.filter(
          (e): e is AgentStreamEvent & { type: 'beforeModelEvent' } => e.type === 'beforeModelEvent'
        )
        const toolResultMessage = beforeModelEvents[1]?.messages[2]

        expect(toolResultMessage?.content).toHaveLength(2)
        expect(toolResultMessage?.content[0]).toMatchObject({
          type: 'toolResultBlock',
          toolUseId: 'id-1',
        })
        expect(toolResultMessage?.content[1]).toMatchObject({
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

        const agent = new Agent({ model: provider, tools: [tool1, tool2] })
        const { items } = await collectGenerator(agent.invoke('Test'))

        // Verify only one beforeInvocationEvent
        const beforeEvents = items.filter((e) => e.type === 'beforeInvocationEvent')
        expect(beforeEvents).toHaveLength(1)

        // Verify three iterations by counting beforeModelEvent
        const modelEvents = items.filter(
          (e): e is AgentStreamEvent & { type: 'beforeModelEvent' } => e.type === 'beforeModelEvent'
        )
        expect(modelEvents).toHaveLength(3)

        // Verify final message count before final model call
        // (1 user + 1 assistant tool use + 1 user tool result + 1 assistant tool use + 1 user tool result)
        expect(modelEvents[2]?.messages).toHaveLength(5)
      })
    })

    describe('when handling transactional message success', () => {
      it('returns the final assistant message', async () => {
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

        const agent = new Agent({ model: provider })
        const { result } = await collectGenerator(agent.invoke('Test'))

        // Verify assistant message was returned
        expect(result.lastMessage.role).toBe('assistant')
      })
    })

    describe('when handling transactional message with early error', () => {
      it('throws error without yielding events', async () => {
        // eslint-disable-next-line require-yield
        const provider = new TestModelProvider(async function* () {
          throw new Error('Model error before any events')
        })

        const agent = new Agent({ model: provider })

        // Verify error is thrown
        await expect(collectGenerator(agent.invoke('Test'))).rejects.toThrow('Model error before any events')
      })
    })

    describe('when model throws error after first event', () => {
      it('propagates error after yielding some events', async () => {
        const provider = new TestModelProvider(async function* () {
          yield { type: 'modelMessageStartEvent', role: 'assistant' }
          throw new Error('Error after first event')
        })

        const agent = new Agent({ model: provider })
        // Verify error is thrown
        await expect(collectGenerator(agent.invoke('Test'))).rejects.toThrow('Error after first event')
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

        const agent = new Agent({ model: provider, tools: [badTool] })

        await expect(collectGenerator(agent.invoke('Test'))).rejects.toThrow('Tool execution failed')
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

        const agent = new Agent({ model: provider })

        const { items, result } = await collectGenerator(agent.invoke('Test'))

        // Verify error tool result was returned
        const beforeModelEvents = items.filter(
          (e): e is AgentStreamEvent & { type: 'beforeModelEvent' } => e.type === 'beforeModelEvent'
        )
        const toolResultMessage = beforeModelEvents[1]?.messages[2]

        expect(toolResultMessage?.content[0]).toMatchObject({
          type: 'toolResultBlock',
          toolUseId: 'id-1',
          status: 'error',
        })

        // Verify loop continued and completed
        expect(result.lastMessage.content[0]).toMatchObject({
          type: 'textBlock',
          text: 'Tool not available',
        })
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

        const agent = new Agent({ model: provider })

        await expect(collectGenerator(agent.invoke('Test'))).rejects.toThrow(MaxTokensError)
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

        const agent = new Agent({ model: provider })
        const { items } = await collectGenerator(agent.invoke('Hi'))

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

        const agent = new Agent({ model: provider })

        const { result } = await collectGenerator(agent.invoke('Hi'))

        expect(result.lastMessage.content[0]).toEqual({
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

        const agent = new Agent({ model: provider, tools: [tool] })
        const { items } = await collectGenerator(agent.invoke('Hi'))

        const beforeModelEvents = items.filter(
          (e): e is AgentStreamEvent & { type: 'beforeModelEvent' } => e.type === 'beforeModelEvent'
        )
        const assistantMessage = beforeModelEvents[1]?.messages[1]
        const toolUseBlock = assistantMessage?.content[0]

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

        const agent = new Agent({ model: provider })

        const { result } = await collectGenerator(agent.invoke('Hi'))

        expect(result.lastMessage.content[0]).toEqual({
          type: 'reasoningBlock',
          text: 'thinking...',
        })
        expect(result.lastMessage.content[1]).toEqual({
          type: 'textBlock',
          text: 'Response',
        })
      })
    })
  })
})
