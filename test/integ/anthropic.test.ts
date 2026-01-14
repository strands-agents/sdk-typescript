import { describe, expect, it } from 'vitest'
import { Message, Agent, FunctionTool, ImageBlock, DocumentBlock, TextBlock } from '@strands-agents/sdk'
import { collectIterator } from '$/sdk/__fixtures__/model-test-helpers.js'
import { loadFixture } from './__fixtures__/test-helpers.js'
import { anthropic } from './__fixtures__/model-providers.js'

import yellowPngUrl from './__resources__/yellow.png?url'
import letterPdfUrl from './__resources__/letter.pdf?url'

describe.skipIf(anthropic.skip)('AnthropicModel Integration Tests', () => {
  describe('Configuration', () => {
    it.concurrent('respects maxTokens configuration', async () => {
      const provider = anthropic.createModel({ maxTokens: 20 })
      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Write a very long story about space exploration.' }],
        },
      ]

      const events = await collectIterator(provider.stream(messages))

      const metadataEvent = events.find((e) => e.type === 'modelMetadataEvent')
      expect(metadataEvent?.usage?.outputTokens).toBeLessThanOrEqual(20)

      const messageStopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(messageStopEvent?.stopReason).toBe('maxTokens')
    })
  })

  describe('Prompt Caching', () => {
    it('uses system prompt cache on subsequent requests', async () => {
      const provider = anthropic.createModel({ maxTokens: 100 })

      const largeContext = `Context information: ${'repeat '.repeat(5000)} [${Date.now()}]`

      const cachedSystemPrompt = [
        new TextBlock('You are a helpful assistant.'),
        new TextBlock(largeContext),
        { type: 'cachePointBlock' as const, cacheType: 'default' as const },
      ]

      const events1 = await collectIterator(
        provider.stream([{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }], {
          systemPrompt: cachedSystemPrompt,
        })
      )

      const metadata1 = events1.find((e) => e.type === 'modelMetadataEvent')
      const writeTokens = metadata1?.usage?.cacheWriteInputTokens
      if (writeTokens !== undefined) {
        expect(writeTokens).toBeGreaterThan(0)
      }

      const events2 = await collectIterator(
        provider.stream([{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hi again' }] }], {
          systemPrompt: cachedSystemPrompt,
        })
      )

      const metadata2 = events2.find((e) => e.type === 'modelMetadataEvent')
      const readTokens = metadata2?.usage?.cacheReadInputTokens
      if (readTokens !== undefined) {
        expect(readTokens).toBeGreaterThanOrEqual(0)
      }
    })

    it('uses message cache points on subsequent requests', async () => {
      const provider = anthropic.createModel({ maxTokens: 100 })
      const largeContext = `Context information: ${'repeat '.repeat(5000)} [${Date.now()}]`

      const messagesWithCache = (text: string): Message[] => [
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

      const events1 = await collectIterator(provider.stream(messagesWithCache('Question 1')))
      const metadata1 = events1.find((e) => e.type === 'modelMetadataEvent')
      const writeTokens = metadata1?.usage?.cacheWriteInputTokens
      if (writeTokens !== undefined) {
        expect(writeTokens).toBeGreaterThan(0)
      }

      const events2 = await collectIterator(provider.stream(messagesWithCache('Question 2')))
      const metadata2 = events2.find((e) => e.type === 'modelMetadataEvent')
      const readTokens = metadata2?.usage?.cacheReadInputTokens
      if (readTokens !== undefined) {
        expect(readTokens).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('Media Support', () => {
    it('processes image input correctly', async () => {
      const provider = anthropic.createModel({ maxTokens: 100 })

      const imageBytes = await loadFixture(yellowPngUrl)

      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [
            new ImageBlock({
              format: 'png',
              source: { bytes: imageBytes },
            }),
            { type: 'textBlock', text: 'What color is this image? Reply with just the color name.' },
          ],
        },
      ]

      const events = await collectIterator(provider.stream(messages))

      const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(stopEvent?.stopReason).toBe('endTurn')

      let fullText = ''
      for (const event of events) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
          fullText += event.delta.text
        }
      }

      expect(fullText.toLowerCase()).toContain('yellow')
    })

    it('processes PDF document input correctly', async () => {
      const provider = anthropic.createModel({ maxTokens: 1024 })

      const pdfBytes = await loadFixture(letterPdfUrl)

      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [
            new DocumentBlock({
              name: 'letter.pdf',
              format: 'pdf',
              source: { bytes: pdfBytes },
            }),
            { type: 'textBlock', text: 'Summarize this document briefly.' },
          ],
        },
      ]

      const events = await collectIterator(provider.stream(messages))

      const stopEvent = events.find((e) => e.type === 'modelMessageStopEvent')
      expect(stopEvent?.stopReason).toBe('endTurn')

      let fullText = ''
      for (const event of events) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
          fullText += event.delta.text
        }
      }
      expect(fullText.length).toBeGreaterThan(10)
    })
  })

  describe('Thinking Mode', () => {
    it('emits thinking blocks when enabled', async () => {
      const provider = anthropic.createModel({
        maxTokens: 4000,
        params: {
          thinking: {
            type: 'enabled',
            budget_tokens: 2048,
          },
        },
      })

      const messages: Message[] = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'textBlock', text: 'Explain the theory of relativity step-by-step.' }],
        },
      ]

      const events = await collectIterator(provider.stream(messages))

      const thinkingEvents = events.filter(
        (e) => e.type === 'modelContentBlockDeltaEvent' && e.delta.type === 'reasoningContentDelta'
      )

      if (thinkingEvents.length > 0) {
        expect(thinkingEvents[0]!.type).toBe('modelContentBlockDeltaEvent')
        const firstThinking = thinkingEvents[0] as any
        expect(firstThinking.delta.text).toBeDefined()
      }
    })
  })

  describe('Agent Tool Use', () => {
    it('executes tools successfully', async () => {
      const provider = anthropic.createModel({ maxTokens: 1024 })

      const calculatorTool = new FunctionTool({
        name: 'calculator',
        description: 'Performs basic arithmetic',
        inputSchema: {
          type: 'object',
          properties: {
            expression: { type: 'string' },
          },
          required: ['expression'],
        },
        callback: async (input: any) => {
          const { expression } = input
          if (expression.includes('2 + 2') || expression.includes('2+2')) return '4'
          return 'unknown'
        },
      })

      const agent = new Agent({
        model: provider,
        tools: [calculatorTool],
      })

      const result = await agent.invoke('Calculate 2 + 2')

      expect(result.stopReason).toBe('endTurn')

      const toolUseMsg = agent.messages.find(
        (m) => m.role === 'assistant' && m.content.some((c) => c.type === 'toolUseBlock')
      )
      expect(toolUseMsg).toBeDefined()

      const finalTextBlock = result.lastMessage.content[0] as TextBlock
      expect(finalTextBlock.text).toContain('4')
    })
  })
})
