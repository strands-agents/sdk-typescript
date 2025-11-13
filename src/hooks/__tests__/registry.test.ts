import { describe, it, expect, beforeEach } from 'vitest'
import { HookRegistry } from '../registry.js'
import { BeforeInvocationEvent, AfterInvocationEvent } from '../events.js'
import type { HookProvider } from '../types.js'
import { Agent } from '../../agent/agent.js'

describe('HookRegistry', () => {
  let registry: HookRegistry
  let mockAgent: Agent

  beforeEach(() => {
    registry = new HookRegistry()
    mockAgent = new Agent()
  })

  describe('addCallback', () => {
    it('registers callback for event type', () => {
      const callback = (): void => {}
      registry.addCallback(BeforeInvocationEvent, callback)

      const callbacks = registry.getCallbacksFor(new BeforeInvocationEvent({ agent: mockAgent }))
      expect(callbacks).toHaveLength(1)
      expect(callbacks[0]).toBe(callback)
    })

    it('registers multiple callbacks for same event type', () => {
      const callback1 = (): void => {}
      const callback2 = (): void => {}

      registry.addCallback(BeforeInvocationEvent, callback1)
      registry.addCallback(BeforeInvocationEvent, callback2)

      const callbacks = registry.getCallbacksFor(new BeforeInvocationEvent({ agent: mockAgent }))
      expect(callbacks).toHaveLength(2)
      expect(callbacks[0]).toBe(callback1)
      expect(callbacks[1]).toBe(callback2)
    })

    it('registers callbacks for different event types separately', () => {
      const beforeCallback = (): void => {}
      const afterCallback = (): void => {}

      registry.addCallback(BeforeInvocationEvent, beforeCallback)
      registry.addCallback(AfterInvocationEvent, afterCallback)

      const beforeCallbacks = registry.getCallbacksFor(new BeforeInvocationEvent({ agent: mockAgent }))
      const afterCallbacks = registry.getCallbacksFor(new AfterInvocationEvent({ agent: mockAgent }))

      expect(beforeCallbacks).toHaveLength(1)
      expect(beforeCallbacks[0]).toBe(beforeCallback)
      expect(afterCallbacks).toHaveLength(1)
      expect(afterCallbacks[0]).toBe(afterCallback)
    })
  })

  describe('addHook', () => {
    it('registers all callbacks from provider', () => {
      const beforeCallback = (): void => {}
      const afterCallback = (): void => {}

      const provider: HookProvider = {
        registerHooks: (reg: HookRegistry): void => {
          reg.addCallback(BeforeInvocationEvent, beforeCallback)
          reg.addCallback(AfterInvocationEvent, afterCallback)
        },
      }

      registry.addHook(provider)

      const beforeCallbacks = registry.getCallbacksFor(new BeforeInvocationEvent({ agent: mockAgent }))
      const afterCallbacks = registry.getCallbacksFor(new AfterInvocationEvent({ agent: mockAgent }))

      expect(beforeCallbacks).toHaveLength(1)
      expect(beforeCallbacks[0]).toBe(beforeCallback)
      expect(afterCallbacks).toHaveLength(1)
      expect(afterCallbacks[0]).toBe(afterCallback)
    })
  })

  describe('invokeCallbacks', () => {
    it('calls registered callbacks in order', async () => {
      const callOrder: number[] = []
      const callback1 = (): void => {
        callOrder.push(1)
      }
      const callback2 = (): void => {
        callOrder.push(2)
      }

      registry.addCallback(BeforeInvocationEvent, callback1)
      registry.addCallback(BeforeInvocationEvent, callback2)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callOrder).toEqual([1, 2])
    })

    it('reverses callback order for After events', async () => {
      const callOrder: number[] = []
      const callback1 = (): void => {
        callOrder.push(1)
      }
      const callback2 = (): void => {
        callOrder.push(2)
      }

      registry.addCallback(AfterInvocationEvent, callback1)
      registry.addCallback(AfterInvocationEvent, callback2)

      await registry.invokeCallbacks(new AfterInvocationEvent({ agent: mockAgent }))

      expect(callOrder).toEqual([2, 1])
    })

    it('awaits async callbacks', async () => {
      let completed = false
      const callback = async (): Promise<void> => {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 10))
        completed = true
      }

      registry.addCallback(BeforeInvocationEvent, callback)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(completed).toBe(true)
    })

    it('propagates callback errors', async () => {
      const callback = (): void => {
        throw new Error('Hook failed')
      }

      registry.addCallback(BeforeInvocationEvent, callback)

      await expect(registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))).rejects.toThrow(
        'Hook failed'
      )
    })

    it('stops execution on first error', async () => {
      let secondCallbackCalled = false
      const callback1 = (): void => {
        throw new Error('First callback failed')
      }
      const callback2 = (): void => {
        secondCallbackCalled = true
      }

      registry.addCallback(BeforeInvocationEvent, callback1)
      registry.addCallback(BeforeInvocationEvent, callback2)

      await expect(registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))).rejects.toThrow(
        'First callback failed'
      )

      expect(secondCallbackCalled).toBe(false)
    })

    it('handles mixed sync and async callbacks', async () => {
      const callOrder: string[] = []
      const syncCallback = (): void => {
        callOrder.push('sync')
      }
      const asyncCallback = async (): Promise<void> => {
        await new Promise((resolve) => globalThis.globalThis.setTimeout(resolve, 10))
        callOrder.push('async')
      }

      registry.addCallback(BeforeInvocationEvent, syncCallback)
      registry.addCallback(BeforeInvocationEvent, asyncCallback)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callOrder).toEqual(['sync', 'async'])
    })

    it('returns the event after invocation', async () => {
      const event = new BeforeInvocationEvent({ agent: mockAgent })
      const result = await registry.invokeCallbacks(event)
      expect(result).toBe(event)
    })
  })

  describe('hasCallbacks', () => {
    it('returns false when no callbacks registered', () => {
      expect(registry.hasCallbacks()).toBe(false)
    })

    it('returns true when callbacks are registered', () => {
      registry.addCallback(BeforeInvocationEvent, (): void => {})
      expect(registry.hasCallbacks()).toBe(true)
    })
  })

  describe('getCallbacksFor', () => {
    it('returns empty array for unregistered event types', () => {
      const callbacks = registry.getCallbacksFor(new BeforeInvocationEvent({ agent: mockAgent }))
      expect(callbacks).toEqual([])
    })

    it('returns callbacks in registration order for Before events', () => {
      const callback1 = (): void => {}
      const callback2 = (): void => {}

      registry.addCallback(BeforeInvocationEvent, callback1)
      registry.addCallback(BeforeInvocationEvent, callback2)

      const callbacks = registry.getCallbacksFor(new BeforeInvocationEvent({ agent: mockAgent }))
      expect(callbacks).toEqual([callback1, callback2])
    })

    it('returns callbacks in reverse order for After events', () => {
      const callback1 = (): void => {}
      const callback2 = (): void => {}

      registry.addCallback(AfterInvocationEvent, callback1)
      registry.addCallback(AfterInvocationEvent, callback2)

      const callbacks = registry.getCallbacksFor(new AfterInvocationEvent({ agent: mockAgent }))
      expect(callbacks).toEqual([callback2, callback1])
    })
  })
})
