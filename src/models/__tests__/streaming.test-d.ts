import { describe, expectTypeOf, test } from 'vitest'
import type { StopReason } from '@/types/messages'
import type {
  Usage,
  Metrics,
  ModelMessageStartEvent,
  ToolUseStart,
  ContentBlockStart,
  ModelContentBlockStartEvent,
  TextDelta,
  ToolUseInputDelta,
  ReasoningDelta,
  ContentBlockDelta,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStopEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
  ModelProviderStreamEvent,
} from '@/models/streaming'

describe('streaming event type tests', () => {
  test('ModelProviderStreamEvent is a discriminated union', () => {
    expectTypeOf<ModelProviderStreamEvent>().toMatchTypeOf<{ type: string }>()
  })

  test('ModelMessageStartEvent has correct structure', () => {
    expectTypeOf<ModelMessageStartEvent>().toEqualTypeOf<{
      type: 'modelMessageStartEvent'
      role: 'user' | 'assistant'
    }>()
  })

  test('ModelContentBlockStartEvent has correct structure', () => {
    expectTypeOf<ModelContentBlockStartEvent>().toMatchTypeOf<{
      type: 'modelContentBlockStartEvent'
      contentBlockIndex?: number
      start?: ToolUseStart
    }>()
  })

  test('ModelContentBlockDeltaEvent has correct structure', () => {
    expectTypeOf<ModelContentBlockDeltaEvent>().toMatchTypeOf<{
      type: 'modelContentBlockDeltaEvent'
      contentBlockIndex?: number
      delta: ContentBlockDelta
    }>()
  })

  test('ModelContentBlockStopEvent has correct structure', () => {
    expectTypeOf<ModelContentBlockStopEvent>().toMatchTypeOf<{
      type: 'modelContentBlockStopEvent'
      contentBlockIndex?: number
    }>()
  })

  test('ModelMessageStopEvent has correct structure', () => {
    expectTypeOf<ModelMessageStopEvent>().toMatchTypeOf<{
      type: 'modelMessageStopEvent'
      stopReason?: StopReason
      additionalModelResponseFields?: unknown
    }>()
  })

  test('ModelMetadataEvent has correct structure', () => {
    expectTypeOf<ModelMetadataEvent>().toMatchTypeOf<{
      type: 'modelMetadataEvent'
      usage?: Usage
      metrics?: Metrics
      trace?: unknown
    }>()
  })

  test('ContentBlockDelta is a discriminated union', () => {
    expectTypeOf<ContentBlockDelta>().toMatchTypeOf<{ type: string }>()
  })

  test('TextDelta has correct structure', () => {
    expectTypeOf<TextDelta>().toEqualTypeOf<{
      type: 'text'
      text: string
    }>()
  })

  test('ToolUseInputDelta has correct structure', () => {
    expectTypeOf<ToolUseInputDelta>().toEqualTypeOf<{
      type: 'toolUseInput'
      input: string
    }>()
  })

  test('ReasoningDelta has correct structure', () => {
    expectTypeOf<ReasoningDelta>().toMatchTypeOf<{
      type: 'reasoning'
      text?: string
      signature?: string
    }>()
  })

  test('ContentBlockStart is ToolUseStart', () => {
    expectTypeOf<ContentBlockStart>().toEqualTypeOf<ToolUseStart>()
  })

  test('ToolUseStart has correct structure', () => {
    expectTypeOf<ToolUseStart>().toEqualTypeOf<{
      type: 'toolUse'
      name: string
      toolUseId: string
    }>()
  })

  test('Usage interface has correct structure', () => {
    expectTypeOf<Usage>().toMatchTypeOf<{
      inputTokens: number
      outputTokens: number
      totalTokens: number
      cacheReadInputTokens?: number
      cacheWriteInputTokens?: number
    }>()
  })

  test('Metrics interface has correct structure', () => {
    expectTypeOf<Metrics>().toEqualTypeOf<{
      latencyMs: number
    }>()
  })
})
