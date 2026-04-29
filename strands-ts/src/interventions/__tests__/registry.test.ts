import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InterventionRegistry, type AuditRecord } from '../registry.js'
import { InterventionHandler } from '../handler.js'
import { HookRegistryImplementation } from '../../hooks/registry.js'
import { Agent } from '../../agent/agent.js'
import {
  BeforeInvocationEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
} from '../../hooks/events.js'
import { Message, TextBlock, ToolResultBlock } from '../../types/messages.js'
import type { InterventionAction } from '../actions.js'

class DenyHandler extends InterventionHandler {
  readonly name = 'deny-handler'

  override beforeToolCall(): InterventionAction {
    return { type: 'deny', reason: 'not authorized' }
  }
}

class GuideHandler extends InterventionHandler {
  readonly name = 'guide-handler'

  override beforeToolCall(): InterventionAction {
    return { type: 'guide', feedback: 'add more context' }
  }
}

class InterruptHandler extends InterventionHandler {
  readonly name = 'interrupt-handler'

  override beforeToolCall(): InterventionAction {
    return { type: 'interrupt', prompt: 'approve this action?' }
  }
}

class ProceedHandler extends InterventionHandler {
  readonly name = 'proceed-handler'

  override beforeToolCall(): InterventionAction {
    return { type: 'proceed', reason: 'all good' }
  }
}

class ThrowingHandler extends InterventionHandler {
  readonly name = 'throwing-handler'
  override readonly onError = 'throw' as const

  override beforeToolCall(): InterventionAction {
    throw new Error('handler crashed')
  }
}

class ThrowingProceedHandler extends InterventionHandler {
  readonly name = 'throwing-proceed'
  override readonly onError = 'proceed' as const

  override beforeToolCall(): InterventionAction {
    throw new Error('handler crashed')
  }
}

class ThrowingDenyHandler extends InterventionHandler {
  readonly name = 'throwing-deny'
  override readonly onError = 'deny' as const

  override beforeToolCall(): InterventionAction {
    throw new Error('handler crashed')
  }
}

class AsyncDenyHandler extends InterventionHandler {
  readonly name = 'async-deny'

  override async beforeToolCall(): Promise<InterventionAction> {
    return { type: 'deny', reason: 'async denial' }
  }
}

class ModelGuideHandler extends InterventionHandler {
  readonly name = 'model-guide'

  override afterModelCall(): InterventionAction {
    return { type: 'guide', feedback: 'be more specific' }
  }
}

describe('InterventionRegistry', () => {
  let hookRegistry: HookRegistryImplementation
  let agent: Agent
  const toolUse = { name: 'testTool', toolUseId: 'id-1', input: {} }

  beforeEach(() => {
    hookRegistry = new HookRegistryImplementation()
    agent = new Agent()
  })

  function makeBeforeInvocationEvent() {
    return new BeforeInvocationEvent({ agent, invocationState: {} })
  }

  function makeBeforeToolCallEvent() {
    return new BeforeToolCallEvent({ agent, toolUse, tool: undefined, invocationState: {} })
  }

  function makeAfterToolCallEvent() {
    return new AfterToolCallEvent({
      agent,
      toolUse,
      tool: undefined,
      result: new ToolResultBlock({ toolUseId: 'id-1', status: 'success', content: [new TextBlock('ok')] }),
      invocationState: {},
    })
  }

  function makeBeforeModelCallEvent() {
    return new BeforeModelCallEvent({ agent, model: {} as never, invocationState: {} })
  }

  function makeAfterModelCallEvent() {
    return new AfterModelCallEvent({
      agent,
      model: {} as never,
      invocationState: {},
      stopData: {
        message: new Message({ role: 'assistant', content: [new TextBlock('response')] }),
        stopReason: 'endTurn',
      },
    })
  }

  describe('constructor', () => {
    it('rejects duplicate handler names', () => {
      expect(() => new InterventionRegistry([new DenyHandler(), new DenyHandler()], hookRegistry)).toThrow(
        "Duplicate intervention handler name: 'deny-handler'"
      )
    })

    it('accepts handlers with unique names', () => {
      const registry = new InterventionRegistry([new DenyHandler(), new GuideHandler()], hookRegistry)
      expect(registry.handlers).toHaveLength(2)
    })
  })

  describe('hook registration', () => {
    it('only registers hooks for overridden methods', async () => {
      new InterventionRegistry([new DenyHandler()], hookRegistry)

      const beforeToolEvent = makeBeforeToolCallEvent()
      await hookRegistry.invokeCallbacks(beforeToolEvent)
      expect(beforeToolEvent.cancel).toBe('DENIED: not authorized')

      // afterModelCall should not be registered — no handler overrides it
      const afterModelEvent = makeAfterModelCallEvent()
      await hookRegistry.invokeCallbacks(afterModelEvent)
      expect(afterModelEvent.retry).toBeUndefined()
    })
  })

  describe('dispatch ordering', () => {
    it('calls handlers in registration order', async () => {
      const callOrder: string[] = []

      class First extends InterventionHandler {
        readonly name = 'first'
        override beforeToolCall(): InterventionAction {
          callOrder.push('first')
          return { type: 'proceed' }
        }
      }
      class Second extends InterventionHandler {
        readonly name = 'second'
        override beforeToolCall(): InterventionAction {
          callOrder.push('second')
          return { type: 'proceed' }
        }
      }

      new InterventionRegistry([new First(), new Second()], hookRegistry)

      await hookRegistry.invokeCallbacks(makeBeforeToolCallEvent())
      expect(callOrder).toEqual(['first', 'second'])
    })

    it('skips handlers that do not override the method', async () => {
      const callOrder: string[] = []

      class ToolHandler extends InterventionHandler {
        readonly name = 'tool'
        override beforeToolCall(): InterventionAction {
          callOrder.push('tool')
          return { type: 'proceed' }
        }
      }
      class ModelHandler extends InterventionHandler {
        readonly name = 'model'
        override afterModelCall(): InterventionAction {
          callOrder.push('model')
          return { type: 'proceed' }
        }
      }

      new InterventionRegistry([new ToolHandler(), new ModelHandler()], hookRegistry)

      await hookRegistry.invokeCallbacks(makeBeforeToolCallEvent())
      expect(callOrder).toEqual(['tool'])
    })
  })

  describe('deny', () => {
    it('sets cancel on BeforeToolCallEvent', async () => {
      new InterventionRegistry([new DenyHandler()], hookRegistry)

      const event = makeBeforeToolCallEvent()
      await hookRegistry.invokeCallbacks(event)

      expect(event.cancel).toBe('DENIED: not authorized')
    })

    it('short-circuits — later handlers do not run', async () => {
      const laterCalled = vi.fn()

      class LaterHandler extends InterventionHandler {
        readonly name = 'later'
        override beforeToolCall(): InterventionAction {
          laterCalled()
          return { type: 'proceed' }
        }
      }

      new InterventionRegistry([new DenyHandler(), new LaterHandler()], hookRegistry)

      await hookRegistry.invokeCallbacks(makeBeforeToolCallEvent())
      expect(laterCalled).not.toHaveBeenCalled()
    })

    it('sets cancel on BeforeInvocationEvent', async () => {
      class InvocationDeny extends InterventionHandler {
        readonly name = 'invocation-deny'
        override beforeInvocation(): InterventionAction {
          return { type: 'deny', reason: 'unauthorized user' }
        }
      }

      new InterventionRegistry([new InvocationDeny()], hookRegistry)

      const event = makeBeforeInvocationEvent()
      await hookRegistry.invokeCallbacks(event)
      expect(event.cancel).toBe('DENIED: unauthorized user')
    })

    it('sets cancel on BeforeModelCallEvent', async () => {
      class ModelDeny extends InterventionHandler {
        readonly name = 'model-deny'
        override beforeModelCall(): InterventionAction {
          return { type: 'deny', reason: 'prompt injection detected' }
        }
      }

      new InterventionRegistry([new ModelDeny()], hookRegistry)

      const event = makeBeforeModelCallEvent()
      await hookRegistry.invokeCallbacks(event)
      expect(event.cancel).toBe('DENIED: prompt injection detected')
    })

    it('has no effect on AfterToolCallEvent (tool already ran)', async () => {
      class AfterToolDeny extends InterventionHandler {
        readonly name = 'after-tool-deny'
        override afterToolCall(): InterventionAction {
          return { type: 'deny', reason: 'unsafe output' }
        }
      }

      new InterventionRegistry([new AfterToolDeny()], hookRegistry)

      const event = makeAfterToolCallEvent()
      await hookRegistry.invokeCallbacks(event)
      expect(event.retry).toBeUndefined()
    })
  })

  describe('guide', () => {
    it('sets cancel with guidance on BeforeToolCallEvent', async () => {
      new InterventionRegistry([new GuideHandler()], hookRegistry)

      const event = makeBeforeToolCallEvent()
      await hookRegistry.invokeCallbacks(event)
      expect(event.cancel).toBe('GUIDANCE: [guide-handler] add more context')
    })

    it('accumulates feedback from multiple handlers', async () => {
      class SecondGuide extends InterventionHandler {
        readonly name = 'second-guide'
        override beforeToolCall(): InterventionAction {
          return { type: 'guide', feedback: 'also check permissions' }
        }
      }

      new InterventionRegistry([new GuideHandler(), new SecondGuide()], hookRegistry)

      const event = makeBeforeToolCallEvent()
      await hookRegistry.invokeCallbacks(event)
      expect(event.cancel).toBe('GUIDANCE: [guide-handler] add more context\n[second-guide] also check permissions')
    })

    it('sets retry=true and injects guidance message on AfterModelCallEvent', async () => {
      new InterventionRegistry([new ModelGuideHandler()], hookRegistry)

      const event = makeAfterModelCallEvent()
      const messageCountBefore = event.agent.messages.length
      await hookRegistry.invokeCallbacks(event)

      expect(event.retry).toBe(true)
      expect(event.agent.messages).toHaveLength(messageCountBefore + 1)
      const guidanceMessage = event.agent.messages[event.agent.messages.length - 1]!
      expect(guidanceMessage.role).toBe('user')
      expect(guidanceMessage.content[0]).toMatchObject({ type: 'textBlock', text: '[model-guide] be more specific' })
    })
  })

  describe('interrupt', () => {
    it('sets cancel with approval prompt on BeforeToolCallEvent', async () => {
      new InterventionRegistry([new InterruptHandler()], hookRegistry)

      const event = makeBeforeToolCallEvent()
      await hookRegistry.invokeCallbacks(event)
      expect(event.cancel).toBe('REQUIRES APPROVAL: approve this action?')
    })

    it('short-circuits — later handlers do not run', async () => {
      const laterCalled = vi.fn()

      class LaterHandler extends InterventionHandler {
        readonly name = 'later'
        override beforeToolCall(): InterventionAction {
          laterCalled()
          return { type: 'proceed' }
        }
      }

      new InterventionRegistry([new InterruptHandler(), new LaterHandler()], hookRegistry)

      await hookRegistry.invokeCallbacks(makeBeforeToolCallEvent())
      expect(laterCalled).not.toHaveBeenCalled()
    })
  })

  describe('transform', () => {
    it('calls the apply function with the event', async () => {
      const applyFn = vi.fn()

      class TransformHandler extends InterventionHandler {
        readonly name = 'transform-handler'
        override beforeToolCall(): InterventionAction {
          return { type: 'transform', apply: applyFn, reason: 'sanitized input' }
        }
      }

      new InterventionRegistry([new TransformHandler()], hookRegistry)

      const event = makeBeforeToolCallEvent()
      await hookRegistry.invokeCallbacks(event)
      expect(applyFn).toHaveBeenCalledWith(event)
    })

    it('later handlers see the transformed state', async () => {
      const observed: string[] = []

      class Transformer extends InterventionHandler {
        readonly name = 'transformer'
        override beforeToolCall(): InterventionAction {
          return {
            type: 'transform',
            apply: (e) => {
              ;(e as BeforeToolCallEvent).cancel = 'transformed'
            },
          }
        }
      }

      class Observer extends InterventionHandler {
        readonly name = 'observer'
        override beforeToolCall(event: BeforeToolCallEvent): InterventionAction {
          observed.push(String(event.cancel))
          return { type: 'proceed' }
        }
      }

      new InterventionRegistry([new Transformer(), new Observer()], hookRegistry)

      await hookRegistry.invokeCallbacks(makeBeforeToolCallEvent())
      expect(observed).toEqual(['transformed'])
    })

    it('works on AfterModelCallEvent', async () => {
      const applyFn = vi.fn()

      class ModelTransform extends InterventionHandler {
        readonly name = 'model-transform'
        override afterModelCall(): InterventionAction {
          return { type: 'transform', apply: applyFn, reason: 'redacted output' }
        }
      }

      new InterventionRegistry([new ModelTransform()], hookRegistry)

      const event = makeAfterModelCallEvent()
      await hookRegistry.invokeCallbacks(event)
      expect(applyFn).toHaveBeenCalledWith(event)
    })

    it('is logged in the audit trail', async () => {
      class TransformHandler extends InterventionHandler {
        readonly name = 'transform-handler'
        override beforeToolCall(): InterventionAction {
          return { type: 'transform', apply: () => {}, reason: 'sanitized' }
        }
      }

      const registry = new InterventionRegistry([new TransformHandler()], hookRegistry)

      await hookRegistry.invokeCallbacks(makeBeforeToolCallEvent())
      expect(registry.auditLog[0]).toMatchObject({
        handler: 'transform-handler',
        actionType: 'TRANSFORM',
        detail: 'sanitized',
      })
    })
  })

  describe('proceed', () => {
    it('does not mutate the event', async () => {
      new InterventionRegistry([new ProceedHandler()], hookRegistry)

      const event = makeBeforeToolCallEvent()
      await hookRegistry.invokeCallbacks(event)
      expect(event.cancel).toBe(false)
    })
  })

  describe('error handling', () => {
    it('onError=throw (default) rethrows the error', async () => {
      new InterventionRegistry([new ThrowingHandler(), new ProceedHandler()], hookRegistry)

      await expect(hookRegistry.invokeCallbacks(makeBeforeToolCallEvent())).rejects.toThrow('handler crashed')
    })

    it('onError=proceed logs the error and continues to next handler', async () => {
      const registry = new InterventionRegistry([new ThrowingProceedHandler(), new ProceedHandler()], hookRegistry)

      const event = makeBeforeToolCallEvent()
      await hookRegistry.invokeCallbacks(event)

      expect(registry.auditLog).toHaveLength(2)
      expect(registry.auditLog[0]).toMatchObject({
        handler: 'throwing-proceed',
        actionType: 'PROCEED',
        detail: 'Handler threw: handler crashed',
      })
      expect(registry.auditLog[1]).toMatchObject({
        handler: 'proceed-handler',
        actionType: 'PROCEED',
      })
    })

    it('onError=deny logs the error and applies deny', async () => {
      const laterCalled = vi.fn()

      class LaterHandler extends InterventionHandler {
        readonly name = 'later'
        override beforeToolCall(): InterventionAction {
          laterCalled()
          return { type: 'proceed' }
        }
      }

      const registry = new InterventionRegistry([new ThrowingDenyHandler(), new LaterHandler()], hookRegistry)

      const event = makeBeforeToolCallEvent()
      await hookRegistry.invokeCallbacks(event)

      expect(event.cancel).toBe('DENIED: Handler threw: handler crashed')
      expect(laterCalled).not.toHaveBeenCalled()
      expect(registry.auditLog).toHaveLength(1)
      expect(registry.auditLog[0]).toMatchObject({
        handler: 'throwing-deny',
        actionType: 'DENY',
      })
    })
  })

  describe('async handlers', () => {
    it('awaits async handler results', async () => {
      new InterventionRegistry([new AsyncDenyHandler()], hookRegistry)

      const event = makeBeforeToolCallEvent()
      await hookRegistry.invokeCallbacks(event)
      expect(event.cancel).toBe('DENIED: async denial')
    })
  })

  describe('audit log', () => {
    it('records every handler decision', async () => {
      const registry = new InterventionRegistry([new ProceedHandler(), new GuideHandler()], hookRegistry)

      await hookRegistry.invokeCallbacks(makeBeforeToolCallEvent())

      expect(registry.auditLog).toHaveLength(2)
      expect(registry.auditLog[0]).toMatchObject({
        handler: 'proceed-handler',
        eventType: 'beforeToolCall',
        actionType: 'PROCEED',
        detail: 'all good',
      })
      expect(registry.auditLog[1]).toMatchObject({
        handler: 'guide-handler',
        eventType: 'beforeToolCall',
        actionType: 'GUIDE',
        detail: 'add more context',
      })
    })

    it('includes timestamp on every record', async () => {
      const registry = new InterventionRegistry([new DenyHandler()], hookRegistry)

      await hookRegistry.invokeCallbacks(makeBeforeToolCallEvent())

      expect(registry.auditLog).toHaveLength(1)
      expect(new Date(registry.auditLog[0]!.timestamp).getTime()).not.toBeNaN()
    })

    it('returns a copy — external mutation does not affect internal state', async () => {
      const registry = new InterventionRegistry([new DenyHandler()], hookRegistry)

      await hookRegistry.invokeCallbacks(makeBeforeToolCallEvent())

      const snapshot = registry.auditLog
      expect(snapshot).toHaveLength(1)
      ;(snapshot as AuditRecord[]).push({ handler: 'fake', eventType: 'x', actionType: 'X', detail: '', timestamp: '' })
      expect(registry.auditLog).toHaveLength(1)
    })

    it('clearAuditLog empties the log', async () => {
      const registry = new InterventionRegistry([new DenyHandler()], hookRegistry)

      await hookRegistry.invokeCallbacks(makeBeforeToolCallEvent())
      expect(registry.auditLog).toHaveLength(1)

      registry.clearAuditLog()
      expect(registry.auditLog).toHaveLength(0)
    })
  })

  describe('conflict resolution', () => {
    it('deny wins over guide', async () => {
      new InterventionRegistry([new GuideHandler(), new DenyHandler()], hookRegistry)

      const event = makeBeforeToolCallEvent()
      await hookRegistry.invokeCallbacks(event)

      expect(event.cancel).toBe('DENIED: not authorized')
    })

    it('deny short-circuits before guide can accumulate', async () => {
      const registry = new InterventionRegistry([new DenyHandler(), new GuideHandler()], hookRegistry)

      const event = makeBeforeToolCallEvent()
      await hookRegistry.invokeCallbacks(event)

      expect(event.cancel).toBe('DENIED: not authorized')
      expect(registry.auditLog).toHaveLength(1)
    })

    it('interrupt short-circuits before guide can accumulate', async () => {
      const registry = new InterventionRegistry([new InterruptHandler(), new GuideHandler()], hookRegistry)

      const event = makeBeforeToolCallEvent()
      await hookRegistry.invokeCallbacks(event)

      expect(event.cancel).toBe('REQUIRES APPROVAL: approve this action?')
      expect(registry.auditLog).toHaveLength(1)
    })
  })
})
