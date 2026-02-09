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
      registry.addCallback(BeforeInvocationEvent, callback)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback).toHaveBeenCalledOnce()
    })

    it('registers multiple callbacks for same event type', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      registry.addCallback(BeforeInvocationEvent, callback1)
      registry.addCallback(BeforeInvocationEvent, callback2)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback1).toHaveBeenCalledOnce()
      expect(callback2).toHaveBeenCalledOnce()
    })

    it('registers callbacks for different event types separately', async () => {
      const beforeCallback = vi.fn()
      const afterCallback = vi.fn()

      registry.addCallback(BeforeInvocationEvent, beforeCallback)
      registry.addCallback(AfterInvocationEvent, afterCallback)

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
          reg.addCallback(BeforeInvocationEvent, beforeCallback)
          reg.addCallback(AfterInvocationEvent, afterCallback)
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
          reg.addCallback(BeforeInvocationEvent, vi.fn())
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

      registry.addCallback(BeforeInvocationEvent, callback1)
      registry.addCallback(BeforeInvocationEvent, callback2)

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

      registry.addCallback(AfterInvocationEvent, callback1)
      registry.addCallback(AfterInvocationEvent, callback2)

      await registry.invokeCallbacks(new AfterInvocationEvent({ agent: mockAgent }))

      expect(callOrder).toEqual([2, 1])
    })

    it('awaits async callbacks', async () => {
      let completed = false
      const callback = vi.fn(async (): Promise<void> => {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 10))
        completed = true
      })

      registry.addCallback(BeforeInvocationEvent, callback)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(completed).toBe(true)
    })

    it('propagates callback errors', async () => {
      const callback = vi.fn(() => {
        throw new Error('Hook failed')
      })

      registry.addCallback(BeforeInvocationEvent, callback)

      await expect(registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))).rejects.toThrow(
        'Hook failed'
      )
    })

    it('stops execution on first error', async () => {
      const callback1 = vi.fn(() => {
        throw new Error('First callback failed')
      })
      const callback2 = vi.fn()

      registry.addCallback(BeforeInvocationEvent, callback1)
      registry.addCallback(BeforeInvocationEvent, callback2)

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

      registry.addCallback(BeforeInvocationEvent, syncCallback)
      registry.addCallback(BeforeInvocationEvent, asyncCallback)

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callOrder).toEqual(['sync', 'async'])
    })

    it('returns the event and empty interrupts after invocation', async () => {
      const event = new BeforeInvocationEvent({ agent: mockAgent })
      const result = await registry.invokeCallbacks(event)
      expect(result.event).toBe(event)
      expect(result.interrupts).toStrictEqual([])
    })
  })

  describe('addCallback cleanup function', () => {
    it('returns cleanup function that removes the callback', async () => {
      const callback = vi.fn()

      const cleanup = registry.addCallback(BeforeInvocationEvent, callback)
      cleanup()

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback).not.toHaveBeenCalled()
    })

    it('cleanup function is idempotent', async () => {
      const callback = vi.fn()

      const cleanup = registry.addCallback(BeforeInvocationEvent, callback)
      cleanup()
      cleanup()
      cleanup()

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback).not.toHaveBeenCalled()
    })

    it('cleanup does not throw when event type was already removed from registry', () => {
      let storedCleanup: (() => void) | undefined
      const provider: HookProvider = {
        registerCallbacks: (reg) => {
          storedCleanup = reg.addCallback(BeforeInvocationEvent, vi.fn())
        },
      }

      registry.addHook(provider)
      registry.removeHook(provider)

      expect(storedCleanup).toBeDefined()
      expect(() => storedCleanup!()).not.toThrow()
    })

    it('cleanup function does not affect other callbacks', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const cleanup1 = registry.addCallback(BeforeInvocationEvent, callback1)
      registry.addCallback(BeforeInvocationEvent, callback2)
      cleanup1()

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledOnce()
    })

    it('cleanup function works with callbacks registered via provider', async () => {
      const callback = vi.fn()

      const provider: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(BeforeInvocationEvent, callback)
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
          reg.addCallback(BeforeInvocationEvent, beforeCallback)
          reg.addCallback(AfterInvocationEvent, afterCallback)
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
          reg.addCallback(BeforeInvocationEvent, callback)
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
          reg.addCallback(BeforeInvocationEvent, callback)
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
          reg.addCallback(BeforeInvocationEvent, callback1)
        },
      }

      const provider2: HookProvider = {
        registerCallbacks: (reg) => {
          reg.addCallback(BeforeInvocationEvent, callback2)
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
          reg.addCallback(BeforeInvocationEvent, providerCallback)
        },
      }

      registry.addCallback(BeforeInvocationEvent, directCallback)
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
          reg.addCallback(BeforeInvocationEvent, callback)
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
          reg.addCallback(BeforeInvocationEvent, callback1)
          reg.addCallback(BeforeInvocationEvent, callback2)
        },
      }

      registry.addHook(provider)
      registry.removeHook(provider)

      const cleanup = registry.addCallback(BeforeInvocationEvent, callback1)
      registry.addCallback(BeforeInvocationEvent, callback2)
      cleanup()

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent: mockAgent }))

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledOnce()
    })
  })
})
