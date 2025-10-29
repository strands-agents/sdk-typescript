import { describe, it, expect } from 'vitest'
import { OpenAIModel } from '@strands-agents/sdk'
import { ContextWindowOverflowError } from '@strands-agents/sdk'
import type { Message } from '@strands-agents/sdk'
import type { ToolSpec } from '@strands-agents/sdk'
import type { ModelStreamEvent } from '@strands-agents/sdk'

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

// Check for OpenAI API key at module level so skipIf can use it
let hasApiKey = false
try {
  if (process.env.OPENAI_API_KEY) {
    hasApiKey = true
    console.log('✅ OpenAI API key found for integration tests')
  } else {
    hasApiKey = false
    console.log('⏭️  OpenAI API key not available - integration tests will be skipped')
  }
} catch {
  hasApiKey = false
  console.log('⏭️  OpenAI API key not available - integration tests will be skipped')
}

describe.skipIf(!hasApiKey)('OpenAIModel Integration Tests', () => {
  describe('Basic Streaming', () => {
    it.concurrent('streams a simple text response', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
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

      // Should have content block start event
      const contentBlockStartEvent = events.find((e) => e.type === 'modelContentBlockStartEvent')
      expect(contentBlockStartEvent).toBeDefined()

      // Should have at least one content delta event
      const deltaEvents = events.filter((e) => e.type === 'modelContentBlockDeltaEvent')
      expect(deltaEvents.length).toBeGreaterThan(0)

      // Should have content block stop event
      const contentBlockStopEvent = events.find((e) => e.type === 'modelContentBlockStopEvent')
      expect(contentBlockStopEvent).toBeDefined()

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
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
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
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
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

    it.concurrent('handles tool result messages correctly', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
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

      // First request: User asks a question
      const messages1: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'What is 15 plus 27?' }],
        },
      ]

      const events1 = await collectEvents(provider.stream(messages1, { toolSpecs: [calculatorTool] }))

      // Extract tool use information
      const toolUseStartEvent = events1.find(
        (e) => e.type === 'modelContentBlockStartEvent' && e.start?.type === 'toolUseStart'
      ) as
        | { type: 'modelContentBlockStartEvent'; start?: { type: 'toolUseStart'; toolUseId: string; name: string } }
        | undefined
      expect(toolUseStartEvent).toBeDefined()

      const toolUseId = toolUseStartEvent?.start?.toolUseId
      expect(toolUseId).toBeDefined()

      // Collect tool input
      let toolInput = ''
      for (const event of events1) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'toolUseInputDelta') {
          toolInput += event.delta.input
        }
      }

      // Parse and verify tool input is valid JSON
      expect(() => JSON.parse(toolInput)).not.toThrow()
      const parsedInput = JSON.parse(toolInput)
      expect(parsedInput.operation).toBe('add')
      expect(parsedInput.a).toBe(15)
      expect(parsedInput.b).toBe(27)

      // Second request: Return tool result
      const messages2: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'What is 15 plus 27?' }],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'toolUseBlock',
              name: 'calculator',
              toolUseId: toolUseId!,
              input: { operation: 'add', a: 15, b: 27 },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'toolResultBlock',
              toolUseId: toolUseId!,
              content: [{ type: 'toolResultTextContent', text: '42' }],
              status: 'success',
            },
          ],
        },
      ]

      const events2 = await collectEvents(provider.stream(messages2, { toolSpecs: [calculatorTool] }))

      // Should process the tool result and generate a response
      const textDeltas = events2.filter((e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'textDelta')
      expect(textDeltas.length).toBeGreaterThan(0)

      // Collect response text
      let responseText = ''
      for (const event of events2) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
          responseText += event.delta.text
        }
      }

      // Response should mention the result (42)
      expect(responseText).toContain('42')
    })
  })

  describe('Configuration', () => {
    it.concurrent('respects maxTokens configuration', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
        maxTokens: 20, // Very small limit
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
      expect(metadataEvent?.usage?.outputTokens).toBeLessThanOrEqual(25) // Allow small buffer

      // Check that stop reason is maxTokens
      const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(messageStopEvent?.stopReason).toBe('maxTokens')
    })

    it.concurrent('respects temperature configuration', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
        temperature: 0, // Deterministic
        maxTokens: 50,
      })

      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'Say "hello world" exactly.' }],
        },
      ]

      const events1 = await collectEvents(provider.stream(messages))
      const events2 = await collectEvents(provider.stream(messages))

      // Collect text from both runs
      let text1 = ''
      let text2 = ''

      for (const event of events1) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
          text1 += event.delta.text
        }
      }

      for (const event of events2) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
          text2 += event.delta.text
        }
      }

      // With temperature=0, responses should be very similar or identical
      expect(text1.length).toBeGreaterThan(0)
      expect(text2.length).toBeGreaterThan(0)
      // Both should contain "hello" in some form
      expect(text1.toLowerCase()).toContain('hello')
      expect(text2.toLowerCase()).toContain('hello')
    })
  })

  describe('Error Handling', () => {
    it.concurrent('handles invalid model ID gracefully', async () => {
      const provider = new OpenAIModel({
        modelId: 'invalid-model-id-that-does-not-exist-xyz',
      })

      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'Hello' }],
        },
      ]

      // Should throw an error (OpenAI will reject the invalid model)
      await expect(async () => {
        for await (const _event of provider.stream(messages)) {
          throw Error('Should not get here')
        }
      }).rejects.toThrow()
    })

    it.concurrent(
      'throws ContextWindowOverflowError when input exceeds context window',
      async () => {
        const provider = new OpenAIModel({
          modelId: 'gpt-4o-mini',
          maxTokens: 100,
        })

        // Create a message that exceeds context window
        // For gpt-4o-mini, context is ~128k tokens. Create ~150k tokens worth of text.
        // Rough estimate: 1 token ~= 4 characters, so 150k tokens ~= 600k characters
        const longText = 'Too much text! '.repeat(40000) // ~600k characters

        const messages: Message[] = [
          {
            role: 'user',
            content: [{ type: 'textBlock', text: longText }],
          },
        ]

        // Should throw ContextWindowOverflowError
        await expect(async () => {
          for await (const _event of provider.stream(messages)) {
            throw Error('Should not get here')
          }
        }).rejects.toBeInstanceOf(ContextWindowOverflowError)
      },
      60000 // 60 second timeout for this test
    )
  })

  describe('Content Block Lifecycle', () => {
    it.concurrent('emits complete content block lifecycle events', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
        maxTokens: 50,
      })

      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'Say hello.' }],
        },
      ]

      const events = await collectEvents(provider.stream(messages))

      // Verify complete lifecycle: start -> delta(s) -> stop
      const startEvents = events.filter((e) => e.type === 'modelContentBlockStartEvent')
      const deltaEvents = events.filter((e) => e.type === 'modelContentBlockDeltaEvent')
      const stopEvents = events.filter((e) => e.type === 'modelContentBlockStopEvent')

      expect(startEvents.length).toBeGreaterThan(0)
      expect(deltaEvents.length).toBeGreaterThan(0)
      expect(stopEvents.length).toBeGreaterThan(0)

      // Start should come before delta
      const startIndex = events.findIndex((e) => e.type === 'modelContentBlockStartEvent')
      const firstDeltaIndex = events.findIndex((e) => e.type === 'modelContentBlockDeltaEvent')
      expect(startIndex).toBeLessThan(firstDeltaIndex)

      // Stop should come after all deltas
      const stopIndex = events.findIndex((e) => e.type === 'modelContentBlockStopEvent')
      const lastDeltaIndex = events
        .map((e, i) => (e.type === 'modelContentBlockDeltaEvent' ? i : -1))
        .filter((i) => i !== -1)
        .pop()!
      expect(stopIndex).toBeGreaterThan(lastDeltaIndex)
    })
  })

  describe('Multi-turn Conversations', () => {
    it.concurrent('handles multi-turn conversations correctly', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
        maxTokens: 100,
      })

      // Turn 1: User asks a question
      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'My name is Alice. Remember this.' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'textBlock', text: 'I will remember that your name is Alice.' }],
        },
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'What is my name?' }],
        },
      ]

      const events = await collectEvents(provider.stream(messages))

      // Collect response text
      let responseText = ''
      for (const event of events) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
          responseText += event.delta.text
        }
      }

      // Response should mention Alice
      expect(responseText).toContain('Alice')
    })
  })

  describe('Stop Reasons', () => {
    it.concurrent('returns endTurn stop reason for natural completion', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
        maxTokens: 100,
      })

      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'Say hi.' }],
        },
      ]

      const events = await collectEvents(provider.stream(messages))

      const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(messageStopEvent).toBeDefined()
      expect(messageStopEvent?.stopReason).toBe('endTurn')
    })

    it.concurrent('returns maxTokens stop reason when token limit reached', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
        maxTokens: 10, // Very small limit to force cutoff
      })

      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'Write a very long story about dragons.' }],
        },
      ]

      const events = await collectEvents(provider.stream(messages))

      const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(messageStopEvent).toBeDefined()
      expect(messageStopEvent?.stopReason).toBe('maxTokens')
    })

    it.concurrent('returns toolUse stop reason when requesting tool use', async () => {
      const provider = new OpenAIModel({
        modelId: 'gpt-4o-mini',
        maxTokens: 200,
      })

      const calculatorTool: ToolSpec = {
        name: 'calculator',
        description: 'Performs basic arithmetic operations. Use this to calculate math expressions.',
        inputSchema: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'The math expression to calculate' },
          },
          required: ['expression'],
        },
      }

      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'textBlock', text: 'Calculate 42 times 7 please.' }],
        },
      ]

      const events = await collectEvents(provider.stream(messages, { toolSpecs: [calculatorTool] }))

      const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(messageStopEvent).toBeDefined()
      expect(messageStopEvent?.stopReason).toBe('toolUse')
    })
  })
})
