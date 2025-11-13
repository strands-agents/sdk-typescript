import { describe, expect, test } from 'vitest'
import {
  Message,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ReasoningBlock,
  CachePointBlock,
  JsonBlock,
  GuardContentBlock,
} from '../messages.js'

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

describe('GuardContentBlock', () => {
  test('creates guard content block with single qualifier', () => {
    const block = new GuardContentBlock({
      text: {
        qualifiers: ['grounding_source'],
        text: 'This content should be evaluated for grounding.',
      },
    })

    expect(block).toEqual({
      type: 'guardContentBlock',
      text: {
        qualifiers: ['grounding_source'],
        text: 'This content should be evaluated for grounding.',
      },
    })
  })

  test('creates guard content block with all qualifier types', () => {
    const block = new GuardContentBlock({
      text: {
        qualifiers: ['grounding_source', 'query', 'guard_content'],
        text: 'Test content',
      },
    })

    expect(block).toEqual({
      type: 'guardContentBlock',
      text: {
        qualifiers: ['grounding_source', 'query', 'guard_content'],
        text: 'Test content',
      },
    })
  })

  test('creates guard content block with image (bytes)', () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4])
    const block = new GuardContentBlock({
      image: {
        format: 'jpeg',
        source: { bytes: imageBytes },
      },
    })

    expect(block).toEqual({
      type: 'guardContentBlock',
      image: {
        format: 'jpeg',
        source: { bytes: imageBytes },
      },
    })
  })

  test('throws error when neither text nor image is provided', () => {
    expect(() => new GuardContentBlock({} as any)).toThrow('GuardContentBlock must have either text or image content')
  })

  test('throws error when both text and image are provided', () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4])
    expect(
      () =>
        new GuardContentBlock({
          text: {
            qualifiers: ['grounding_source'],
            text: 'Test',
          },
          image: {
            format: 'jpeg',
            source: { bytes: imageBytes },
          },
        })
    ).toThrow('GuardContentBlock cannot have both text and image content')
  })
})
