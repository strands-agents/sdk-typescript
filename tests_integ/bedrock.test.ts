import { describe, it, expect, beforeAll } from 'vitest'
import { BedrockModelProvider, DEFAULT_BEDROCK_MODEL_ID } from '@/models/bedrock'
import type { Message } from '@/types/messages'
import type { ToolSpec } from '@/tools/types'

// Integration tests that require real AWS credentials
// These tests will be skipped if AWS credentials are not available
describe('BedrockModelProvider Integration Tests', () => {
  let hasCredentials = false

  beforeAll(() => {
    // Check if AWS credentials are available
    // Tests will be skipped if credentials are not configured
    hasCredentials =
      !!process.env.AWS_ACCESS_KEY_ID ||
      !!process.env.AWS_PROFILE ||
      !!process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI

    if (!hasCredentials) {
      // Tests will be skipped if credentials not available
      // This is expected in environments without AWS access
    }
  })

  describe('Basic Streaming', () => {
    it.skipIf(!hasCredentials)(
      'streams a simple text response',
      async () => {
        const provider = new BedrockModelProvider(
          {
            modelId: DEFAULT_BEDROCK_MODEL_ID,
            maxTokens: 100,
          },
          {}
        )

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

    it.skipIf(!hasCredentials)(
      'respects system prompt',
      async () => {
        const provider = new BedrockModelProvider(
          {
            maxTokens: 50,
          },
          {}
        )

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
    it.skipIf(!hasCredentials)(
      'requests tool use when appropriate',
      async () => {
        const provider = new BedrockModelProvider(
          {
            maxTokens: 200,
          },
          {}
        )

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
    it.skipIf(!hasCredentials)(
      'respects maxTokens configuration',
      async () => {
        const provider = new BedrockModelProvider(
          {
            maxTokens: 20, // Very small limit
          },
          {}
        )

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
      },
      30000
    )

    it.skipIf(!hasCredentials)(
      'applies temperature setting',
      async () => {
        const provider = new BedrockModelProvider(
          {
            maxTokens: 50,
            temperature: 0.1, // Very low temperature for deterministic output
          },
          {}
        )

        const messages: Message[] = [
          {
            role: 'user',
            content: [{ type: 'textBlock', text: 'Say exactly: Hello World' }],
          },
        ]

        const events = []
        for await (const event of provider.stream(messages)) {
          events.push(event)
        }

        // Should get a response (verifies temperature didn't break the request)
        const deltaEvents = events.filter((e) => e.type === 'modelContentBlockDeltaEvent')
        expect(deltaEvents.length).toBeGreaterThan(0)
      },
      30000
    )
  })

  describe('Error Handling', () => {
    it.skipIf(!hasCredentials)(
      'handles invalid model ID gracefully',
      async () => {
        const provider = new BedrockModelProvider(
          {
            modelId: 'invalid-model-id-that-does-not-exist',
          },
          {}
        )

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
  })
})
