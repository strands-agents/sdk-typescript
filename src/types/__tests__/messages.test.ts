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

describe('Message.toString', () => {
  it('returns JSON string representation with type, role, and content', () => {
    const message = new Message({
      role: 'user',
      content: [new TextBlock('Hello, world!')],
    })

    const result = message.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('message')
    expect(parsed.role).toBe('user')
    expect(parsed.content).toHaveLength(1)
    expect(parsed.content[0].type).toBe('textBlock')
    expect(parsed.content[0].text).toBe('Hello, world!')
  })

  it('returns valid JSON that can be parsed', () => {
    const message = new Message({
      role: 'assistant',
      content: [new TextBlock('Response'), new TextBlock('More text')],
    })

    const result = message.toString()
    expect(() => JSON.parse(result)).not.toThrow()
  })
})

describe('TextBlock.toString', () => {
  it('returns JSON string representation with type and text', () => {
    const block = new TextBlock('Hello, world!')

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('textBlock')
    expect(parsed.text).toBe('Hello, world!')
  })

  it('returns valid JSON that can be parsed', () => {
    const block = new TextBlock('Test text')

    const result = block.toString()
    expect(() => JSON.parse(result)).not.toThrow()
  })
})

describe('ToolUseBlock.toString', () => {
  it('returns JSON string representation with type, name, toolUseId, and input', () => {
    const block = new ToolUseBlock({
      name: 'get_weather',
      toolUseId: 'tool-123',
      input: { city: 'San Francisco', units: 'celsius' },
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('toolUseBlock')
    expect(parsed.name).toBe('get_weather')
    expect(parsed.toolUseId).toBe('tool-123')
    expect(parsed.input).toEqual({ city: 'San Francisco', units: 'celsius' })
  })

  it('returns valid JSON that can be parsed', () => {
    const block = new ToolUseBlock({
      name: 'test_tool',
      toolUseId: 'id-1',
      input: { param: 'value' },
    })

    const result = block.toString()
    expect(() => JSON.parse(result)).not.toThrow()
  })
})

describe('ToolResultBlock.toString', () => {
  it('returns JSON string representation with type, toolUseId, status, and content', () => {
    const block = new ToolResultBlock({
      toolUseId: 'tool-123',
      status: 'success',
      content: [new TextBlock('Result text')],
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('toolResultBlock')
    expect(parsed.toolUseId).toBe('tool-123')
    expect(parsed.status).toBe('success')
    expect(parsed.content).toHaveLength(1)
  })

  it('handles nested content blocks', () => {
    const block = new ToolResultBlock({
      toolUseId: 'tool-456',
      status: 'success',
      content: [new TextBlock('Text result'), new JsonBlock({ json: { key: 'value' } })],
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.content).toHaveLength(2)
  })

  it('returns valid JSON that can be parsed', () => {
    const block = new ToolResultBlock({
      toolUseId: 'tool-789',
      status: 'error',
      content: [new TextBlock('Error message')],
    })

    const result = block.toString()
    expect(() => JSON.parse(result)).not.toThrow()
  })
})

describe('ReasoningBlock.toString', () => {
  it('returns JSON string representation with type and text', () => {
    const block = new ReasoningBlock({ text: 'Let me think about this...' })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('reasoningBlock')
    expect(parsed.text).toBe('Let me think about this...')
  })

  it('handles optional signature field', () => {
    const block = new ReasoningBlock({
      text: 'Reasoning text',
      signature: 'sig123',
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('reasoningBlock')
    expect(parsed.text).toBe('Reasoning text')
    expect(parsed.signature).toBe('sig123')
  })

  it('handles optional redactedContent field', () => {
    const block = new ReasoningBlock({
      text: 'Public reasoning',
      redactedContent: new Uint8Array([1, 2, 3, 4]),
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('reasoningBlock')
    expect(parsed.text).toBe('Public reasoning')
    expect(parsed.redactedContent).toEqual({ '0': 1, '1': 2, '2': 3, '3': 4 })
  })

  it('omits optional fields when not provided', () => {
    const block = new ReasoningBlock({ text: 'Simple reasoning' })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.signature).toBeUndefined()
    expect(parsed.redactedContent).toBeUndefined()
  })

  it('returns valid JSON that can be parsed', () => {
    const block = new ReasoningBlock({ text: 'Test' })

    const result = block.toString()
    expect(() => JSON.parse(result)).not.toThrow()
  })
})

describe('CachePointBlock.toString', () => {
  it('returns JSON string representation with type and cacheType', () => {
    const block = new CachePointBlock({ cacheType: 'default' })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('cachePointBlock')
    expect(parsed.cacheType).toBe('default')
  })

  it('returns valid JSON that can be parsed', () => {
    const block = new CachePointBlock({ cacheType: 'default' })

    const result = block.toString()
    expect(() => JSON.parse(result)).not.toThrow()
  })
})

describe('JsonBlock.toString', () => {
  it('returns JSON string representation with type and json content', () => {
    const block = new JsonBlock({ json: { key: 'value', nested: { prop: 123 } } })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('jsonBlock')
    expect(parsed.json).toEqual({ key: 'value', nested: { prop: 123 } })
  })

  it('handles array json content', () => {
    const block = new JsonBlock({ json: [1, 2, 3, 'four'] })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('jsonBlock')
    expect(parsed.json).toEqual([1, 2, 3, 'four'])
  })

  it('returns valid JSON that can be parsed', () => {
    const block = new JsonBlock({ json: { test: true } })

    const result = block.toString()
    expect(() => JSON.parse(result)).not.toThrow()
  })
})

describe('GuardContentBlock.toString', () => {
  it('returns JSON string representation with text content', () => {
    const block = new GuardContentBlock({
      text: {
        qualifiers: ['query'],
        text: 'User query text',
      },
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('guardContentBlock')
    expect(parsed.text).toEqual({
      qualifiers: ['query'],
      text: 'User query text',
    })
    expect(parsed.image).toBeUndefined()
  })

  it('returns JSON string representation with image content', () => {
    const block = new GuardContentBlock({
      image: {
        format: 'png',
        source: { bytes: new Uint8Array([1, 2, 3]) },
      },
    })

    const result = block.toString()
    const parsed = JSON.parse(result)

    expect(parsed.type).toBe('guardContentBlock')
    expect(parsed.image).toBeDefined()
    expect(parsed.image.format).toBe('png')
    expect(parsed.text).toBeUndefined()
  })

  it('returns valid JSON that can be parsed', () => {
    const block = new GuardContentBlock({
      text: {
        qualifiers: ['guard_content'],
        text: 'Content to guard',
      },
    })

    const result = block.toString()
    expect(() => JSON.parse(result)).not.toThrow()
  })
})
