import { describe, expect, test, it } from 'vitest'
import {
  Message,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ReasoningBlock,
  CachePointBlock,
  GuardContentBlock,
  JsonBlock,
  type MessageData,
  type SystemPromptData,
  systemPromptFromData,
} from '../messages.js'
import { ImageBlock, VideoBlock, DocumentBlock } from '../media.js'

describe('Message', () => {
  test('creates message with role and content', () => {
    const content = [new TextBlock('test')]
    const message = new Message({ role: 'user', content })

    expect(message).toEqual({
      type: 'message',
      role: 'user',
      content,
    })
  })
})

describe('TextBlock', () => {
  test('creates text block with text', () => {
    const block = new TextBlock('hello')

    expect(block).toEqual({
      type: 'textBlock',
      text: 'hello',
    })
  })
})

describe('ToolUseBlock', () => {
  test('creates tool use block', () => {
    const block = new ToolUseBlock({
      name: 'test-tool',
      toolUseId: '123',
      input: { param: 'value' },
    })

    expect(block).toEqual({
      type: 'toolUseBlock',
      name: 'test-tool',
      toolUseId: '123',
      input: { param: 'value' },
    })
  })
})

describe('ToolResultBlock', () => {
  test('creates tool result block', () => {
    const block = new ToolResultBlock({
      toolUseId: '123',
      status: 'success',
      content: [{ type: 'textBlock', text: 'result' }],
    })

    expect(block).toEqual({
      type: 'toolResultBlock',
      toolUseId: '123',
      status: 'success',
      content: [{ type: 'textBlock', text: 'result' }],
    })
  })
})

describe('ReasoningBlock', () => {
  test('creates reasoning block with text', () => {
    const block = new ReasoningBlock({ text: 'thinking...' })

    expect(block).toEqual({
      type: 'reasoningBlock',
      text: 'thinking...',
    })
  })
})

describe('CachePointBlock', () => {
  test('creates cache point block', () => {
    const block = new CachePointBlock({ cacheType: 'default' })

    expect(block).toEqual({
      type: 'cachePointBlock',
      cacheType: 'default',
    })
  })
})

describe('JsonBlock', () => {
  test('creates json block', () => {
    const block = new JsonBlock({ json: { key: 'value' } })

    expect(block).toEqual({
      type: 'jsonBlock',
      json: { key: 'value' },
    })
  })
})

describe('Message.fromMessageData', () => {
  it('converts text block data to TextBlock', () => {
    const messageData: MessageData = {
      role: 'user',
      content: [{ text: 'hello world' }],
    }
    const message = Message.fromMessageData(messageData)
    expect(message.content).toHaveLength(1)
    expect(message.content[0]).toEqual(new TextBlock('hello world'))
  })

  it('converts tool use block data to ToolUseBlock', () => {
    const messageData: MessageData = {
      role: 'assistant',
      content: [
        {
          toolUse: {
            toolUseId: 'tool-123',
            name: 'test-tool',
            input: { key: 'value' },
          },
        },
      ],
    }
    const message = Message.fromMessageData(messageData)
    expect(message.content).toHaveLength(1)
    expect(message.content[0]).toBeInstanceOf(ToolUseBlock)
    expect(message.content[0]!.type).toBe('toolUseBlock')
  })

  it('converts tool result block data to ToolResultBlock with text content', () => {
    const messageData: MessageData = {
      role: 'user',
      content: [
        {
          toolResult: {
            toolUseId: 'tool-123',
            status: 'success',
            content: [{ text: 'result text' }],
          },
        },
      ],
    }
    const message = Message.fromMessageData(messageData)
    expect(message.content).toHaveLength(1)
    expect(message.content[0]).toBeInstanceOf(ToolResultBlock)
    const toolResultBlock = message.content[0] as ToolResultBlock
    expect(toolResultBlock.content).toHaveLength(1)
    expect(toolResultBlock.content[0]).toBeInstanceOf(TextBlock)
  })

  it('converts tool result block data to ToolResultBlock with json content', () => {
    const messageData: MessageData = {
      role: 'user',
      content: [
        {
          toolResult: {
            toolUseId: 'tool-123',
            status: 'success',
            content: [{ json: { result: 'value' } }],
          },
        },
      ],
    }
    const message = Message.fromMessageData(messageData)
    expect(message.content).toHaveLength(1)
    const toolResultBlock = message.content[0] as ToolResultBlock
    expect(toolResultBlock.content).toHaveLength(1)
    expect(toolResultBlock.content[0]).toBeInstanceOf(JsonBlock)
  })

  it('converts reasoning block data to ReasoningBlock', () => {
    const messageData: MessageData = {
      role: 'assistant',
      content: [
        {
          reasoning: { text: 'thinking about it...' },
        },
      ],
    }
    const message = Message.fromMessageData(messageData)
    expect(message.content).toHaveLength(1)
    expect(message.content[0]).toBeInstanceOf(ReasoningBlock)
    expect(message.content[0]!.type).toBe('reasoningBlock')
  })

  it('converts cache point block data to CachePointBlock', () => {
    const messageData: MessageData = {
      role: 'user',
      content: [
        {
          cachePoint: { cacheType: 'default' },
        },
      ],
    }
    const message = Message.fromMessageData(messageData)
    expect(message.content).toHaveLength(1)
    expect(message.content[0]).toBeInstanceOf(CachePointBlock)
    expect(message.content[0]!.type).toBe('cachePointBlock')
  })

  it('converts guard content block data to GuardContentBlock', () => {
    const messageData: MessageData = {
      role: 'user',
      content: [
        {
          guardContent: {
            text: {
              text: 'guard this content',
              qualifiers: ['guard_content'],
            },
          },
        },
      ],
    }
    const message = Message.fromMessageData(messageData)
    expect(message.content).toHaveLength(1)
    expect(message.content[0]!.type).toBe('guardContentBlock')
  })

  it('converts image block data to ImageBlock', () => {
    const messageData: MessageData = {
      role: 'user',
      content: [
        {
          image: {
            format: 'jpeg',
            source: { bytes: new Uint8Array([1, 2, 3]) },
          },
        },
      ],
    }
    const message = Message.fromMessageData(messageData)
    expect(message.content).toHaveLength(1)
    expect(message.content[0]).toBeInstanceOf(ImageBlock)
    expect(message.content[0]!.type).toBe('imageBlock')
  })

  it('converts video block data to VideoBlock', () => {
    const messageData: MessageData = {
      role: 'user',
      content: [
        {
          video: {
            format: 'mp4',
            source: { bytes: new Uint8Array([1, 2, 3]) },
          },
        },
      ],
    }
    const message = Message.fromMessageData(messageData)
    expect(message.content).toHaveLength(1)
    expect(message.content[0]).toBeInstanceOf(VideoBlock)
    expect(message.content[0]!.type).toBe('videoBlock')
  })

  it('converts document block data to DocumentBlock', () => {
    const messageData: MessageData = {
      role: 'user',
      content: [
        {
          document: {
            name: 'test.pdf',
            format: 'pdf',
            source: { bytes: new Uint8Array([1, 2, 3]) },
          },
        },
      ],
    }
    const message = Message.fromMessageData(messageData)
    expect(message.content).toHaveLength(1)
    expect(message.content[0]).toBeInstanceOf(DocumentBlock)
    expect(message.content[0]!.type).toBe('documentBlock')
  })

  it('converts multiple content blocks', () => {
    const messageData: MessageData = {
      role: 'user',
      content: [
        { text: 'first block' },
        { image: { format: 'png', source: { bytes: new Uint8Array([1, 2, 3]) } } },
        { text: 'second block' },
      ],
    }
    const message = Message.fromMessageData(messageData)
    expect(message.content).toHaveLength(3)
    expect(message.content[0]).toBeInstanceOf(TextBlock)
    expect(message.content[1]).toBeInstanceOf(ImageBlock)
    expect(message.content[2]).toBeInstanceOf(TextBlock)
  })

  it('throws error for unknown content block type', () => {
    const messageData = {
      role: 'user',
      content: [{ unknownType: { data: 'value' } }],
    } as unknown as MessageData
    expect(() => Message.fromMessageData(messageData)).toThrow('Unknown ContentBlockData type')
  })
})

describe('systemPromptFromData', () => {
  describe('when called with string', () => {
    it('returns the string unchanged', () => {
      const data: SystemPromptData = 'You are a helpful assistant'
      const result = systemPromptFromData(data)
      expect(result).toBe('You are a helpful assistant')
    })
  })

  describe('when called with TextBlockData', () => {
    it('converts to TextBlock', () => {
      const data: SystemPromptData = [{ text: 'System prompt text' }]
      const result = systemPromptFromData(data)
      expect(result).toEqual([new TextBlock('System prompt text')])
    })
  })

  describe('when called with CachePointBlockData', () => {
    it('converts to CachePointBlock', () => {
      const data: SystemPromptData = [{ text: 'prompt' }, { cachePoint: { cacheType: 'default' } }]
      const result = systemPromptFromData(data)
      expect(result).toEqual([new TextBlock('prompt'), new CachePointBlock({ cacheType: 'default' })])
    })
  })

  describe('when called with GuardContentBlockData', () => {
    it('converts to GuardContentBlock', () => {
      const data: SystemPromptData = [
        {
          guardContent: {
            text: {
              text: 'guard this content',
              qualifiers: ['guard_content'],
            },
          },
        },
      ]
      const result = systemPromptFromData(data)
      expect(result).toEqual([
        new GuardContentBlock({
          text: {
            text: 'guard this content',
            qualifiers: ['guard_content'],
          },
        }),
      ])
    })
  })

  describe('when called with mixed content blocks', () => {
    it('converts all block types correctly', () => {
      const data: SystemPromptData = [
        { text: 'First text block' },
        { cachePoint: { cacheType: 'default' } },
        { text: 'Second text block' },
        {
          guardContent: {
            text: {
              text: 'guard content',
              qualifiers: ['guard_content'],
            },
          },
        },
      ]
      const result = systemPromptFromData(data)
      expect(result).toEqual([
        new TextBlock('First text block'),
        new CachePointBlock({ cacheType: 'default' }),
        new TextBlock('Second text block'),
        new GuardContentBlock({
          text: {
            text: 'guard content',
            qualifiers: ['guard_content'],
          },
        }),
      ])
    })
  })

  describe('when called with empty array', () => {
    it('returns empty array', () => {
      const data: SystemPromptData = []
      const result = systemPromptFromData(data)
      expect(result).toEqual([])
    })
  })

  describe('when called with unknown block type', () => {
    it('throws error', () => {
      const data = [{ unknownType: { data: 'value' } }] as unknown as SystemPromptData
      expect(() => systemPromptFromData(data)).toThrow('Unknown SystemContentBlockData type')
    })
  })

  describe('when called with class instances', () => {
    it('returns them unchanged', () => {
      const systemPrompt = [new TextBlock('prompt'), new CachePointBlock({ cacheType: 'default' })]
      const result = systemPromptFromData(systemPrompt)
      expect(result).toEqual(systemPrompt)
    })
  })
})
