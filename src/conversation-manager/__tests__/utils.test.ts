import { describe, it, expect } from 'vitest'
import { findValidSplitPoint } from '../utils.js'
import { Message, TextBlock, ToolUseBlock, ToolResultBlock } from '../../index.js'

function textMsg(role: 'user' | 'assistant', text: string): Message {
  return new Message({ role, content: [new TextBlock(text)] })
}

function toolUseMsg(): Message {
  return new Message({
    role: 'assistant',
    content: [new ToolUseBlock({ toolUseId: 'tool-1', name: 'test', input: {} })],
  })
}

function toolResultMsg(): Message {
  return new Message({
    role: 'user',
    content: [new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('result')] })],
  })
}

describe('findValidSplitPoint', () => {
  it('returns the initial split point when it is already valid', () => {
    const messages = [textMsg('user', 'a'), textMsg('assistant', 'b'), textMsg('user', 'c')]
    expect(findValidSplitPoint(messages, 1)).toBe(1)
  })

  it('skips past a toolResultBlock at the split point', () => {
    const messages = [toolUseMsg(), toolResultMsg(), textMsg('user', 'next')]
    expect(findValidSplitPoint(messages, 1)).toBe(2)
  })

  it('skips a toolUseBlock when next message is NOT a toolResult', () => {
    const messages = [textMsg('user', 'a'), toolUseMsg(), textMsg('user', 'next')]
    expect(findValidSplitPoint(messages, 1)).toBe(2)
  })

  it('keeps toolUseBlock when next message IS a toolResult', () => {
    const messages = [textMsg('user', 'a'), toolUseMsg(), toolResultMsg(), textMsg('user', 'next')]
    expect(findValidSplitPoint(messages, 1)).toBe(1)
  })

  it('returns -1 when no valid split point exists', () => {
    const messages = [toolUseMsg(), toolResultMsg()]
    expect(findValidSplitPoint(messages, 1)).toBe(-1)
  })

  it('returns the split point at the boundary', () => {
    const messages = [textMsg('user', 'a')]
    expect(findValidSplitPoint(messages, 0)).toBe(0)
  })
})
