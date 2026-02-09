import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { retrieve } from '../retrieve.js'
import { createMockToolContext, runToolStream, getToolResultText } from './test-helpers.js'

vi.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: class MockClient {
    send = vi.fn().mockResolvedValue({
      retrievalResults: [
        {
          score: 0.9,
          content: { text: 'Mocked knowledge base result text' },
          location: { s3Location: { uri: 's3://bucket/key' } },
        },
      ],
    })
  },
  RetrieveCommand: class MockCommand {
    constructor(public input: unknown) {}
  },
}))

describe('retrieve tool', () => {
  const env = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...env, KNOWLEDGE_BASE_ID: 'test-kb-id' }
  })

  afterEach(() => {
    process.env = env
  })

  describe('properties', () => {
    it('has correct name and description', () => {
      expect(retrieve.name).toBe('retrieve')
      expect(retrieve.description).toContain('Bedrock')
      expect(retrieve.description).toContain('Knowledge Base')
    })
  })

  describe('invoke', () => {
    it('returns error when text is missing', async () => {
      const ctx = createMockToolContext('retrieve', {})
      const block = await runToolStream(retrieve, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Missing required field: text')
    })

    it('returns error when knowledgeBaseId and env are missing', async () => {
      delete process.env.KNOWLEDGE_BASE_ID
      const ctx = createMockToolContext('retrieve', { text: 'query' })
      const block = await runToolStream(retrieve, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('knowledge_base_id')
      expect(text).toContain('KNOWLEDGE_BASE_ID')
      process.env.KNOWLEDGE_BASE_ID = 'test-kb-id'
    })

    it('calls client and returns formatted results when text and kb id provided', async () => {
      const ctx = createMockToolContext('retrieve', {
        text: 'test query',
        knowledgeBaseId: 'my-kb',
      })
      const block = await runToolStream(retrieve, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Retrieved')
      expect(text).toContain('Mocked knowledge base result text')
    })
  })
})
