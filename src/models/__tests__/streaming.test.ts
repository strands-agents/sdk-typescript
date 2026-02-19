import { describe, it, expect } from 'vitest'
import { createEmptyUsage, accumulateUsage, type Usage } from '../streaming.js'

describe('createEmptyUsage', () => {
  it('returns a Usage object with all counters at zero', () => {
    expect(createEmptyUsage()).toStrictEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    })
  })

  it('returns independent instances', () => {
    const a = createEmptyUsage()
    const b = createEmptyUsage()
    a.inputTokens = 99

    expect(b.inputTokens).toBe(0)
  })
})

describe('accumulateUsage', () => {
  it('accumulates basic token counts', () => {
    const target = createEmptyUsage()
    const source: Usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }

    accumulateUsage(target, source)

    expect(target).toStrictEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    })
  })

  it('accumulates across multiple calls', () => {
    const target = createEmptyUsage()

    accumulateUsage(target, { inputTokens: 10, outputTokens: 5, totalTokens: 15 })
    accumulateUsage(target, { inputTokens: 20, outputTokens: 10, totalTokens: 30 })

    expect(target).toStrictEqual({
      inputTokens: 30,
      outputTokens: 15,
      totalTokens: 45,
    })
  })

  it('accumulates cache token counts when present in source', () => {
    const target = createEmptyUsage()
    const source: Usage = {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadInputTokens: 3,
      cacheWriteInputTokens: 2,
    }

    accumulateUsage(target, source)

    expect(target).toStrictEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadInputTokens: 3,
      cacheWriteInputTokens: 2,
    })
  })

  it('accumulates cache tokens across multiple calls', () => {
    const target = createEmptyUsage()

    accumulateUsage(target, {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadInputTokens: 3,
    })
    accumulateUsage(target, {
      inputTokens: 5,
      outputTokens: 2,
      totalTokens: 7,
      cacheReadInputTokens: 4,
    })

    expect(target).toStrictEqual({
      inputTokens: 15,
      outputTokens: 7,
      totalTokens: 22,
      cacheReadInputTokens: 7,
    })
  })

  it('does not add cache fields when source has no cache tokens', () => {
    const target = createEmptyUsage()
    const source: Usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }

    accumulateUsage(target, source)

    expect(target).not.toHaveProperty('cacheReadInputTokens')
    expect(target).not.toHaveProperty('cacheWriteInputTokens')
  })
})
