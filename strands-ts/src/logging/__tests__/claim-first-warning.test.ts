import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('claimFirstWarning', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns true the first time a message is seen', async () => {
    const { claimFirstWarning } = await import('../claim-first-warning.js')
    expect(claimFirstWarning('hello')).toBe(true)
  })

  it('returns false for repeated calls with the same message', async () => {
    const { claimFirstWarning } = await import('../claim-first-warning.js')
    expect(claimFirstWarning('hello')).toBe(true)
    expect(claimFirstWarning('hello')).toBe(false)
    expect(claimFirstWarning('hello')).toBe(false)
  })

  it('tracks distinct messages independently', async () => {
    const { claimFirstWarning } = await import('../claim-first-warning.js')
    expect(claimFirstWarning('alpha')).toBe(true)
    expect(claimFirstWarning('beta')).toBe(true)
    expect(claimFirstWarning('alpha')).toBe(false)
    expect(claimFirstWarning('beta')).toBe(false)
  })
})
