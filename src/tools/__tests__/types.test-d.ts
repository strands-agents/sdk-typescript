import { describe, expectTypeOf, test } from 'vitest'
import type { JSONSchema, JSONValue } from '@/types/json'
import type {
  ToolSpec,
  ToolUse,
  ToolResultTextContent,
  ToolResultJsonContent,
  ToolResultContent,
  ToolResultStatus,
  ToolResult,
  ToolChoice,
} from '@/tools/types'

describe('tool type tests', () => {
  test('ToolSpec has correct structure', () => {
    expectTypeOf<ToolSpec>().toMatchTypeOf<{
      name: string
      description: string
      inputSchema: JSONSchema
    }>()
  })

  test('ToolUse has correct structure', () => {
    expectTypeOf<ToolUse>().toMatchTypeOf<{
      name: string
      toolUseId: string
      input: JSONValue
    }>()
  })

  test('ToolResultContent is a discriminated union', () => {
    expectTypeOf<ToolResultContent>().toMatchTypeOf<{ type: string }>()
  })

  test('ToolResultTextContent has correct structure', () => {
    expectTypeOf<ToolResultTextContent>().toEqualTypeOf<{
      type: 'text'
      text: string
    }>()
  })

  test('ToolResultJsonContent has correct structure', () => {
    expectTypeOf<ToolResultJsonContent>().toMatchTypeOf<{
      type: 'json'
      json: JSONValue
    }>()
  })

  test('ToolResultStatus is a literal union', () => {
    expectTypeOf<ToolResultStatus>().toEqualTypeOf<'success' | 'error'>()
  })

  test('ToolResult has correct structure', () => {
    expectTypeOf<ToolResult>().toMatchTypeOf<{
      toolUseId: string
      status: ToolResultStatus
      content: ToolResultContent[]
    }>()
  })

  test('ToolChoice is a union type', () => {
    expectTypeOf<ToolChoice>().toMatchTypeOf<
      { auto: Record<string, never> } | { any: Record<string, never> } | { tool: { name: string } }
    >()
  })
})
