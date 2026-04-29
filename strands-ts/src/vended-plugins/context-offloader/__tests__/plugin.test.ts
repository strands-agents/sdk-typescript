import { describe, it, expect, vi } from 'vitest'
import { ContextOffloader } from '../plugin.js'
import { InMemoryStorage } from '../storage.js'
import { AfterToolCallEvent } from '../../../hooks/events.js'
import { TextBlock, JsonBlock, ToolResultBlock } from '../../../types/messages.js'
import { ImageBlock, DocumentBlock } from '../../../types/media.js'
import { createMockAgent, invokeTrackedHook } from '../../../__fixtures__/agent-helpers.js'
import { MockMessageModel } from '../../../__fixtures__/mock-message-model.js'

const mockModel = new MockMessageModel()

function makeMockAgent() {
  return createMockAgent({ extra: { model: mockModel } as never })
}

function makeEvent(
  content: InstanceType<typeof TextBlock | typeof JsonBlock | typeof ImageBlock | typeof DocumentBlock>[],
  overrides?: { status?: 'success' | 'error'; toolName?: string }
) {
  const agent = makeMockAgent()
  const result = new ToolResultBlock({
    toolUseId: 'tool-123',
    status: overrides?.status ?? 'success',
    content,
  })
  return new AfterToolCallEvent({
    agent,
    toolUse: { name: overrides?.toolName ?? 'some_tool', toolUseId: 'tool-123', input: {} },
    tool: undefined,
    result,
    invocationState: {},
  })
}

describe('ContextOffloader', () => {
  describe('constructor validation', () => {
    it('throws if maxResultTokens is not positive', () => {
      expect(() => new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 0 })).toThrow(
        'maxResultTokens must be positive'
      )
    })

    it('throws if previewTokens is negative', () => {
      expect(() => new ContextOffloader({ storage: new InMemoryStorage(), previewTokens: -1 })).toThrow(
        'previewTokens must be non-negative'
      )
    })

    it('throws if previewTokens >= maxResultTokens', () => {
      expect(
        () => new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 100, previewTokens: 100 })
      ).toThrow('previewTokens must be less than maxResultTokens')
    })
  })

  describe('plugin interface', () => {
    it('has correct name', () => {
      const plugin = new ContextOffloader({ storage: new InMemoryStorage() })
      expect(plugin.name).toBe('strands:context-offloader')
    })

    it('registers AfterToolCallEvent hook', () => {
      const plugin = new ContextOffloader({ storage: new InMemoryStorage() })
      const agent = createMockAgent()
      plugin.initAgent(agent)
      expect(agent.trackedHooks).toHaveLength(1)
      expect(agent.trackedHooks[0]!.eventType).toBe(AfterToolCallEvent)
    })

    it('returns retrieval tool by default', () => {
      const plugin = new ContextOffloader({ storage: new InMemoryStorage() })
      const tools = plugin.getTools()
      expect(tools).toHaveLength(1)
      expect(tools[0]!.name).toBe('retrieve_offloaded_content')
    })

    it('returns empty tools when includeRetrievalTool is false', () => {
      const plugin = new ContextOffloader({ storage: new InMemoryStorage(), includeRetrievalTool: false })
      expect(plugin.getTools()).toHaveLength(0)
    })
  })

  describe('hook behavior', () => {
    it('does not offload results below threshold', async () => {
      const storage = new InMemoryStorage()
      const plugin = new ContextOffloader({ storage, maxResultTokens: 2500 })
      const agent = createMockAgent()
      plugin.initAgent(agent)

      const event = makeEvent([new TextBlock('short text')])
      await invokeTrackedHook(agent, event)

      expect(event.result.content).toHaveLength(1)
      expect(event.result.content[0]).toBeInstanceOf(TextBlock)
      expect((event.result.content[0] as TextBlock).text).toBe('short text')
    })

    it('does not offload error results', async () => {
      const storage = new InMemoryStorage()
      const plugin = new ContextOffloader({ storage, maxResultTokens: 10, previewTokens: 5 })
      const agent = createMockAgent()
      plugin.initAgent(agent)

      const event = makeEvent([new TextBlock('x'.repeat(1000))], { status: 'error' })
      await invokeTrackedHook(agent, event)

      expect((event.result.content[0] as TextBlock).text).toBe('x'.repeat(1000))
    })

    it('does not offload retrieval tool results', async () => {
      const storage = new InMemoryStorage()
      const plugin = new ContextOffloader({ storage, maxResultTokens: 10, previewTokens: 5, includeRetrievalTool: true })
      const agent = createMockAgent()
      plugin.initAgent(agent)

      const event = makeEvent([new TextBlock('x'.repeat(1000))], { toolName: 'retrieve_offloaded_content' })
      await invokeTrackedHook(agent, event)

      expect((event.result.content[0] as TextBlock).text).toBe('x'.repeat(1000))
    })

    it('offloads large text results', async () => {
      const storage = new InMemoryStorage()
      const plugin = new ContextOffloader({ storage, maxResultTokens: 100, previewTokens: 10 })
      const agent = createMockAgent()
      plugin.initAgent(agent)

      const largeText = 'a'.repeat(2000)
      const event = makeEvent([new TextBlock(largeText)])
      await invokeTrackedHook(agent, event)

      expect(event.result.content).toHaveLength(1)
      const preview = (event.result.content[0] as TextBlock).text
      expect(preview).toContain('[Offloaded:')
      expect(preview).toContain('Tool result was offloaded')
      expect(preview).toContain('[Stored references:]')
      expect(preview).not.toContain(largeText)
    })

    it('offloads large JSON results', async () => {
      const storage = new InMemoryStorage()
      // JSON uses chars/2 heuristic, so 1000 chars of JSON ≈ 500 tokens
      const plugin = new ContextOffloader({ storage, maxResultTokens: 10, previewTokens: 5 })
      const agent = createMockAgent()
      plugin.initAgent(agent)

      const largeJson = { data: 'x'.repeat(1000) }
      const event = makeEvent([new JsonBlock({ json: largeJson })])
      await invokeTrackedHook(agent, event)

      const preview = (event.result.content[0] as TextBlock).text
      expect(preview).toContain('[Offloaded:')
      expect(preview).toContain('json,')
    })

    it('offloads image blocks with placeholder', async () => {
      const storage = new InMemoryStorage()
      const plugin = new ContextOffloader({ storage, maxResultTokens: 10, previewTokens: 5 })
      const agent = createMockAgent()
      plugin.initAgent(agent)

      const imgBytes = new Uint8Array(10000)
      const event = makeEvent([
        new TextBlock('x'.repeat(1000)),
        new ImageBlock({ format: 'png', source: { bytes: imgBytes } }),
      ])
      await invokeTrackedHook(agent, event)

      const imageBlock = event.result.content.find((b) => b instanceof TextBlock && b.text.includes('[image:'))
      expect(imageBlock).toBeDefined()
      expect((imageBlock as TextBlock).text).toContain('[image: png,')
      expect((imageBlock as TextBlock).text).toContain('ref:')
    })

    it('offloads document blocks with placeholder', async () => {
      const storage = new InMemoryStorage()
      const plugin = new ContextOffloader({ storage, maxResultTokens: 10, previewTokens: 5 })
      const agent = createMockAgent()
      plugin.initAgent(agent)

      const docBytes = new Uint8Array(10000)
      const event = makeEvent([
        new TextBlock('x'.repeat(1000)),
        new DocumentBlock({ format: 'pdf', name: 'report.pdf', source: { bytes: docBytes } }),
      ])
      await invokeTrackedHook(agent, event)

      const docBlock = event.result.content.find((b) => b instanceof TextBlock && b.text.includes('[document:'))
      expect(docBlock).toBeDefined()
      expect((docBlock as TextBlock).text).toContain('[document: pdf, report.pdf,')
      expect((docBlock as TextBlock).text).toContain('ref:')
    })

    it('preserves original result on storage failure', async () => {
      const failingStorage: InMemoryStorage = new InMemoryStorage()
      vi.spyOn(failingStorage, 'store').mockImplementation(() => {
        throw new Error('storage down')
      })

      const plugin = new ContextOffloader({ storage: failingStorage, maxResultTokens: 10, previewTokens: 5 })
      const agent = createMockAgent()
      plugin.initAgent(agent)

      const event = makeEvent([new TextBlock('x'.repeat(1000))])
      const originalResult = event.result
      await invokeTrackedHook(agent, event)

      expect(event.result).toBe(originalResult)
    })

    it('includes retrieval tool guidance when enabled', async () => {
      const storage = new InMemoryStorage()
      const plugin = new ContextOffloader({
        storage,
        maxResultTokens: 10,
        previewTokens: 5,
        includeRetrievalTool: true,
      })
      const agent = createMockAgent()
      plugin.initAgent(agent)

      const event = makeEvent([new TextBlock('x'.repeat(1000))])
      await invokeTrackedHook(agent, event)

      const preview = (event.result.content[0] as TextBlock).text
      expect(preview).toContain('retrieve_offloaded_content')
    })

    it('respects custom previewTokens', async () => {
      const storage = new InMemoryStorage()
      const plugin = new ContextOffloader({ storage, maxResultTokens: 10, previewTokens: 2 })
      const agent = createMockAgent()
      plugin.initAgent(agent)

      const event = makeEvent([new TextBlock('a'.repeat(1000))])
      await invokeTrackedHook(agent, event)

      const preview = (event.result.content[0] as TextBlock).text
      const previewSection = preview.split('[Stored references:]')[0]
      // previewTokens=2 → 2*4=8 chars of 'a' in preview
      expect(previewSection).toContain('a'.repeat(8))
      expect(previewSection).not.toContain('a'.repeat(100))
    })

    it('stores and retrieves content round-trip', async () => {
      const storage = new InMemoryStorage()
      const plugin = new ContextOffloader({
        storage,
        maxResultTokens: 10,
        previewTokens: 5,
        includeRetrievalTool: true,
      })
      const agent = createMockAgent()
      plugin.initAgent(agent)

      const event = makeEvent([new TextBlock('hello world '.repeat(100))])
      await invokeTrackedHook(agent, event)

      const preview = (event.result.content[0] as TextBlock).text
      const refMatch = preview.match(/mem_\d+_tool-123_0/)
      expect(refMatch).not.toBeNull()

      const retrieved = storage.retrieve(refMatch![0])
      expect(new TextDecoder().decode(retrieved.content)).toBe('hello world '.repeat(100))
    })
  })

  describe('retrieval tool', () => {
    it('retrieves text content as string', async () => {
      const storage = new InMemoryStorage()
      const ref = storage.store('k1', new TextEncoder().encode('hello'), 'text/plain')

      const plugin = new ContextOffloader({ storage, includeRetrievalTool: true })
      const tools = plugin.getTools()
      const retrievalTool = tools[0]!
      const result = await (retrievalTool as unknown as { invoke(input: unknown): Promise<unknown> }).invoke({ reference: ref })
      expect(result).toBe('hello')
    })

    it('retrieves JSON content as parsed object', async () => {
      const storage = new InMemoryStorage()
      const ref = storage.store('k1', new TextEncoder().encode('{"foo":"bar"}'), 'application/json')

      const plugin = new ContextOffloader({ storage, includeRetrievalTool: true })
      const tools = plugin.getTools()
      const retrievalTool = tools[0]!
      const result = await (retrievalTool as unknown as { invoke(input: unknown): Promise<unknown> }).invoke({ reference: ref })
      expect(result).toEqual({ foo: 'bar' })
    })

    it('retrieves image content as ImageBlock', async () => {
      const storage = new InMemoryStorage()
      const imgBytes = new Uint8Array([137, 80, 78, 71])
      const ref = storage.store('k1', imgBytes, 'image/png')

      const plugin = new ContextOffloader({ storage, includeRetrievalTool: true })
      const tools = plugin.getTools()
      const retrievalTool = tools[0]!
      const result = await (retrievalTool as unknown as { invoke(input: unknown): Promise<unknown> }).invoke({ reference: ref })
      expect(result).toBeInstanceOf(ImageBlock)
      expect((result as ImageBlock).format).toBe('png')
    })

    it('retrieves document content as DocumentBlock', async () => {
      const storage = new InMemoryStorage()
      const docBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])
      const ref = storage.store('k1', docBytes, 'application/pdf')

      const plugin = new ContextOffloader({ storage, includeRetrievalTool: true })
      const tools = plugin.getTools()
      const retrievalTool = tools[0]!
      const result = await (retrievalTool as unknown as { invoke(input: unknown): Promise<unknown> }).invoke({ reference: ref })
      expect(result).toBeInstanceOf(DocumentBlock)
      expect((result as DocumentBlock).format).toBe('pdf')
    })

    it('returns error string for missing reference', async () => {
      const storage = new InMemoryStorage()
      const plugin = new ContextOffloader({ storage, includeRetrievalTool: true })
      const tools = plugin.getTools()
      const retrievalTool = tools[0]!
      const result = await (retrievalTool as unknown as { invoke(input: unknown): Promise<unknown> }).invoke({
        reference: 'nonexistent',
      })
      expect(result).toContain('Error: reference not found')
    })
  })
})
