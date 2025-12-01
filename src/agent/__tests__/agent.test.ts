import { describe, expect, it } from 'vitest'
import { Agent, type ToolList } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { createMockTool, createRandomTool } from '../../__fixtures__/tool-helpers.js'
import { ConcurrentInvocationError } from '../../errors.js'
import {
  MaxTokensError,
  TextBlock,
  CachePointBlock,
  AgentResult,
  Message,
  ToolUseBlock,
  ToolResultBlock,
  ReasoningBlock,
  GuardContentBlock,
  ImageBlock,
  VideoBlock,
  DocumentBlock,
} from '../../index.js'
import { AgentPrinter } from '../printer.js'
import { BeforeInvocationEvent, BeforeToolsEvent } from '../../hooks/events.js'
import { BedrockModel } from '../../models/bedrock.js'

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
        const firstItem = items[0]
        expect(firstItem).toEqual(new BeforeInvocationEvent({ agent: agent }))
      })

      it('returns AgentResult as generator return value', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model })

        const { result } = await collectGenerator(agent.stream('Test prompt'))

        expect(result).toEqual(
          new AgentResult({
            stopReason: 'endTurn',
            lastMessage: expect.objectContaining({
              role: 'assistant',
              content: expect.arrayContaining([expect.objectContaining({ type: 'textBlock', text: 'Hello' })]),
            }),
          })
        )
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

        expect(beforeTools).toEqual(
          new BeforeToolsEvent({
            agent: agent,
            message: new Message({
              role: 'assistant',
              content: [new ToolUseBlock({ name: 'testTool', toolUseId: 'tool-1', input: {} })],
            }),
          })
        )

        expect(afterTools).toBeDefined()
        expect(afterTools?.type).toBe('afterToolsEvent')
        expect(afterTools?.message).toEqual({
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
        })
        expect(afterTools).toHaveProperty('agent', agent)
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
          type: 'agentResult',
          stopReason: 'endTurn',
          lastMessage: expect.objectContaining({
            type: 'message',
            role: 'assistant',
            content: expect.arrayContaining([expect.objectContaining({ type: 'textBlock', text: 'Response text' })]),
          }),
        })
      })

      it('consumes stream events internally', async () => {
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model })

        const result = await agent.invoke('Test')

        expect(result).toEqual({
          type: 'agentResult',
          stopReason: 'endTurn',
          lastMessage: expect.objectContaining({
            type: 'message',
            role: 'assistant',
            content: expect.arrayContaining([expect.objectContaining({ type: 'textBlock', text: 'Hello' })]),
          }),
        })
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
          type: 'agentResult',
          stopReason: 'endTurn',
          lastMessage: expect.objectContaining({
            type: 'message',
            role: 'assistant',
            content: expect.arrayContaining([expect.objectContaining({ type: 'textBlock', text: 'The answer is 3' })]),
          }),
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

  describe('model property', () => {
    describe('when accessing the model field', () => {
      it('returns the configured model instance', () => {
        const model = new MockMessageModel()
        const agent = new Agent({ model })

        expect(agent.model).toBe(model)
      })

      it('returns default BedrockModel when no model provided', () => {
        const agent = new Agent()

        expect(agent.model).toBeDefined()
        expect(agent.model.constructor.name).toBe('BedrockModel')
      })
    })

    describe('when modifying the model field', () => {
      it('updates the model instance', () => {
        const initialModel = new MockMessageModel()
        const newModel = new MockMessageModel()
        const agent = new Agent({ model: initialModel })

        agent.model = newModel

        expect(agent.model).toBe(newModel)
        expect(agent.model).not.toBe(initialModel)
      })

      it('allows model change to persist across invocations', async () => {
        const firstModel = new MockMessageModel().addTurn({ type: 'textBlock', text: 'First response' })
        const secondModel = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Second response' })
        const agent = new Agent({ model: firstModel })

        // First invocation with initial model
        const firstResult = await agent.invoke('First prompt')
        expect(firstResult.lastMessage?.content[0]).toEqual(new TextBlock('First response'))

        // Change model
        agent.model = secondModel

        // Second invocation should use new model
        const secondResult = await agent.invoke('Second prompt')
        expect(secondResult.lastMessage?.content[0]).toEqual(new TextBlock('Second response'))
      })

      it('successfully switches between different model providers', async () => {
        const bedrockModel = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Bedrock response' })
        const openaiModel = new MockMessageModel().addTurn({ type: 'textBlock', text: 'OpenAI response' })
        const agent = new Agent({ model: bedrockModel })

        // First invocation
        const firstResult = await agent.invoke('First prompt')
        expect(firstResult.lastMessage?.content[0]).toEqual(new TextBlock('Bedrock response'))

        // Switch to different provider
        agent.model = openaiModel

        // Second invocation with new provider
        const secondResult = await agent.invoke('Second prompt')
        expect(secondResult.lastMessage?.content[0]).toEqual(new TextBlock('OpenAI response'))
      })
    })
  })

  describe('multimodal input', () => {
    describe('with string input', () => {
      it('creates user message with single TextBlock', async () => {
        const model = new MockMessageModel().addTurn(new TextBlock('Response'))
        const agent = new Agent({ model })

        await agent.invoke('Hello')

        expect(agent.messages).toHaveLength(2)
        expect(agent.messages[0]).toEqual(
          new Message({
            role: 'user',
            content: [new TextBlock('Hello')],
          })
        )
      })
    })

    describe('with ContentBlock[] input', () => {
      it('creates single user message with single TextBlock', async () => {
        const model = new MockMessageModel().addTurn(new TextBlock('Response'))
        const agent = new Agent({ model })

        await agent.invoke([new TextBlock('Hello')])

        expect(agent.messages).toHaveLength(2)
        expect(agent.messages[0]).toEqual(
          new Message({
            role: 'user',
            content: [new TextBlock('Hello')],
          })
        )
      })

      it('creates single user message with multiple blocks', async () => {
        const model = new MockMessageModel().addTurn(new TextBlock('Response'))
        const agent = new Agent({ model })

        const contentBlocks = [new TextBlock('Analyze this'), new TextBlock('and this')]

        await agent.invoke(contentBlocks)

        expect(agent.messages).toHaveLength(2)
        expect(agent.messages[0]).toEqual(
          new Message({
            role: 'user',
            content: contentBlocks,
          })
        )
      })

      it('supports all ContentBlock types', async () => {
        const model = new MockMessageModel().addTurn(new TextBlock('Response'))
        const agent = new Agent({ model })

        const contentBlocks = [
          new TextBlock('Text content'),
          new ToolUseBlock({ name: 'tool1', toolUseId: 'id-1', input: { key: 'value' } }),
          new ToolResultBlock({
            toolUseId: 'id-1',
            status: 'success',
            content: [new TextBlock('Result')],
          }),
          new ReasoningBlock({ text: 'My reasoning' }),
          new CachePointBlock({ cacheType: 'default' }),
          new GuardContentBlock({ text: { text: 'Guard content', qualifiers: ['grounding_source'] } }),
          new ImageBlock({
            format: 'png',
            source: { url: 'https://example.com/image.png' },
          }),
          new VideoBlock({
            format: 'mp4',
            source: { s3Location: { uri: 's3://bucket/video.mp4' } },
          }),
          new DocumentBlock({
            format: 'pdf',
            name: 'doc.pdf',
            source: { bytes: new Uint8Array([1, 2, 3]) },
          }),
        ]

        await agent.invoke(contentBlocks)

        expect(agent.messages).toHaveLength(2)
        expect(agent.messages[0]).toEqual(
          new Message({
            role: 'user',
            content: contentBlocks,
          })
        )
      })

      it('handles empty ContentBlock array', async () => {
        const model = new MockMessageModel().addTurn(new TextBlock('Response'))
        const agent = new Agent({ model })

        await agent.invoke([])

        expect(agent.messages).toHaveLength(1) // Only response message added
      })

      it('accepts ContentBlockData[] and converts to ContentBlock[]', async () => {
        const model = new MockMessageModel().addTurn(new TextBlock('Response'))
        const agent = new Agent({ model })

        await agent.invoke([
          { text: 'Hello from data format' },
          {
            toolUse: {
              name: 'testTool',
              toolUseId: 'id-1',
              input: { key: 'value' },
            },
          },
          {
            toolResult: {
              toolUseId: 'id-1',
              status: 'success' as const,
              content: [{ text: 'Tool result' }, { json: { result: 42 } }],
            },
          },
          { reasoning: { text: 'My reasoning' } },
          { cachePoint: { cacheType: 'default' as const } },
          { guardContent: { text: { text: 'Guard text', qualifiers: ['query' as const] } } },
          {
            image: {
              format: 'png' as const,
              source: { url: 'https://example.com/image.png' },
            },
          },
          {
            video: {
              format: 'mp4' as const,
              source: { s3Location: { uri: 's3://bucket/video.mp4' } },
            },
          },
          {
            document: {
              format: 'pdf' as const,
              name: 'doc.pdf',
              source: { bytes: new Uint8Array([1, 2, 3]) },
            },
          },
        ])

        expect(agent.messages).toHaveLength(2)
        const userMessage = agent.messages[0]!
        expect(userMessage.role).toBe('user')
        expect(userMessage.content).toHaveLength(9)
        expect(userMessage.content[0]).toEqual(new TextBlock('Hello from data format'))
        expect(userMessage.content[1]).toEqual(
          new ToolUseBlock({ name: 'testTool', toolUseId: 'id-1', input: { key: 'value' } })
        )
      })
    })

    describe('with Message[] input', () => {
      it('appends single message to conversation', async () => {
        const model = new MockMessageModel().addTurn(new TextBlock('Response'))
        const agent = new Agent({ model })

        const userMessage = new Message({
          role: 'user',
          content: [new TextBlock('Hello')],
        })

        await agent.invoke([userMessage])

        expect(agent.messages).toHaveLength(2)
        expect(agent.messages[0]).toEqual(userMessage)
      })

      it('appends multiple messages in order', async () => {
        const model = new MockMessageModel().addTurn(new TextBlock('Response'))
        const agent = new Agent({ model })

        const messages = [
          new Message({
            role: 'user',
            content: [new TextBlock('First message')],
          }),
          new Message({
            role: 'assistant',
            content: [new TextBlock('Second message')],
          }),
          new Message({
            role: 'user',
            content: [new TextBlock('Third message')],
          }),
        ]

        await agent.invoke(messages)

        expect(agent.messages).toHaveLength(4) // 3 input + 1 response
        expect(agent.messages[0]).toEqual(messages[0])
        expect(agent.messages[1]).toEqual(messages[1])
        expect(agent.messages[2]).toEqual(messages[2])
      })

      it('handles empty Message array', async () => {
        const model = new MockMessageModel().addTurn(new TextBlock('Response'))
        const agent = new Agent({ model })

        await agent.invoke([])

        expect(agent.messages).toHaveLength(1) // Only response message added
      })

      it('accepts MessageData[] and converts to Message[]', async () => {
        const model = new MockMessageModel().addTurn(new TextBlock('Response'))
        const agent = new Agent({ model })

        const messageDataArray = [
          {
            role: 'user' as const,
            content: [{ text: 'First message' }],
          },
          {
            role: 'assistant' as const,
            content: [{ text: 'Second message' }],
          },
        ]

        await agent.invoke(messageDataArray)

        expect(agent.messages).toHaveLength(3) // 2 input + 1 response
        expect(agent.messages[0]).toEqual(
          new Message({
            role: 'user',
            content: [new TextBlock('First message')],
          })
        )
        expect(agent.messages[1]).toEqual(
          new Message({
            role: 'assistant',
            content: [new TextBlock('Second message')],
          })
        )
      })
    })
  })

  describe('model initialization', () => {
    describe('when model is a string', () => {
      it('creates BedrockModel with specified modelId', () => {
        const agent = new Agent({ model: 'anthropic.claude-3-5-sonnet-20240620-v1:0' })

        expect(agent.model).toBeDefined()
        expect(agent.model.constructor.name).toBe('BedrockModel')
        expect(agent.model.getConfig().modelId).toBe('anthropic.claude-3-5-sonnet-20240620-v1:0')
      })

      it('creates BedrockModel with custom model ID', () => {
        const customModelId = 'custom.model.id'
        const agent = new Agent({ model: customModelId })

        expect(agent.model.getConfig().modelId).toBe(customModelId)
      })
    })

    describe('when model is explicit BedrockModel', () => {
      it('uses provided BedrockModel instance', () => {
        const explicitModel = new BedrockModel({ modelId: 'explicit-model-id' })
        const agent = new Agent({ model: explicitModel })

        expect(agent.model).toBe(explicitModel)
        expect(agent.model.getConfig().modelId).toBe('explicit-model-id')
      })
    })

    describe('when no model is provided', () => {
      it('creates default BedrockModel', () => {
        const agent = new Agent()

        expect(agent.model).toBeDefined()
        expect(agent.model.constructor.name).toBe('BedrockModel')
      })
    })

    describe('behavior parity', () => {
      it('string model behaves identically to explicit BedrockModel with same modelId', () => {
        const modelId = 'anthropic.claude-3-5-sonnet-20240620-v1:0'

        // Create agent with string model ID
        const agentWithString = new Agent({ model: modelId })

        // Create agent with explicit BedrockModel
        const explicitModel = new BedrockModel({ modelId })
        const agentWithExplicit = new Agent({ model: explicitModel })

        // Both should have same modelId
        expect(agentWithString.model.getConfig().modelId).toBe(agentWithExplicit.model.getConfig().modelId)
        expect(agentWithString.model.getConfig().modelId).toBe(modelId)
      })
    })
  })
})
