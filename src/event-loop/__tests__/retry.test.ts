import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ModelRetryStrategy, ExponentialBackoff } from '../retry.js'
import { AfterModelCallEvent, AfterInvocationEvent } from '../../hooks/events.js'
import { ModelThrottledError } from '../../errors.js'
import type { LocalAgent } from '../../types/agent.js'
import { Message, TextBlock } from '../../types/messages.js'

class CustomNetworkError extends Error {
  constructor(message?: string) {
    super(message)
    this.name = 'CustomNetworkError'
  }
}

describe('ModelRetryStrategy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const mockAgent = {} as LocalAgent
  const mockModel = {} as any

  describe('constructor', () => {
    it('sets default values', () => {
      const strategy = new ModelRetryStrategy()
      expect(strategy['_maxAttempts']).toBe(6)
      expect(strategy['_backoff'].initialDelay).toBe(1000)
      expect(strategy['_backoff'].maxDelay).toBe(30000)
      expect(strategy['_retryOn']).toEqual(['ModelThrottledError'])
    })

    it('accepts custom values', () => {
      const strategy = new ModelRetryStrategy({
        maxAttempts: 10,
        backoff: new ExponentialBackoff({ initialDelay: 500, maxDelay: 10000 }),
        retryOn: ['ModelThrottledError', 'CustomNetworkError'],
      })
      expect(strategy['_maxAttempts']).toBe(10)
      expect(strategy['_backoff'].initialDelay).toBe(500)
      expect(strategy['_backoff'].maxDelay).toBe(10000)
      expect(strategy['_retryOn']).toContain('CustomNetworkError')
    })

    it('accepts maxAttempts=1 for no retries', () => {
      const strategy = new ModelRetryStrategy({ maxAttempts: 1 })
      expect(strategy['_maxAttempts']).toBe(1)
    })
  })

  describe('_calculateDelay', () => {
    it('returns initialDelay * 2^attempt for small attempt numbers', () => {
      const strategy = new ModelRetryStrategy({
        backoff: new ExponentialBackoff({ initialDelay: 4000, maxDelay: 240000 }),
      })
      expect(strategy._calculateDelay(0)).toBe(4000)
      expect(strategy._calculateDelay(1)).toBe(8000)
      expect(strategy._calculateDelay(2)).toBe(16000)
      expect(strategy._calculateDelay(3)).toBe(32000)
    })

    it('returns maxDelay when the calculated value exceeds it', () => {
      const strategy = new ModelRetryStrategy({
        backoff: new ExponentialBackoff({ initialDelay: 4000, maxDelay: 60000 }),
      })
      expect(strategy._calculateDelay(0)).toBe(4000)
      expect(strategy._calculateDelay(4)).toBe(60000) // 4000 * 2^4 = 64000 > 60000
      expect(strategy._calculateDelay(5)).toBe(60000)
    })
  })

  describe('handleAfterModelCall', () => {
    it('does not set retry when event.retry is already true', async () => {
      const strategy = new ModelRetryStrategy()
      const event = new AfterModelCallEvent({
        agent: mockAgent,
        model: mockModel,
        error: new ModelThrottledError('test'),
      })
      event.retry = true

      await strategy.handleAfterModelCall(event)
      expect(strategy['_currentAttempt']).toBe(0)
    })

    it('resets state and does not retry on success (stopData present)', async () => {
      const strategy = new ModelRetryStrategy()
      strategy['_currentAttempt'] = 2

      const event = new AfterModelCallEvent({
        agent: mockAgent,
        model: mockModel,
        stopData: {
          stopReason: 'end_turn',
          message: new Message({ role: 'assistant', content: [new TextBlock('test')] }),
        },
      })

      await strategy.handleAfterModelCall(event)
      expect(strategy['_currentAttempt']).toBe(0)
      expect(event.retry).toBeUndefined()
    })

    it('resets state and does not retry when no error', async () => {
      const strategy = new ModelRetryStrategy()
      strategy['_currentAttempt'] = 2

      const event = new AfterModelCallEvent({
        agent: mockAgent,
        model: mockModel,
      })

      await strategy.handleAfterModelCall(event)
      expect(strategy['_currentAttempt']).toBe(0)
      expect(event.retry).toBeUndefined()
    })

    it('does not retry on unlisted exceptions', async () => {
      const strategy = new ModelRetryStrategy()
      const event = new AfterModelCallEvent({
        agent: mockAgent,
        model: mockModel,
        error: new Error('Different error'),
      })

      await strategy.handleAfterModelCall(event)
      expect(strategy['_currentAttempt']).toBe(0)
      expect(event.retry).toBeUndefined()
    })

    it('retries on CustomNetworkError if listed in retryOn config', async () => {
      const strategy = new ModelRetryStrategy({
        backoff: new ExponentialBackoff({ initialDelay: 1000 }),
        retryOn: ['CustomNetworkError'],
      })
      const event = new AfterModelCallEvent({
        agent: mockAgent,
        model: mockModel,
        error: new CustomNetworkError('socket hang up'),
      })

      const promise = strategy.handleAfterModelCall(event)
      expect(strategy['_currentAttempt']).toBe(1)
      await vi.advanceTimersByTimeAsync(1000)
      await promise
      expect(event.retry).toBe(true)
    })

    it('sets retry=true and sleeps on ModelThrottledError', async () => {
      const strategy = new ModelRetryStrategy({ backoff: new ExponentialBackoff({ initialDelay: 4000 }) })
      const event = new AfterModelCallEvent({
        agent: mockAgent,
        model: mockModel,
        error: new ModelThrottledError('throttle'),
      })

      const promise = strategy.handleAfterModelCall(event)

      expect(strategy['_currentAttempt']).toBe(1)

      // Advance timers by 4 seconds
      await vi.advanceTimersByTimeAsync(4000)
      await promise

      expect(event.retry).toBe(true)
    })

    it('increments attempt and doubles delay on subsequent retries', async () => {
      const strategy = new ModelRetryStrategy({ backoff: new ExponentialBackoff({ initialDelay: 4000 }) })

      // Attempt 1 (0 -> 1)
      const event1 = new AfterModelCallEvent({
        agent: mockAgent,
        model: mockModel,
        error: new ModelThrottledError('throttle'),
      })
      const promise1 = strategy.handleAfterModelCall(event1)
      expect(strategy['_currentAttempt']).toBe(1)
      await vi.advanceTimersByTimeAsync(4000)
      await promise1
      expect(event1.retry).toBe(true)

      // Attempt 2 (1 -> 2)
      const event2 = new AfterModelCallEvent({
        agent: mockAgent,
        model: mockModel,
        error: new ModelThrottledError('throttle'),
      })
      const promise2 = strategy.handleAfterModelCall(event2)
      expect(strategy['_currentAttempt']).toBe(2)
      await vi.advanceTimersByTimeAsync(8000)
      await promise2
      expect(event2.retry).toBe(true)
    })

    it('does not retry when max attempts are reached', async () => {
      const strategy = new ModelRetryStrategy({ maxAttempts: 2 })
      strategy['_currentAttempt'] = 1 // Already tried once (1 failed -> attempt=1. The second failure leads attempt=2)

      const event = new AfterModelCallEvent({
        agent: mockAgent,
        model: mockModel,
        error: new ModelThrottledError('throttle'),
      })
      await strategy.handleAfterModelCall(event)

      // Hits maxAttempts
      expect(strategy['_currentAttempt']).toBe(2)
      expect(event.retry).toBeUndefined() // No retry requested
    })
  })

  describe('handleAfterInvocation', () => {
    it('resets currentAttempt to 0', async () => {
      const strategy = new ModelRetryStrategy()
      strategy['_currentAttempt'] = 3

      await strategy.handleAfterInvocation(new AfterInvocationEvent({ agent: mockAgent }))

      expect(strategy['_currentAttempt']).toBe(0)
    })
  })
})
