import { describe, it, expect } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
import { TextBlock, MaxTokensError } from '../../index.js'
import { ConcurrentInvocationError } from '../../errors.js'

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

  describe('concurrency guards', () => {
    describe('parallel invoke() calls', () => {
      it('throws ConcurrentInvocationError when second invoke called during first', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response' })
        const agent = new Agent({ model })

        const promise1 = agent.invoke('First')
        const promise2 = agent.invoke('Second')

        await expect(promise2).rejects.toThrow(ConcurrentInvocationError)
        await expect(promise2).rejects.toThrow(
          'Agent is already processing an invocation. Wait for the current invoke() or stream() call to complete before invoking again.'
        )
        await expect(promise1).resolves.toBeDefined()
      })
    })

    describe('parallel stream() calls', () => {
      it('throws ConcurrentInvocationError when second stream called during first', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response' })
        const agent = new Agent({ model })

        const stream1 = agent.stream('First')
        const promise1 = collectGenerator(stream1)

        // Start second stream before first completes
        const stream2 = agent.stream('Second')
        const promise2 = stream2.next()

        await expect(promise2).rejects.toThrow(ConcurrentInvocationError)
        await expect(promise2).rejects.toThrow(
          'Agent is already processing an invocation. Wait for the current invoke() or stream() call to complete before invoking again.'
        )
        await expect(promise1).resolves.toBeDefined()
      })
    })

    describe('invoke() during active stream()', () => {
      it('throws ConcurrentInvocationError when invoke called while stream active', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response' })
        const agent = new Agent({ model })

        const stream = agent.stream('First')
        const streamPromise = collectGenerator(stream)

        // Try to invoke before stream completes
        const invokePromise = agent.invoke('Second')

        await expect(invokePromise).rejects.toThrow(ConcurrentInvocationError)
        await expect(invokePromise).rejects.toThrow(
          'Agent is already processing an invocation. Wait for the current invoke() or stream() call to complete before invoking again.'
        )
        await expect(streamPromise).resolves.toBeDefined()
      })
    })

    describe('stream() during active invoke()', () => {
      it('throws ConcurrentInvocationError when stream called while invoke active', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response' })
        const agent = new Agent({ model })

        const invokePromise = agent.invoke('First')

        // Try to stream before invoke completes
        const stream = agent.stream('Second')
        const streamPromise = stream.next()

        await expect(streamPromise).rejects.toThrow(ConcurrentInvocationError)
        await expect(streamPromise).rejects.toThrow(
          'Agent is already processing an invocation. Wait for the current invoke() or stream() call to complete before invoking again.'
        )
        await expect(invokePromise).resolves.toBeDefined()
      })
    })

    describe('sequential invocations', () => {
      it('allows sequential invoke() calls after first completes', async () => {
        const model = new MockMessageModel()
          .addTurn({ type: 'textBlock', text: 'First response' })
          .addTurn({ type: 'textBlock', text: 'Second response' })
        const agent = new Agent({ model })

        const result1 = await agent.invoke('First')
        expect(result1.lastMessage.content).toEqual([{ type: 'textBlock', text: 'First response' }])

        const result2 = await agent.invoke('Second')
        expect(result2.lastMessage.content).toEqual([{ type: 'textBlock', text: 'Second response' }])
      })

      it('allows sequential stream() calls after first completes', async () => {
        const model = new MockMessageModel()
          .addTurn({ type: 'textBlock', text: 'First response' })
          .addTurn({ type: 'textBlock', text: 'Second response' })
        const agent = new Agent({ model })

        const { result: result1 } = await collectGenerator(agent.stream('First'))
        expect(result1.lastMessage.content).toEqual([{ type: 'textBlock', text: 'First response' }])

        const { result: result2 } = await collectGenerator(agent.stream('Second'))
        expect(result2.lastMessage.content).toEqual([{ type: 'textBlock', text: 'Second response' }])
      })

      it('allows invoke() after stream() completes', async () => {
        const model = new MockMessageModel()
          .addTurn({ type: 'textBlock', text: 'Stream response' })
          .addTurn({ type: 'textBlock', text: 'Invoke response' })
        const agent = new Agent({ model })

        const { result: streamResult } = await collectGenerator(agent.stream('First'))
        expect(streamResult.lastMessage.content).toEqual([{ type: 'textBlock', text: 'Stream response' }])

        const invokeResult = await agent.invoke('Second')
        expect(invokeResult.lastMessage.content).toEqual([{ type: 'textBlock', text: 'Invoke response' }])
      })

      it('allows stream() after invoke() completes', async () => {
        const model = new MockMessageModel()
          .addTurn({ type: 'textBlock', text: 'Invoke response' })
          .addTurn({ type: 'textBlock', text: 'Stream response' })
        const agent = new Agent({ model })

        const invokeResult = await agent.invoke('First')
        expect(invokeResult.lastMessage.content).toEqual([{ type: 'textBlock', text: 'Invoke response' }])

        const { result: streamResult } = await collectGenerator(agent.stream('Second'))
        expect(streamResult.lastMessage.content).toEqual([{ type: 'textBlock', text: 'Stream response' }])
      })
    })

    describe('lock released after errors', () => {
      it('allows invocation after invoke() throws error', async () => {
        const model = new MockMessageModel()
          .addTurn({ type: 'textBlock', text: 'Partial' }, 'maxTokens')
          .addTurn({ type: 'textBlock', text: 'Success' })
        const agent = new Agent({ model })

        await expect(agent.invoke('First')).rejects.toThrow(MaxTokensError)

        const result = await agent.invoke('Second')
        expect(result.lastMessage.content).toEqual([{ type: 'textBlock', text: 'Success' }])
      })

      it('allows invocation after stream() throws error', async () => {
        const model = new MockMessageModel()
          .addTurn({ type: 'textBlock', text: 'Partial' }, 'maxTokens')
          .addTurn({ type: 'textBlock', text: 'Success' })
        const agent = new Agent({ model })

        await expect(async () => {
          await collectGenerator(agent.stream('First'))
        }).rejects.toThrow(MaxTokensError)

        const result = await agent.invoke('Second')
        expect(result.lastMessage.content).toEqual([{ type: 'textBlock', text: 'Success' }])
      })
    })

    describe('lock released when stream abandoned', () => {
      it('allows invocation after stream iterator is not fully consumed', async () => {
        // Create separate models for each invocation
        const model1 = new MockMessageModel().addTurn({ type: 'textBlock', text: 'First response' })
        const model2 = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Second response' })

        // Use model1 for first attempt, then switch to model2
        const agent = new Agent({ model: model1 })

        // Create stream but don't fully consume it
        const stream = agent.stream('First')
        const firstEvent = await stream.next()
        expect(firstEvent.done).toBe(false)

        // Explicitly abandon the stream by calling return() and consume the result
        const returnResult = await stream.return(undefined as never)
        // The return should execute the finally block which releases the lock
        expect(returnResult.done).toBe(true)

        // Switch to model2 for the second invocation
        agent['_model'] = model2

        // Should be able to invoke again after stream is abandoned
        const result = await agent.invoke('Second')
        expect(result.lastMessage.content).toEqual([{ type: 'textBlock', text: 'Second response' }])
      })
    })
  })
})
