import { describe, expectTypeOf, test } from 'vitest'
import type { JSONValue } from '@/types/json'
import type {
  Role,
  StopReason,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ReasoningBlock,
  ContentBlock,
  Message,
  Messages,
} from '@/types/messages'

describe('message type tests', () => {
  test('Role is a literal union', () => {
    expectTypeOf<Role>().toEqualTypeOf<'user' | 'assistant'>()
  })

  test('StopReason is a literal union', () => {
    expectTypeOf<StopReason>().toEqualTypeOf<
      'contentFiltered' | 'endTurn' | 'guardrailIntervened' | 'maxTokens' | 'stopSequence' | 'toolUse'
    >()
  })

  test('ContentBlock is a discriminated union', () => {
    expectTypeOf<ContentBlock>().toMatchTypeOf<{ type: string }>()
  })

  test('TextBlock has correct structure', () => {
    expectTypeOf<TextBlock>().toEqualTypeOf<{
      type: 'text'
      text: string
    }>()
  })

  test('ToolUseBlock has correct structure', () => {
    expectTypeOf<ToolUseBlock>().toMatchTypeOf<{
      type: 'toolUse'
      name: string
      toolUseId: string
      input: JSONValue
    }>()
  })

  test('ToolResultBlock has correct structure', () => {
    expectTypeOf<ToolResultBlock>().toMatchTypeOf<{
      type: 'toolResult'
      toolUseId: string
      status: 'success' | 'error'
      content: unknown[]
    }>()
  })

  test('ReasoningBlock has correct structure', () => {
    expectTypeOf<ReasoningBlock>().toMatchTypeOf<{
      type: 'reasoning'
      text: string
      signature?: string
    }>()
  })

  test('Message has correct structure', () => {
    expectTypeOf<Message>().toMatchTypeOf<{
      role: Role
      content: ContentBlock[]
    }>()
  })

  test('Messages is an array of Message', () => {
    expectTypeOf<Messages>().toEqualTypeOf<Message[]>()
  })
})
