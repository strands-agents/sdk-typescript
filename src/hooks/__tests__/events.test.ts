import { describe, it, expect } from 'vitest'
import { BeforeInvocationEvent, AfterInvocationEvent } from '../events.js'
import { Agent } from '../../agent/agent.js'

describe('BeforeInvocationEvent', () => {
  it('creates instance with agent parameter', () => {
    const agent = new Agent()
    const event = new BeforeInvocationEvent({ agent })

    expect(event.agent).toBe(agent)
  })

  it('has correct type discriminator', () => {
    const agent = new Agent()
    const event = new BeforeInvocationEvent({ agent })

    expect(event.type).toBe('beforeInvocationEvent')
  })

  it('shouldReverseCallbacks returns false', () => {
    const agent = new Agent()
    const event = new BeforeInvocationEvent({ agent })

    expect(event.shouldReverseCallbacks).toBe(false)
  })

  it('agent property is readonly', () => {
    const agent = new Agent()
    const event = new BeforeInvocationEvent({ agent })

    // TypeScript compile-time check - this should fail if uncommented
    // event.agent = new Agent()

    expect(event.agent).toBe(agent)
  })
})

describe('AfterInvocationEvent', () => {
  it('creates instance with agent parameter', () => {
    const agent = new Agent()
    const event = new AfterInvocationEvent({ agent })

    expect(event.agent).toBe(agent)
  })

  it('has correct type discriminator', () => {
    const agent = new Agent()
    const event = new AfterInvocationEvent({ agent })

    expect(event.type).toBe('afterInvocationEvent')
  })

  it('shouldReverseCallbacks returns true', () => {
    const agent = new Agent()
    const event = new AfterInvocationEvent({ agent })

    expect(event.shouldReverseCallbacks).toBe(true)
  })

  it('agent property is readonly', () => {
    const agent = new Agent()
    const event = new AfterInvocationEvent({ agent })

    // TypeScript compile-time check - this should fail if uncommented
    // event.agent = new Agent()

    expect(event.agent).toBe(agent)
  })
})
