// Tests use vi.useFakeTimers() so the internal `await sleep(...)` never waits
// real wall time — timers are advanced manually with vi.advanceTimersByTimeAsync.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ModelRetryStrategy } from '../model-retry-strategy.js'
import { RetryStrategy } from '../retry-strategy.js'
import { ConstantBackoff, type BackoffStrategy } from '../backoff-strategy.js'
import { AfterInvocationEvent, AfterModelCallEvent } from '../../hooks/events.js'
import { ModelThrottledError } from '../../errors.js'
import { createMockAgent, invokeTrackedHook, type MockAgent } from '../../__fixtures__/agent-helpers.js'

function makeErrorEvent(agent: MockAgent, error: Error): AfterModelCallEvent {
  return new AfterModelCallEvent({ agent, model: {} as never, error })
}

function makeSuccessEvent(agent: MockAgent): AfterModelCallEvent {
  return new AfterModelCallEvent({
    agent,
    model: {} as never,
    stopData: { message: {} as never, stopReason: 'endTurn' },
  })
}

describe('ModelRetryStrategy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers AfterModelCallEvent and AfterInvocationEvent hooks', () => {
    const strategy = new ModelRetryStrategy()
    const agent = createMockAgent()
    strategy.initAgent(agent)
    const types = agent.trackedHooks.map((h) => h.eventType)
    expect(types).toContain(AfterModelCallEvent)
    expect(types).toContain(AfterInvocationEvent)
  })

  it('exposes the plugin name', () => {
    expect(new ModelRetryStrategy().name).toBe('strands:model-retry-strategy')
  })

  it('is a RetryStrategy', () => {
    expect(new ModelRetryStrategy()).toBeInstanceOf(RetryStrategy)
  })

  it('rejects maxAttempts below 1', () => {
    expect(() => new ModelRetryStrategy({ maxAttempts: 0 })).toThrow(/maxAttempts/)
  })

  it('sets retry=true on ModelThrottledError and sleeps for the configured delay', async () => {
    const strategy = new ModelRetryStrategy({
      maxAttempts: 3,
      backoff: new ConstantBackoff({ delayMs: 500 }),
    })
    const agent = createMockAgent()
    strategy.initAgent(agent)

    const event = makeErrorEvent(agent, new ModelThrottledError('rate limited'))
    const pending = invokeTrackedHook(agent, event)

    // Before the timer advances, the hook is still awaiting sleep — retry not yet set.
    await vi.advanceTimersByTimeAsync(499)
    expect(event.retry).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(event.retry).toBe(true)
  })

  it('does not retry non-retryable errors', async () => {
    const strategy = new ModelRetryStrategy({
      backoff: new ConstantBackoff({ delayMs: 10 }),
    })
    const agent = createMockAgent()
    strategy.initAgent(agent)

    const event = makeErrorEvent(agent, new Error('boom'))
    await invokeTrackedHook(agent, event)
    expect(event.retry).toBeUndefined()
  })

  it('stops retrying once maxAttempts is reached', async () => {
    const strategy = new ModelRetryStrategy({
      maxAttempts: 3,
      backoff: new ConstantBackoff({ delayMs: 1 }),
    })
    const agent = createMockAgent()
    strategy.initAgent(agent)

    // Attempt 1 → retry
    const e1 = makeErrorEvent(agent, new ModelThrottledError('x'))
    const p1 = invokeTrackedHook(agent, e1)
    await vi.advanceTimersByTimeAsync(1)
    await p1
    expect(e1.retry).toBe(true)

    // Attempt 2 → retry
    const e2 = makeErrorEvent(agent, new ModelThrottledError('x'))
    const p2 = invokeTrackedHook(agent, e2)
    await vi.advanceTimersByTimeAsync(1)
    await p2
    expect(e2.retry).toBe(true)

    // Attempt 3 → exceeds max, should not retry
    const e3 = makeErrorEvent(agent, new ModelThrottledError('x'))
    await invokeTrackedHook(agent, e3)
    expect(e3.retry).toBeUndefined()
  })

  it('skips work if another hook already requested retry', async () => {
    const strategy = new ModelRetryStrategy({
      maxAttempts: 5,
      backoff: new ConstantBackoff({ delayMs: 1000 }),
    })
    const agent = createMockAgent()
    strategy.initAgent(agent)

    const event = makeErrorEvent(agent, new ModelThrottledError('x'))
    event.retry = true

    // Should return immediately with no sleep — if it tried to sleep we'd see
    // hung test state; resolving without advancing timers proves the skip.
    await invokeTrackedHook(agent, event)
    expect(event.retry).toBe(true)
  })

  it('resets state after a successful model call', async () => {
    const strategy = new ModelRetryStrategy({
      maxAttempts: 2,
      backoff: new ConstantBackoff({ delayMs: 1 }),
    })
    const agent = createMockAgent()
    strategy.initAgent(agent)

    // Fail once — currentAttempt becomes 1
    const e1 = makeErrorEvent(agent, new ModelThrottledError('x'))
    const p1 = invokeTrackedHook(agent, e1)
    await vi.advanceTimersByTimeAsync(1)
    await p1
    expect(e1.retry).toBe(true)

    // Success — should reset the counter
    const ok = makeSuccessEvent(agent)
    await invokeTrackedHook(agent, ok)

    // Next failure should still retry (counter was reset, so we're back at attempt 1)
    const e2 = makeErrorEvent(agent, new ModelThrottledError('x'))
    const p2 = invokeTrackedHook(agent, e2)
    await vi.advanceTimersByTimeAsync(1)
    await p2
    expect(e2.retry).toBe(true)
  })

  it('resets state on AfterInvocationEvent', async () => {
    const strategy = new ModelRetryStrategy({
      maxAttempts: 2,
      backoff: new ConstantBackoff({ delayMs: 1 }),
    })
    const agent = createMockAgent()
    strategy.initAgent(agent)

    // Fail once → counter = 1
    const e1 = makeErrorEvent(agent, new ModelThrottledError('x'))
    const p1 = invokeTrackedHook(agent, e1)
    await vi.advanceTimersByTimeAsync(1)
    await p1

    // Invocation ends → counter reset
    await invokeTrackedHook(agent, new AfterInvocationEvent({ agent }))

    // Next invocation's first failure should retry (would not if counter was 1 with maxAttempts=2)
    const e2 = makeErrorEvent(agent, new ModelThrottledError('x'))
    const p2 = invokeTrackedHook(agent, e2)
    await vi.advanceTimersByTimeAsync(1)
    await p2
    expect(e2.retry).toBe(true)
  })

  it('passes BackoffContext with attempt and lastDelayMs to the backoff strategy', async () => {
    const nextDelay = vi.fn<BackoffStrategy['nextDelay']>().mockReturnValue(5)
    const backoff: BackoffStrategy = { nextDelay }
    const strategy = new ModelRetryStrategy({ maxAttempts: 5, backoff })
    const agent = createMockAgent()
    strategy.initAgent(agent)

    const e1 = makeErrorEvent(agent, new ModelThrottledError('x'))
    const p1 = invokeTrackedHook(agent, e1)
    await vi.advanceTimersByTimeAsync(5)
    await p1

    expect(nextDelay).toHaveBeenCalledTimes(1)
    expect(nextDelay.mock.calls[0]![0]).toEqual({
      attempt: 1,
      elapsedMs: expect.any(Number),
    })

    const e2 = makeErrorEvent(agent, new ModelThrottledError('x'))
    const p2 = invokeTrackedHook(agent, e2)
    await vi.advanceTimersByTimeAsync(5)
    await p2

    expect(nextDelay).toHaveBeenCalledTimes(2)
    expect(nextDelay.mock.calls[1]![0]).toEqual({
      attempt: 2,
      elapsedMs: expect.any(Number),
      lastDelayMs: 5,
    })
  })
})
