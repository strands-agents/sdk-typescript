import { describe, it, expect } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
import { TextBlock, MaxTokensError } from '../../index.js'

describe('Agent', () => {
  describe('stream', () => {
    describe('basic streaming', () => {
      it('returns AsyncGenerator', () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model })

        const result = agent.stream('Test prompt')

        expect(result).toBeDefined()
        expect(typeof result[Symbol.asyncIterator]).toBe('function')
      })

      it('yields AgentStreamEvent objects', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model })

        const { items } = await collectGenerator(agent.stream('Test prompt'))

        expect(items.length).toBeGreaterThan(0)
        expect(items[0]).toEqual({ type: 'beforeInvocationEvent' })
      })

      it('returns AgentResult as generator return value', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model })

        const { result } = await collectGenerator(agent.stream('Test prompt'))

        expect(result).toEqual({
          stopReason: 'endTurn',
          lastMessage: expect.objectContaining({
            role: 'assistant',
            content: expect.arrayContaining([expect.objectContaining({ type: 'textBlock', text: 'Hello' })]),
          }),
        })
      })
    })

    describe('with tool use', () => {
      it('handles tool execution flow', async () => {
        const model = new MockMessageModel()
          .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
          .addTurn({ type: 'textBlock', text: 'Tool result processed' })

        const tool = createMockTool('testTool', () => ({
          type: 'toolResultBlock',
          toolUseId: 'tool-1',
          status: 'success' as const,
          content: [new TextBlock('Tool executed')],
        }))

        const agent = new Agent({ model, tools: [tool] })

        const { items, result } = await collectGenerator(agent.stream('Use the tool'))

        // Check that tool-related events are yielded
        const toolEvents = items.filter(
          (event) => event.type === 'beforeToolsEvent' || event.type === 'afterToolsEvent'
        )
        expect(toolEvents.length).toBeGreaterThan(0)

        // Check final result
        expect(result.stopReason).toBe('endTurn')
      })

      it('yields tool-related events', async () => {
        const model = new MockMessageModel()
          .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
          .addTurn({ type: 'textBlock', text: 'Done' })

        const tool = createMockTool('testTool', () => ({
          type: 'toolResultBlock',
          toolUseId: 'tool-1',
          status: 'success' as const,
          content: [new TextBlock('Success')],
        }))

        const agent = new Agent({ model, tools: [tool] })

        const { items } = await collectGenerator(agent.stream('Test'))

        const beforeTools = items.find((e) => e.type === 'beforeToolsEvent')
        const afterTools = items.find((e) => e.type === 'afterToolsEvent')

        expect(beforeTools).toEqual({
          type: 'beforeToolsEvent',
          message: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} }],
          },
        })
        expect(afterTools).toEqual({
          type: 'afterToolsEvent',
          message: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'toolResultBlock',
                toolUseId: 'tool-1',
                status: 'success',
                content: [{ type: 'textBlock', text: 'Success' }],
              },
            ],
          },
        })
      })
    })

    describe('error handling', () => {
      it('throws MaxTokensError when model hits token limit', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Partial...' }, 'maxTokens')
        const agent = new Agent({ model })

        await expect(async () => {
          await collectGenerator(agent.stream('Test'))
        }).rejects.toThrow(MaxTokensError)
      })
    })
  })

  describe('invoke', () => {
    describe('basic invocation', () => {
      it('returns Promise<AgentResult>', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model })

        const result = agent.invoke('Test prompt')

        expect(result).toBeInstanceOf(Promise)
        const awaited = await result
        expect(awaited).toHaveProperty('stopReason')
        expect(awaited).toHaveProperty('lastMessage')
      })

      it('returns correct stopReason and lastMessage', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response text' })
        const agent = new Agent({ model })

        const result = await agent.invoke('Test prompt')

        expect(result).toEqual({
          stopReason: 'endTurn',
          lastMessage: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'textBlock', text: 'Response text' }],
          },
        })
      })

      it('consumes stream events internally', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model })

        const result = await agent.invoke('Test')

        expect(result).toEqual({
          stopReason: 'endTurn',
          lastMessage: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'textBlock', text: 'Hello' }],
          },
        })
        expect(result).not.toHaveProperty('type')
      })
    })

    describe('with tool use', () => {
      it('executes tools and returns final result', async () => {
        const model = new MockMessageModel()
          .addTurn({ type: 'toolUseBlock', name: 'calc', toolUseId: 'tool-1', input: { a: 1, b: 2 } })
          .addTurn({ type: 'textBlock', text: 'The answer is 3' })

        const tool = createMockTool('calc', () => ({
          type: 'toolResultBlock',
          toolUseId: 'tool-1',
          status: 'success' as const,
          content: [new TextBlock('3')],
        }))

        const agent = new Agent({ model, tools: [tool] })

        const result = await agent.invoke('What is 1 + 2?')

        expect(result).toEqual({
          stopReason: 'endTurn',
          lastMessage: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'textBlock', text: 'The answer is 3' }],
          },
        })
      })
    })

    describe('error handling', () => {
      it('propagates maxTokens error', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Partial' }, 'maxTokens')
        const agent = new Agent({ model })

        await expect(agent.invoke('Test')).rejects.toThrow(MaxTokensError)
      })
    })
  })

  describe('API consistency', () => {
    it('invoke() and stream() produce same final result', async () => {
      const model1 = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Consistent response' })
      const model2 = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Consistent response' })

      const agent1 = new Agent({ model: model1 })
      const agent2 = new Agent({ model: model2 })

      const invokeResult = await agent1.invoke('Test')
      const { result: streamResult } = await collectGenerator(agent2.stream('Test'))

      expect(invokeResult.stopReason).toBe(streamResult.stopReason)
      expect(invokeResult.lastMessage.content).toEqual(streamResult.lastMessage.content)
    })

    it('both methods produce same result with tool use', async () => {
      const createToolAndModels = () => {
        const model = new MockMessageModel()
          .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'id', input: {} })
          .addTurn({ type: 'textBlock', text: 'Final' })

        const tool = createMockTool('testTool', () => ({
          type: 'toolResultBlock',
          toolUseId: 'id',
          status: 'success' as const,
          content: [new TextBlock('Tool ran')],
        }))

        return { model, tool }
      }

      const { model: model1, tool: tool1 } = createToolAndModels()
      const { model: model2, tool: tool2 } = createToolAndModels()

      const agent1 = new Agent({ model: model1, tools: [tool1] })
      const agent2 = new Agent({ model: model2, tools: [tool2] })

      const invokeResult = await agent1.invoke('Use tool')
      const { result: streamResult } = await collectGenerator(agent2.stream('Use tool'))

      expect(invokeResult).toEqual(streamResult)
    })
  })

  describe('messages', () => {
    it('returns array of messages', () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      const messages = agent.messages

      expect(messages).toBeDefined()
      expect(Array.isArray(messages)).toBe(true)
    })

    it('reflects conversation history after invoke', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response' })
      const agent = new Agent({ model })

      await agent.invoke('Hello')

      const messages = agent.messages
      expect(messages.length).toBeGreaterThan(0)
      expect(messages.length).toBe(2)
      expect(messages[0]?.role).toBe('user')
      expect(messages[0]?.content).toEqual([{ type: 'textBlock', text: 'Hello' }])
      expect(messages[1]?.role).toBe('assistant')
      expect(messages[1]?.content).toEqual([{ type: 'textBlock', text: 'Response' }])
    })
  })
})
