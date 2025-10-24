import { describe, it, expect } from 'vitest'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { BedrockModel } from '../src/models/bedrock'
import { ContextWindowOverflowError } from '../src/errors'
import type { Message } from '../src/types/messages'
import type { ToolSpec } from '../src/tools/types'
import type { ModelStreamEvent } from '../src/models/streaming'
import { ValidationException } from '@aws-sdk/client-bedrock-runtime'

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

// Check credentials at module level so skipIf can use it
let hasCredentials = false
try {
  const credentialProvider = fromNodeProviderChain()
  await credentialProvider()
  hasCredentials = true
  console.log('✅ AWS credentials found for integration tests')
} catch {
  hasCredentials = false
  console.log('⏭️  AWS credentials not available - integration tests will be skipped')
}

describe.skipIf(!hasCredentials)('BedrockModel Integration Tests', () => {
  describe('Basic Streaming', () => {
    it.concurrent('streams a simple text response', async () => {
      const provider = new BedrockModel({
        maxTokens: 100,
      })

      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'Say hello in one word.' }],
        },
      ]

      const events = await collectEvents(provider.stream(messages))

      // Verify we got the expected event sequence
      expect(events.length).toBeGreaterThan(0)

      // Should have message start event
      const messageStartEvent = events.find((e) => e.type === 'modelMessageStartEvent')
      expect(messageStartEvent).toBeDefined()
      expect(messageStartEvent?.role).toBe('assistant')

      // Should have at least one content delta event
      const deltaEvents = events.filter((e) => e.type === 'modelContentBlockDeltaEvent')
      expect(deltaEvents.length).toBeGreaterThan(0)

      // Should have message stop event
      const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(messageStopEvent).toBeDefined()

      // Should have metadata with usage
      const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
      expect(metadataEvent).toBeDefined()
      expect(metadataEvent?.usage).toBeDefined()
      expect(metadataEvent?.usage?.inputTokens).toBeGreaterThan(0)
      expect(metadataEvent?.usage?.outputTokens).toBeGreaterThan(0)
    })

    it.concurrent('respects system prompt', async () => {
      const provider = new BedrockModel({
        maxTokens: 50,
      })

      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'What should I say?' }],
        },
      ]

      const systemPrompt = 'Always respond with exactly the word "TEST" and nothing else.'

      const events = await collectEvents(provider.stream(messages, { systemPrompt }))

      // Collect the text response
      let responseText = ''
      for (const event of events) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
          responseText += event.delta.text
        }
      }

      // Response should contain "TEST" (allowing for minor variations in model compliance)
      expect(responseText.toUpperCase()).toContain('TEST')
    })
  })

  describe('Tool Use', () => {
    it.concurrent('requests tool use when appropriate', async () => {
      const provider = new BedrockModel({
        maxTokens: 200,
      })

      const calculatorTool: ToolSpec = {
        name: 'calculator',
        description: 'Performs basic arithmetic operations',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['add', 'subtract', 'multiply', 'divide'],
              description: 'The arithmetic operation to perform',
            },
            a: {
              type: 'number',
              description: 'First number',
            },
            b: {
              type: 'number',
              description: 'Second number',
            },
          },
          required: ['operation', 'a', 'b'],
        },
      }

      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'What is 15 plus 27?' }],
        },
      ]

      const events = await collectEvents(provider.stream(messages, { toolSpecs: [calculatorTool] }))

      // Should have tool use in the response
      const toolUseStartEvents = events.filter(
        (e) => e.type === 'modelContentBlockStartEvent' && e.start?.type === 'toolUseStart'
      )
      expect(toolUseStartEvents.length).toBeGreaterThan(0)

      // Should have tool use input delta
      const toolInputDeltas = events.filter(
        (e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'toolUseInputDelta'
      )
      expect(toolInputDeltas.length).toBeGreaterThan(0)

      // Stop reason should be toolUse
      const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(messageStopEvent?.stopReason).toBe('toolUse')
    })
  })

  describe('Configuration', () => {
    it.concurrent('respects maxTokens configuration', async () => {
      const provider = new BedrockModel({
        maxTokens: 20, // Very small limit,
      })

      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'Write a long story about dragons.' }],
        },
      ]

      const events = await collectEvents(provider.stream(messages))

      // Check metadata for token usage
      const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
      expect(metadataEvent?.usage?.outputTokens).toBeLessThanOrEqual(20)

      // Check that stop reason is maxTokens
      const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(messageStopEvent?.stopReason).toBe('maxTokens')
    })

    it.concurrent('uses system prompt cache on subsequent requests', async () => {
      const provider = new BedrockModel({ maxTokens: 100 })

      // Create a system prompt with text + cache point
      // Use enough text to be worth caching (minimum 1024 tokens recommended by AWS)
      // Append unique string to ensure fresh cache creation on each test run
      const largeContext = 'Context information: ' + 'hello '.repeat(2000) + ` [test-${Date.now()}-${Math.random()}]`
      const cachedSystemPrompt = [
        { type: 'textBlock' as const, text: 'You are a helpful assistant.' },
        { type: 'textBlock' as const, text: largeContext },
        { type: 'cachePointBlock' as const, cacheType: 'default' as const },
      ]

      // First request - creates cache
      const messages1: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Say hello' }] }]
      const events1 = await collectEvents(provider.stream(messages1, { systemPrompt: cachedSystemPrompt }))

      // Verify first request creates cache (if caching is supported)
      const metadata1 = events1.find((e) => e.type === 'modelMetadataEvent')
      expect(metadata1?.usage?.inputTokens).toBeGreaterThan(0)

      // Verify cache creation
      expect(metadata1.usage?.cacheWriteInputTokens).toBeGreaterThan(0)

      // Second request - should use cache
      const messages2: Message[] = [{ role: 'user', content: [{ type: 'textBlock', text: 'Say goodbye' }] }]
      const events2 = await collectEvents(provider.stream(messages2, { systemPrompt: cachedSystemPrompt }))

      // Verify second request uses cache (if caching is supported)
      const metadata2 = events2.find((e) => e.type === 'modelMetadataEvent')
      expect(metadata2?.usage).toBeDefined()

      // Verify cache read
      expect(metadata2?.usage?.cacheReadInputTokens).toBeGreaterThan(0)
    })

    it.concurrent('uses message cache points on subsequent requests', async () => {
      const provider = new BedrockModel({ maxTokens: 100 })

      // Create messages with cache points
      // Append unique string to ensure fresh cache creation on each test run
      const largeContext = 'Context information: ' + 'hello '.repeat(2000) + ` [test-${Date.now()}-${Math.random()}]`

      // First request - creates cache
      const messages1: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'textBlock', text: largeContext },
            { type: 'cachePointBlock', cacheType: 'default' },
            { type: 'textBlock', text: 'Say hello' },
          ],
        },
      ]

      // First request - creates cache
      const events1 = await collectEvents(provider.stream(messages1))

      // Verify first request creates cache (if caching is supported)
      const metadata1 = events1.find((e) => e.type === 'modelMetadataEvent')
      expect(metadata1?.usage?.inputTokens).toBeGreaterThan(0)

      // Verify cache creation
      expect(metadata1.usage?.cacheWriteInputTokens).toBeGreaterThan(0)

      // Second request - should use cache
      const messages2: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'textBlock', text: largeContext },
            { type: 'cachePointBlock', cacheType: 'default' },
            { type: 'textBlock', text: 'Say goodbye' },
          ],
        },
      ]
      const events2 = await collectEvents(provider.stream(messages2))

      // Verify second request uses cache (if caching is supported)
      const metadata2 = events2.find((e) => e.type === 'modelMetadataEvent')
      expect(metadata2?.usage).toBeDefined()

      // Verify cache read
      expect(metadata2.usage?.cacheReadInputTokens).toBeGreaterThan(0)
    })
  })

  describe('Error Handling', () => {
    it.concurrent('handles invalid model ID gracefully', async () => {
      const provider = new BedrockModel({
        modelId: 'invalid-model-id-that-does-not-exist',
      })

      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'Hello' }],
        },
      ]

      // Should throw an error
      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of provider.stream(messages)) {
          throw Error('Should not get here')
        }
      }).rejects.toThrow(ValidationException)
    })

    it.concurrent('throws ContextWindowOverflowError when input exceeds context window', async () => {
      const provider = new BedrockModel({
        maxTokens: 100,
      })

      // Create a message that exceeds context window (200k tokens ~800k characters)
      // Repeat "Too much text!" 100,000 times to exceed the limit
      const longText = 'Too much text! '.repeat(100000)

      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: longText }],
        },
      ]

      // Should throw ContextWindowOverflowError
      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of provider.stream(messages)) {
          throw Error('Should not get here')
        }
      }).rejects.toBeInstanceOf(ContextWindowOverflowError)
    })
  })
})
