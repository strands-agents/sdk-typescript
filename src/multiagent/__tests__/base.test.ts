import { describe, expect, it } from 'vitest'
import { MultiAgentState } from '../base.js'
import { Status } from '../status.js'

describe('Status', () => {
  it('has all expected enum values', () => {
    expect(Status.PENDING).toBe('PENDING')
    expect(Status.EXECUTING).toBe('EXECUTING')
    expect(Status.COMPLETED).toBe('COMPLETED')
    expect(Status.FAILED).toBe('FAILED')
    expect(Status.CANCELLED).toBe('CANCELLED')
  })

  it('contains exactly five members', () => {
    const values = Object.values(Status)
    expect(values).toHaveLength(5)
  })
})

describe('MultiAgentState', () => {
  it('constructs an empty state', () => {
    const state = new MultiAgentState()
    expect(state).toBeInstanceOf(MultiAgentState)
  })
})
