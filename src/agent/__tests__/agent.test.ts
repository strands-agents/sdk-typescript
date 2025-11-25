import { describe, expect, it } from 'vitest'
import { Agent, type ToolList } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { createMockTool, createRandomTool } from '../../__fixtures__/tool-helpers.js'
import { ConcurrentInvocationError } from '../../errors.js'
import { MaxTokensError, TextBlock, CachePointBlock } from '../../index.js'
import { AgentPrinter } from '../printer.js'

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

      it('returns AsyncGenerator that can be iterated without type errors', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model })

        // Ensures that the signature of agent.stream is correct
        for await (const _ of agent.stream('Test prompt')) {
          /* intentionally empty */
        }
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

  describe('printer configuration', () => {
    it('validates output when printer is enabled', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello world' })

      // Capture output
      const outputs: string[] = []
      const mockAppender = (text: string) => outputs.push(text)

      // Create agent with custom printer for testing
      const agent = new Agent({ model, printer: false })
      ;(agent as any)._printer = new AgentPrinter(mockAppender)

      await collectGenerator(agent.stream('Test'))

      // Validate that text was output
      const allOutput = outputs.join('')
      expect(allOutput).toContain('Hello world')
    })

    it('does not create printer when printer is false', () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, printer: false })

      expect(agent).toBeDefined()
      expect((agent as any)._printer).toBeUndefined()
    })

    it('defaults to printer=true when not specified', () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      expect(agent).toBeDefined()
      expect((agent as any)._printer).toBeDefined()
    })

    it('agent works correctly with printer disabled', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, printer: false })

      const { result } = await collectGenerator(agent.stream('Test'))

      expect(result).toBeDefined()
      expect(result.lastMessage.content).toEqual([{ type: 'textBlock', text: 'Hello' }])
    })
  })

  describe('concurrency guards', () => {
    it('prevents parallel invocations', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Response' })
      const agent = new Agent({ model })

      // Test parallel invoke() calls
      const invokePromise1 = agent.invoke('First')
      const invokePromise2 = agent.invoke('Second')

      await expect(invokePromise2).rejects.toThrow(ConcurrentInvocationError)
      await expect(invokePromise1).resolves.toBeDefined()
    })

    it('allows sequential invocations after lock is released', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'textBlock', text: 'First response' })
        .addTurn({ type: 'textBlock', text: 'Second response' })
      const agent = new Agent({ model })

      const result1 = await agent.invoke('First')
      expect(result1.lastMessage.content).toEqual([{ type: 'textBlock', text: 'First response' }])

      const result2 = await agent.invoke('Second')
      expect(result2.lastMessage.content).toEqual([{ type: 'textBlock', text: 'Second response' }])
    })

    it('releases lock after errors and abandoned streams', async () => {
      // Test error case
      const model = new MockMessageModel()
        .addTurn({ type: 'textBlock', text: 'Partial' }, 'maxTokens')
        .addTurn({ type: 'textBlock', text: 'Success' })
      const agent = new Agent({ model })

      await expect(agent.invoke('First')).rejects.toThrow(MaxTokensError)

      const result = await agent.invoke('Second')
      expect(result.lastMessage.content).toEqual([{ type: 'textBlock', text: 'Success' }])
    })
  })

  describe('nested tool arrays', () => {
    describe('flattens nested arrays at any depth', () => {
      const tool1 = createRandomTool()
      const tool2 = createRandomTool()
      const tool3 = createRandomTool()

      it.for([
        ['flat array', [tool1, tool2, tool3], [tool1, tool2, tool3]],
        ['single tool', [tool1], [tool1]],
        ['empty array', [], []],
        ['single level nesting', [[tool1, tool2], tool3], [tool1, tool2, tool3]],
        ['empty nested arrays', [[], tool1, []], [tool1]],
        ['deeply nested', [[[tool1]], [tool2], tool3], [tool1, tool2, tool3]],
        ['mixed nesting', [[tool1, [tool2]], tool3], [tool1, tool2, tool3]],
        ['very deep nesting', [[[[tool1]]]], [tool1]],
      ])('%i', ([, input, expected]) => {
        const agent = new Agent({ tools: input as ToolList })
        expect(agent.tools).toEqual(expected)
      })
    })

    it('accepts undefined tools', () => {
      const agent = new Agent({})

      expect(agent.tools).toEqual([])
    })

    it('catches duplicate tool names across nested arrays', () => {
      const tool1 = createRandomTool('duplicate')
      const tool2 = createRandomTool('duplicate')

      expect(() => new Agent({ tools: [[tool1], [tool2]] })).toThrow("Tool with name 'duplicate' already registered")
    })
  })

  describe('systemPrompt configuration', () => {
    describe('when provided as string SystemPromptData', () => {
      it('accepts and stores string system prompt', () => {
        const agent = new Agent({ systemPrompt: 'You are a helpful assistant' })
        expect(agent).toBeDefined()
      })
    })

    describe('when provided as array SystemPromptData', () => {
      it('converts TextBlockData to TextBlock', () => {
        const agent = new Agent({ systemPrompt: [{ text: 'System prompt text' }] })
        expect(agent).toBeDefined()
      })

      it('converts mixed block data types', () => {
        const agent = new Agent({
          systemPrompt: [{ text: 'First block' }, { cachePoint: { cacheType: 'default' } }, { text: 'Second block' }],
        })
        expect(agent).toBeDefined()
      })
    })

    describe('when provided as SystemPrompt (class instances)', () => {
      it('accepts array of class instances', () => {
        const systemPrompt = [new TextBlock('System prompt'), new CachePointBlock({ cacheType: 'default' })]
        const agent = new Agent({ systemPrompt })
        expect(agent).toBeDefined()
      })
    })
  })
})
