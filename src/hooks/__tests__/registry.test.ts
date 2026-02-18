import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HookRegistryImplementation } from '../registry.js'
import { AfterInvocationEvent, BeforeInvocationEvent } from '../events.js'
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
      const callback = vi.fn()
      registry.addCallback(callback, BeforeInvocationEvent)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback).toHaveBeenCalledOnce()
    })

    it('registers multiple callbacks for same event type', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      registry.addCallback(callback1, BeforeInvocationEvent)
      registry.addCallback(callback2, BeforeInvocationEvent)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback1).toHaveBeenCalledOnce()
      expect(callback2).toHaveBeenCalledOnce()
    })

    it('registers callbacks for different event types separately', async () => {
      const beforeCallback = vi.fn()
      const afterCallback = vi.fn()

      registry.addCallback(beforeCallback, BeforeInvocationEvent)
      registry.addCallback(afterCallback, AfterInvocationEvent)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(beforeCallback).toHaveBeenCalledOnce()
      expect(afterCallback).not.toHaveBeenCalled()

      await registry.invokeCallbacks(new AfterInvocationEvent({ agent: mockAgent }))

      expect(afterCallback).toHaveBeenCalledOnce()
    })
  })

  describe('addHook', () => {
    it('registers all callbacks from provider', async () => {
      const beforeCallback = vi.fn()
      const afterCallback = vi.fn()

      const provider: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(beforeCallback, BeforeInvocationEvent)
          reg.addCallback(afterCallback, AfterInvocationEvent)
        },
      }

      registry.addHook(provider)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))
      expect(beforeCallback).toHaveBeenCalledOnce()

      await registry.invokeCallbacks(new AfterInvocationEvent({ agent: mockAgent }))
      expect(afterCallback).toHaveBeenCalledOnce()
    })

    it('clears current provider even if registerCallbacks throws', () => {
      const provider: HookProvider = {
        registerCallbacks: () => {
          throw new Error('Provider failed')
        },
      }

      expect(() => registry.addHook(provider)).toThrow('Provider failed')

      // Verify _currentProvider is cleared by registering another provider successfully
      const workingProvider: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(vi.fn(), BeforeInvocationEvent)
        },
      }

      expect(() => registry.addHook(workingProvider)).not.toThrow()
    })
  })

  describe('invokeCallbacks', () => {
    it('calls registered callbacks in order', async () => {
      const callOrder: number[] = []
      const callback1 = vi.fn(() => {
        callOrder.push(1)
      })
      const callback2 = vi.fn(() => {
        callOrder.push(2)
      })

      registry.addCallback(callback1, BeforeInvocationEvent)
      registry.addCallback(callback2, BeforeInvocationEvent)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callOrder).toEqual([1, 2])
    })

    it('reverses callback order for After events', async () => {
      const callOrder: number[] = []
      const callback1 = vi.fn(() => {
        callOrder.push(1)
      })
      const callback2 = vi.fn(() => {
        callOrder.push(2)
      })

      registry.addCallback(callback1, AfterInvocationEvent)
      registry.addCallback(callback2, AfterInvocationEvent)

      await registry.invokeCallbacks(new AfterInvocationEvent({ agent: mockAgent }))

      expect(callOrder).toEqual([2, 1])
    })

    it('awaits async callbacks', async () => {
      let completed = false
      const callback = vi.fn(async (): Promise<void> => {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 10))
        completed = true
      })

      registry.addCallback(callback, BeforeInvocationEvent)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(completed).toBe(true)
    })

    it('propagates callback errors', async () => {
      const callback = vi.fn(() => {
        throw new Error('Hook failed')
      })

      registry.addCallback(callback, BeforeInvocationEvent)

      await expect(registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))).rejects.toThrow(
        'Hook failed'
      )
    })

    it('stops execution on first error', async () => {
      const callback1 = vi.fn(() => {
        throw new Error('First callback failed')
      })
      const callback2 = vi.fn()

      registry.addCallback(callback1, BeforeInvocationEvent)
      registry.addCallback(callback2, BeforeInvocationEvent)

      await expect(registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))).rejects.toThrow(
        'First callback failed'
      )

      expect(callback2).not.toHaveBeenCalled()
    })

    it('handles mixed sync and async callbacks', async () => {
      const callOrder: string[] = []
      const syncCallback = vi.fn(() => {
        callOrder.push('sync')
      })
      const asyncCallback = vi.fn(async (): Promise<void> => {
        await new Promise((resolve) => globalThis.globalThis.setTimeout(resolve, 10))
        callOrder.push('async')
      })

      registry.addCallback(syncCallback, BeforeInvocationEvent)
      registry.addCallback(asyncCallback, BeforeInvocationEvent)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callOrder).toEqual(['sync', 'async'])
    })

    it('returns the event after invocation', async () => {
      const event = new BeforeInvocationEvent({ agent: mockAgent })
      const result = await registry.invokeCallbacks(event)
      expect(result).toBe(event)
    })
  })

  describe('addCallback cleanup function', () => {
    it('returns cleanup function that removes the callback', async () => {
      const callback = vi.fn()

      const cleanup = registry.addCallback(callback, BeforeInvocationEvent)
      cleanup()

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback).not.toHaveBeenCalled()
    })

    it('cleanup function is idempotent', async () => {
      const callback = vi.fn()

      const cleanup = registry.addCallback(callback, BeforeInvocationEvent)
      cleanup()
      cleanup()
      cleanup()

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback).not.toHaveBeenCalled()
    })

    it('cleanup function does not affect other callbacks', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const cleanup1 = registry.addCallback(callback1, BeforeInvocationEvent)
      registry.addCallback(callback2, BeforeInvocationEvent)
      cleanup1()

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledOnce()
    })

    it('cleanup function works with callbacks registered via provider', async () => {
      const callback = vi.fn()

      const provider: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(callback, BeforeInvocationEvent)
        },
      }

      registry.addHook(provider)
      registry.removeHook(provider)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('removeHook', () => {
    it('removes all callbacks registered by provider', async () => {
      const beforeCallback = vi.fn()
      const afterCallback = vi.fn()

      const provider: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(beforeCallback, BeforeInvocationEvent)
          reg.addCallback(afterCallback, AfterInvocationEvent)
        },
      }

      registry.addHook(provider)
      registry.removeHook(provider)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))
      await registry.invokeCallbacks(new AfterInvocationEvent({ agent: mockAgent }))

      expect(beforeCallback).not.toHaveBeenCalled()
      expect(afterCallback).not.toHaveBeenCalled()
    })

    it('removes all instances when provider registered multiple times', async () => {
      const callback = vi.fn()

      const provider: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(callback, BeforeInvocationEvent)
        },
      }

      registry.addHook(provider)
      registry.addHook(provider)
      registry.removeHook(provider)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback).not.toHaveBeenCalled()
    })

    it('is no-op when called with non-existent provider', async () => {
      const callback = vi.fn()

      const provider1: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(callback, BeforeInvocationEvent)
        },
      }

      const provider2: HookProvider = {
        registerCallbacks: () => {},
      }

      registry.addHook(provider1)
      registry.removeHook(provider2)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback).toHaveBeenCalledOnce()
    })

    it('does not affect callbacks from other providers', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const provider1: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(callback1, BeforeInvocationEvent)
        },
      }

      const provider2: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(callback2, BeforeInvocationEvent)
        },
      }

      registry.addHook(provider1)
      registry.addHook(provider2)
      registry.removeHook(provider1)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledOnce()
    })

    it('does not affect callbacks registered without provider', async () => {
      const directCallback = vi.fn()
      const providerCallback = vi.fn()

      const provider: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(providerCallback, BeforeInvocationEvent)
        },
      }

      registry.addCallback(directCallback, BeforeInvocationEvent)
      registry.addHook(provider)
      registry.removeHook(provider)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(directCallback).toHaveBeenCalledOnce()
      expect(providerCallback).not.toHaveBeenCalled()
    })

    it('allows provider to be added and removed multiple times', async () => {
      const callback = vi.fn()

      const provider: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(callback, BeforeInvocationEvent)
        },
      }

      registry.addHook(provider)
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))
      expect(callback).toHaveBeenCalledTimes(1)

      registry.removeHook(provider)
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))
      expect(callback).toHaveBeenCalledTimes(1)

      registry.addHook(provider)
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))
      expect(callback).toHaveBeenCalledTimes(2)
    })
  })

  describe('cleanup function and removeHook work independently', () => {
    it('cleanup function works after removeHook called', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const provider: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(callback1, BeforeInvocationEvent)
          reg.addCallback(callback2, BeforeInvocationEvent)
        },
      }

      registry.addHook(provider)
      registry.removeHook(provider)

      const cleanup = registry.addCallback(callback1, BeforeInvocationEvent)
      registry.addCallback(callback2, BeforeInvocationEvent)
      cleanup()

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledOnce()
    })
  })
})
