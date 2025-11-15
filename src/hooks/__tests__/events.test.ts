import { describe, it, expect } from 'vitest'
import { BeforeInvocationEvent, AfterInvocationEvent } from '../events.js'
import { Agent } from '../../agent/agent.js'

describe('BeforeInvocationEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const event = new BeforeInvocationEvent({ agent })

    expect(event.agent).toBe(agent)
    expect(event.type).toBe('beforeInvocationEvent')
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
  })
})

describe('AfterInvocationEvent', () => {
  it('creates instance with correct properties', () => {
    const agent = new Agent()
    const event = new AfterInvocationEvent({ agent })

    expect(event.agent).toBe(agent)
    expect(event.type).toBe('afterInvocationEvent')
    // @ts-expect-error verifying that property is readonly
    event.agent = new Agent()
  })
})
