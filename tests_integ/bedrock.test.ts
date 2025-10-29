import { describe, it, expect } from 'vitest'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { BedrockModel } from '@strands-agents/sdk'
import { ContextWindowOverflowError } from '@strands-agents/sdk'
import type { Message } from '@strands-agents/sdk'
import type { ToolSpec } from '@strands-agents/sdk'
import type { ModelStreamEvent } from '@strands-agents/sdk'
import { ValidationException } from '@aws-sdk/client-bedrock-runtime'
import { fail } from 'assert/strict'

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

describe.skipIf(!hasCredentials)('BedrockModel Integration Tests (Non-Streaming)', () => {
  it('gets a simple text response', async () => {
    const provider = new BedrockModel({
      stream: false,
      maxTokens: 100,
    })

    const messages: Message[] = [
      {
        role: 'user',
        content: [{ type: 'textBlock', text: 'Say hello in exactly one word.' }],
      },
    ]

    const events = await collectEvents(provider.stream(messages))

    expect(events[0]?.type).toBe('modelMessageStartEvent')
    expect(events[1]?.type).toBe('modelContentBlockStartEvent')
    expect(events[2]?.type).toBe('modelContentBlockDeltaEvent')
    expect(events[3]?.type).toBe('modelContentBlockStopEvent')
    expect(events[4]?.type).toBe('modelMessageStopEvent')
    expect(events[5]?.type).toBe('modelMetadataEvent')

    let responseText = ''
    for (const event of events) {
      if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
        responseText += event.delta.text
      }
    }
    expect(responseText.trim().toUpperCase()).toContain('HELLO')

    const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
    expect(stopEvent?.stopReason).toBe('endTurn')

    const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
    if (metadataEvent?.type === 'modelMetadataEvent') {
      expect(metadataEvent.usage?.outputTokens).toBeGreaterThan(0)
    } else {
      fail('Metadata event not found')
    }
  })

  it('requests tool use when appropriate', async () => {
    const provider = new BedrockModel({
      stream: false,
      maxTokens: 200,
    })

    const calculatorTool: ToolSpec = {
      name: 'calculator',
      description: 'Performs basic arithmetic operations',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
          a: { type: 'number' },
          b: { type: 'number' },
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

    const startEvent = events.find((e) => e.type === 'modelContentBlockStartEvent')
    expect(startEvent).toBeDefined()

    if (startEvent?.type === 'modelContentBlockStartEvent') {
      expect(startEvent.start?.type).toBe('toolUseStart')
      expect(startEvent.start?.name).toBe('calculator')
    } else {
      fail('Content block start event not found')
    }

    const deltaEvent = events.find((e) => e.type === 'modelContentBlockDeltaEvent')
    expect(deltaEvent).toBeDefined()

    if (deltaEvent?.type === 'modelContentBlockDeltaEvent' && deltaEvent.delta.type === 'toolUseInputDelta') {
      const input = JSON.parse(deltaEvent.delta.input)
      expect(input.operation).toBe('add')
      expect(input.a).toBe(15)
      expect(input.b).toBe(27)
    } else {
      fail('Tool use input delta event not found')
    }

    const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
    expect(stopEvent?.stopReason).toBe('toolUse')
  })
})

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
