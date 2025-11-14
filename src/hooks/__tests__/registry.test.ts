import { describe, it, expect, beforeEach } from 'vitest'
import { HookRegistryImplementation } from '../registry.js'
import { BeforeInvocationEvent, AfterInvocationEvent } from '../events.js'
import type { HookProvider } from '../types.js'
import { Agent } from '../../agent/agent.js'

describe('HookRegistryImplementation', () => {
  let registry: HookRegistryImplementation
  let mockAgent: Agent

  beforeEach(() => {
    registry = new HookRegistryImplementation()
    mockAgent = new Agent()
  })

  describe('addCallback', () => {
    it('registers callback for event type', async () => {
      let called = false
      const callback = (): void => {
        called = true
      }
      registry.addCallback(BeforeInvocationEvent, callback)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(called).toBe(true)
    })

    it('registers multiple callbacks for same event type', async () => {
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

    it('registers callbacks for different event types separately', async () => {
      let beforeCalled = false
      let afterCalled = false
      const beforeCallback = (): void => {
        beforeCalled = true
      }
      const afterCallback = (): void => {
        afterCalled = true
      }

      registry.addCallback(BeforeInvocationEvent, beforeCallback)
      registry.addCallback(AfterInvocationEvent, afterCallback)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(beforeCalled).toBe(true)
      expect(afterCalled).toBe(false)

      await registry.invokeCallbacks(new AfterInvocationEvent({ agent: mockAgent }))

      expect(afterCalled).toBe(true)
    })
  })

  describe('addHook', () => {
    it('registers all callbacks from provider', async () => {
      let beforeCalled = false
      let afterCalled = false
      const beforeCallback = (): void => {
        beforeCalled = true
      }
      const afterCallback = (): void => {
        afterCalled = true
      }

      const provider: HookProvider = {
        getHooks: () => [
          { event: BeforeInvocationEvent, callback: beforeCallback },
          { event: AfterInvocationEvent, callback: afterCallback },
        ],
      }

      registry.addHook(provider)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))
      expect(beforeCalled).toBe(true)

      await registry.invokeCallbacks(new AfterInvocationEvent({ agent: mockAgent }))
      expect(afterCalled).toBe(true)
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
})
