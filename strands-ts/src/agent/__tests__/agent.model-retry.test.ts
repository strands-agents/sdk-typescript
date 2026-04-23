// End-to-end wiring test for ModelRetryStrategy on the Agent constructor.
// Uses fake timers so the retry backoff never waits real wall time.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { ModelRetryStrategy } from '../../retry/model-retry-strategy.js'
import { ConstantBackoff } from '../../retry/backoff-strategy.js'
import { ModelThrottledError } from '../../errors.js'
import { AfterModelCallEvent } from '../../hooks/events.js'

describe('Agent modelRetryStrategy wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries model calls that throw ModelThrottledError', async () => {
    const model = new MockMessageModel()
      .addTurn(new ModelThrottledError('rate limited'))
      .addTurn({ type: 'textBlock', text: 'ok' })

    const agent = new Agent({
      model,
      modelRetryStrategy: new ModelRetryStrategy({
        maxAttempts: 3,
        backoff: new ConstantBackoff({ delayMs: 1 }),
      }),
    })

    const invokePromise = agent.invoke('hi')
    // Flush any pending timers the retry scheduled.
    await vi.runAllTimersAsync()
    const result = await invokePromise

    expect(result.lastMessage.content[0]).toEqual({ type: 'textBlock', text: 'ok' })
  })

  it('does not retry non-throttling errors', async () => {
    const model = new MockMessageModel().addTurn(new Error('boom'))

    const agent = new Agent({
      model,
      modelRetryStrategy: new ModelRetryStrategy({
        maxAttempts: 3,
        backoff: new ConstantBackoff({ delayMs: 1 }),
      }),
    })

    const invokePromise = agent.invoke('hi')
    const assertion = expect(invokePromise).rejects.toThrow('boom')
    await vi.runAllTimersAsync()
    await assertion
  })

  it('installs a default ModelRetryStrategy when none is provided', async () => {
    // With no override, two ModelThrottledErrors in a row should still succeed
    // because the defaults allow multiple attempts.
    const model = new MockMessageModel()
      .addTurn(new ModelThrottledError('throttled 1'))
      .addTurn(new ModelThrottledError('throttled 2'))
      .addTurn({ type: 'textBlock', text: 'ok' })

    const agent = new Agent({ model })
    const invokePromise = agent.invoke('hi')
    await vi.runAllTimersAsync()
    const result = await invokePromise

    expect(result.lastMessage.content[0]).toEqual({ type: 'textBlock', text: 'ok' })
  })

  it('gives up once maxAttempts is exceeded', async () => {
    const model = new MockMessageModel()
      .addTurn(new ModelThrottledError('throttled 1'))
      .addTurn(new ModelThrottledError('throttled 2'))
      .addTurn(new ModelThrottledError('throttled 3'))

    const agent = new Agent({
      model,
      modelRetryStrategy: new ModelRetryStrategy({
        maxAttempts: 2,
        backoff: new ConstantBackoff({ delayMs: 1 }),
      }),
    })

    const invokePromise = agent.invoke('hi')
    const assertion = expect(invokePromise).rejects.toThrow(ModelThrottledError)
    await vi.runAllTimersAsync()
    await assertion
  })

  it('disables retries when modelRetryStrategy is null', async () => {
    const model = new MockMessageModel().addTurn(new ModelThrottledError('throttled'))

    const agent = new Agent({ model, modelRetryStrategy: null })

    const invokePromise = agent.invoke('hi')
    const assertion = expect(invokePromise).rejects.toThrow(ModelThrottledError)
    await vi.runAllTimersAsync()
    await assertion
  })

  it('respects a user hook that already set retry=true (no double wait, no double increment)', async () => {
    const model = new MockMessageModel()
      .addTurn(new ModelThrottledError('throttled'))
      .addTurn({ type: 'textBlock', text: 'ok' })

    const strategy = new ModelRetryStrategy({
      maxAttempts: 2, // only 1 retry allowed — if our strategy also incremented, we'd exceed
      backoff: new ConstantBackoff({ delayMs: 10_000 }), // huge delay — if we slept on top, test would time out
    })

    const agent = new Agent({ model, modelRetryStrategy: strategy })
    agent.addHook(AfterModelCallEvent, (event) => {
      if (event.error instanceof ModelThrottledError) {
        event.retry = true
      }
    })

    const invokePromise = agent.invoke('hi')
    await vi.runAllTimersAsync()
    const result = await invokePromise

    expect(result.lastMessage.content[0]).toEqual({ type: 'textBlock', text: 'ok' })
  })

  it('throws if the same instance is attached to two agents', async () => {
    const strategy = new ModelRetryStrategy()

    const agent1 = new Agent({
      model: new MockMessageModel().addTurn({ type: 'textBlock', text: 'ok' }),
      modelRetryStrategy: strategy,
    })
    await agent1.invoke('hi')

    const agent2 = new Agent({
      model: new MockMessageModel().addTurn({ type: 'textBlock', text: 'ok' }),
      modelRetryStrategy: strategy,
    })
    await expect(agent2.invoke('hi')).rejects.toThrow(/already attached to another agent/)
  })
})
