import { describe, it, expect } from 'vitest'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { BedrockModelProvider, DEFAULT_BEDROCK_MODEL_ID } from '@strands-agents/sdk'
import { ContextWindowOverflowError } from '@strands-agents/sdk'
import type { Message } from '@strands-agents/sdk'
import type { ToolSpec } from '@strands-agents/sdk'

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

describe('BedrockModelProvider Integration Tests', () => {
  describe('Basic Streaming', () => {
    it.skipIf(!hasCredentials).concurrent(
      'streams a simple text response',
      async () => {
        const provider = new BedrockModelProvider({
          modelConfig: {
            modelId: DEFAULT_BEDROCK_MODEL_ID,
            maxTokens: 100,
          },
        })

        const messages: Message[] = [
          {
            role: 'user',
            content: [{ type: 'textBlock', text: 'Say hello in one word.' }],
          },
        ]

        const events = []
        for await (const event of provider.stream(messages)) {
          events.push(event)
        }

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
      },
      30000
    ) // 30 second timeout for API call

    it.skipIf(!hasCredentials).concurrent(
      'respects system prompt',
      async () => {
        const provider = new BedrockModelProvider({
          modelConfig: {
            maxTokens: 50,
          },
        })

        const messages: Message[] = [
          {
            role: 'user',
            content: [{ type: 'textBlock', text: 'What should I say?' }],
          },
        ]

        const systemPrompt = 'Always respond with exactly the word "TEST" and nothing else.'

        const events = []
        for await (const event of provider.stream(messages, { systemPrompt })) {
          events.push(event)
        }

        // Collect the text response
        let responseText = ''
        for (const event of events) {
          if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
            responseText += event.delta.text
          }
        }

        // Response should contain "TEST" (allowing for minor variations in model compliance)
        expect(responseText.toUpperCase()).toContain('TEST')
      },
      30000
    )
  })

  describe('Tool Use', () => {
    it.skipIf(!hasCredentials).concurrent(
      'requests tool use when appropriate',
      async () => {
        const provider = new BedrockModelProvider({
          modelConfig: {
            maxTokens: 200,
          },
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

        const events = []
        for await (const event of provider.stream(messages, { toolSpecs: [calculatorTool] })) {
          events.push(event)
        }

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
      },
      30000
    )
  })

  describe('Configuration', () => {
    it.skipIf(!hasCredentials).concurrent(
      'respects maxTokens configuration',
      async () => {
        const provider = new BedrockModelProvider({
          modelConfig: {
            maxTokens: 20, // Very small limit
          },
        })

        const messages: Message[] = [
          {
            role: 'user',
            content: [{ type: 'textBlock', text: 'Write a long story about dragons.' }],
          },
        ]

        const events = []
        for await (const event of provider.stream(messages)) {
          events.push(event)
        }

        // Check metadata for token usage
        const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
        expect(metadataEvent?.usage?.outputTokens).toBeLessThanOrEqual(20)

        // Check that stop reason is maxTokens
        const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
        expect(messageStopEvent?.stopReason).toBe('maxTokens')
      },
      30000
    )
  })

  describe('Error Handling', () => {
    it.skipIf(!hasCredentials).concurrent(
      'handles invalid model ID gracefully',
      async () => {
        const provider = new BedrockModelProvider({
          modelConfig: {
            modelId: 'invalid-model-id-that-does-not-exist',
          },
        })

        const messages: Message[] = [
          {
            role: 'user',
            content: [{ type: 'textBlock', text: 'Hello' }],
          },
        ]

        // Should throw an error
        await expect(async () => {
          const events = []
          for await (const event of provider.stream(messages)) {
            events.push(event)
          }
        }).rejects.toThrow()
      },
      30000
    )

    it.skipIf(!hasCredentials).concurrent(
      'throws ContextWindowOverflowError when input exceeds context window',
      async () => {
        const provider = new BedrockModelProvider({
          modelConfig: {
            modelId: DEFAULT_BEDROCK_MODEL_ID,
            maxTokens: 100,
          },
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
          const events = []
          for await (const event of provider.stream(messages)) {
            events.push(event)
          }
        }).rejects.toBeInstanceOf(ContextWindowOverflowError)
      },
      30000
    )
  })
})
