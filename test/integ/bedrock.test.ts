import { describe, expect, it, vi } from 'vitest'
import {
  Agent,
  Message,
  NullConversationManager,
  SlidingWindowConversationManager,
  TextBlock,
  FunctionTool,
} from '@strands-agents/sdk'

import { collectIterator } from '$/sdk/__fixtures__/model-test-helpers.js'
import { bedrock } from './__fixtures__/model-providers.js'

describe.skipIf(bedrock.skip)('BedrockModel Integration Tests', () => {
  describe('Streaming', () => {
    describe('Configuration', () => {
      it.concurrent('respects maxTokens configuration', async () => {
        const provider = bedrock.createModel({ maxTokens: 20 })
        const messages: Message[] = [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'textBlock', text: 'Write a long story about dragons.' }],
          },
        ]

        const events = await collectIterator(provider.stream(messages))

        const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
        expect(metadataEvent?.usage?.outputTokens).toBeLessThanOrEqual(20)

        const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
        expect(messageStopEvent?.stopReason).toBe('maxTokens')
      })

      it.concurrent('uses system prompt cache on subsequent requests', async () => {
        const provider = bedrock.createModel({ maxTokens: 100 })
        const largeContext = `Context information: ${'hello '.repeat(2000)} [test-${Date.now()}-${Math.random()}]`
        const cachedSystemPrompt = [
          { type: 'textBlock' as const, text: 'You are a helpful assistant.' },
          { type: 'textBlock' as const, text: largeContext },
          { type: 'cachePointBlock' as const, cacheType: 'default' as const },
        ]

        // First request - creates cache
        const events1 = await collectIterator(
          provider.stream([{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Say hello' }] }], {
            systemPrompt: cachedSystemPrompt,
          })
        )
        const metadata1 = events1.find((e) => e.type === 'modelMetadataEvent')
        expect(metadata1?.usage?.cacheWriteInputTokens).toBeGreaterThan(0)

        // Second request - should use cache
        const events2 = await collectIterator(
          provider.stream([{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Say goodbye' }] }], {
            systemPrompt: cachedSystemPrompt,
          })
        )
        const metadata2 = events2.find((e) => e.type === 'modelMetadataEvent')
        expect(metadata2?.usage?.cacheReadInputTokens).toBeGreaterThan(0)
      })

      it.concurrent('uses message cache points on subsequent requests', async () => {
        const provider = bedrock.createModel({ maxTokens: 100 })
        const largeContext = `Context information: ${'hello '.repeat(2000)} [test-${Date.now()}-${Math.random()}]`
        const messagesWithCachePoint = (text: string): Message[] => [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'textBlock', text: largeContext },
              { type: 'cachePointBlock', cacheType: 'default' },
              { type: 'textBlock', text },
            ],
          },
        ]

        // First request - creates cache
        const events1 = await collectIterator(provider.stream(messagesWithCachePoint('Say hello')))
        const metadata1 = events1.find((e) => e.type === 'modelMetadataEvent')
        expect(metadata1?.usage?.cacheWriteInputTokens).toBeGreaterThan(0)

        // Second request - should use cache
        const events2 = await collectIterator(provider.stream(messagesWithCachePoint('Say goodbye')))
        const metadata2 = events2.find((e) => e.type === 'modelMetadataEvent')
        expect(metadata2?.usage?.cacheReadInputTokens).toBeGreaterThan(0)
      })
    })

    describe('Error Handling', () => {
      it.concurrent('handles invalid model ID gracefully', async () => {
        const provider = bedrock.createModel({ modelId: 'invalid-model-id-that-does-not-exist' })
        const messages: Message[] = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
        await expect(collectIterator(provider.stream(messages))).rejects.toThrow()
      })
    })
  })

  describe('Agent with Conversation Manager', () => {
    it('manages conversation history with SlidingWindowConversationManager', async () => {
      const agent = new Agent({
        model: bedrock.createModel({ maxTokens: 100 }),
        conversationManager: new SlidingWindowConversationManager({ windowSize: 4 }),
      })

      // First exchange
      await agent.invoke('Count from 1 to 1.')
      expect(agent.messages).toHaveLength(2) // user + assistant

      // Second exchange
      await agent.invoke('Count from 2 to 2.')
      expect(agent.messages).toHaveLength(4) // 2 user + 2 assistant

      // Third exchange - should trigger sliding window
      await agent.invoke('Count from 3 to 3.')

      // Should maintain window size of 4 messages
      expect(agent.messages).toHaveLength(4)
    }, 30000)

    it('throws ContextWindowOverflowError with NullConversationManager', async () => {
      const agent = new Agent({
        model: bedrock.createModel({ maxTokens: 50 }),
        conversationManager: new NullConversationManager(),
      })

      // Generate a message that would require context management
      const longPrompt = 'Please write a very detailed explanation of ' + 'many topics '.repeat(50)

      // This should throw since NullConversationManager doesn't handle overflow
      await expect(agent.invoke(longPrompt)).rejects.toThrow()
    }, 30000)
  })

  describe('Region Configuration', () => {
    it('uses explicit region when provided', async () => {
      const provider = bedrock.createModel({
        region: 'us-east-1',
        maxTokens: 50,
      })

      // Validate region configuration by checking config.region() directly
      // Making an actual request doesn't guarantee the correct region is being used
      const regionResult = await provider['_client'].config.region()
      expect(regionResult).toBe('us-east-1')
    })

    it('uses region from clientConfig when provided', async () => {
      const provider = bedrock.createModel({
        clientConfig: { region: 'ap-northeast-1' },
        maxTokens: 50,
      })

      // Validate clientConfig region is used
      // Making an actual request doesn't guarantee the correct region is being used
      const regionResult = await provider['_client'].config.region()
      expect(regionResult).toBe('ap-northeast-1')
    })

    it('defaults to us-west-2 when no region provided and AWS SDK does not resolve one', async () => {
      // Use vitest to stub environment variables
      vi.stubEnv('AWS_REGION', undefined)
      vi.stubEnv('AWS_DEFAULT_REGION', undefined)

      const provider = bedrock.createModel({
        maxTokens: 50,
      })

      // Validate region defaults to us-west-2
      // Making an actual request doesn't guarantee the correct region is being used
      const regionResult = await provider['_client'].config.region()
      expect(regionResult).toBe('us-west-2')

      // ensure that invocation works
      await collectIterator(
        provider.stream([
          Message.fromMessageData({
            role: 'user',
            content: [new TextBlock('say hi')],
          }),
        ])
      )
    })

    it('uses region from clientConfig when provided', async () => {
      const provider = bedrock.createModel({
        clientConfig: { region: 'ap-northeast-1' },
        maxTokens: 50,
      })

      // Validate clientConfig region is used
      // Making an actual request doesn't guarantee the correct region is being used
      const regionResult = await provider['_client'].config.region()
      expect(regionResult).toBe('ap-northeast-1')
    })
  })

  describe('Thinking Mode with Tools', () => {
    it('handles thinking mode with tool use', async () => {
      const bedrockModel = bedrock.createModel({
        modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
        additionalRequestFields: {
          thinking: {
            type: 'enabled',
            budget_tokens: 1024,
          },
        },
        maxTokens: 2048,
      })

      const testTool = new FunctionTool({
        name: 'testTool',
        description: 'Test description',
        inputSchema: { type: 'object' },
        callback: (): string => 'result',
      })

      // Create agent with thinking mode and tool
      const agent = new Agent({
        model: bedrockModel,
        tools: [testTool],
        printer: false,
      })

      // Invoke agent with a prompt that triggers tool use
      const result = await agent.invoke('Use the testTool with the message "Hello World"')

      // Verify the agent completed successfully
      expect(result.stopReason).toBe('endTurn')
      expect(result.lastMessage.role).toBe('assistant')
      expect(result.lastMessage.content.length).toBeGreaterThan(0)

      // Verify the tool was used
      const toolUseMessage = agent.messages.find((msg) => msg.content.some((block) => block.type === 'toolUseBlock'))
      expect(toolUseMessage).toBeDefined()

      // Verify the tool result is in the history
      const toolResultMessage = agent.messages.find((msg) =>
        msg.content.some((block) => block.type === 'toolResultBlock')
      )
      expect(toolResultMessage).toBeDefined()
    }, 30000)
  })
})
