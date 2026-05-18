import { describe, expect, it, vi } from 'vitest'
import { Agent } from '../../../agent/agent.js'
import { HookRegistryImplementation } from '../../../hooks/registry.js'
import { AfterModelCallEvent, BeforeToolCallEvent } from '../../../hooks/events.js'
import { Interrupt, InterruptState } from '../../../interrupt.js'
import { InterventionRegistry } from '../../../interventions/registry.js'
import { Message, TextBlock } from '../../../types/messages.js'
import type { ToolUse } from '../../../tools/types.js'
import type { LocalAgent } from '../../../types/agent.js'
import { SteeringHandler } from '../handlers/handler.js'
import type { ModelSteeringAction, ToolSteeringAction } from '../handlers/handler.js'
import type { SteeringContextData, SteeringContextProvider } from '../providers/context-provider.js'

describe('SteeringHandler', () => {
  const toolUse = { name: 'searchWeb', toolUseId: 'tu-1', input: { q: 'hi' } }

  function makeBeforeToolCallEvent(agent: LocalAgent): BeforeToolCallEvent {
    return new BeforeToolCallEvent({ agent, toolUse, tool: undefined, invocationState: {} })
  }

  function makeAfterModelCallEvent(agent: LocalAgent): AfterModelCallEvent {
    return new AfterModelCallEvent({
      agent,
      model: {} as never,
      invocationState: {},
      attemptCount: 0,
      stopData: {
        message: new Message({ role: 'assistant', content: [new TextBlock('response')] }),
        stopReason: 'endTurn',
      },
    })
  }

  it('routes beforeToolCall to steerBeforeTool with agent and toolUse', async () => {
    const seen: { agent?: LocalAgent; toolUse?: ToolUse } = {}

    class Spy extends SteeringHandler {
      override readonly name = 'spy'
      override async steerBeforeTool(agent: LocalAgent, tu: ToolUse): Promise<ToolSteeringAction> {
        seen.agent = agent
        seen.toolUse = tu
        return { type: 'guide', feedback: 'try again' }
      }
    }

    const hookRegistry = new HookRegistryImplementation()
    const agent = new Agent()
    new InterventionRegistry([new Spy()], hookRegistry)

    const event = makeBeforeToolCallEvent(agent)
    await hookRegistry.invokeCallbacks(event)

    expect(seen.agent).toBe(agent)
    expect(seen.toolUse).toEqual(toolUse)
    expect(event.cancel).toContain('GUIDANCE:')
    expect(event.cancel).toContain('try again')
  })

  it('routes afterModelCall to steerAfterModel with message and stopReason', async () => {
    const seen: { message?: Message; stopReason?: string } = {}

    class Spy extends SteeringHandler {
      override readonly name = 'spy'
      override async steerAfterModel(
        _agent: LocalAgent,
        message: Message,
        stopReason: string
      ): Promise<ModelSteeringAction> {
        seen.message = message
        seen.stopReason = stopReason
        return { type: 'guide', feedback: 'be terser' }
      }
    }

    const hookRegistry = new HookRegistryImplementation()
    const agent = new Agent()
    new InterventionRegistry([new Spy()], hookRegistry)

    const event = makeAfterModelCallEvent(agent)
    await hookRegistry.invokeCallbacks(event)

    expect(seen.message).toBeDefined()
    expect(seen.stopReason).toBe('endTurn')
    expect(event.retry).toBe(true)
  })

  it('default implementations proceed', async () => {
    class Empty extends SteeringHandler {
      override readonly name = 'empty'
    }

    const handler = new Empty()
    const proceed = { type: 'proceed' }
    expect(await handler.steerBeforeTool({} as never, toolUse)).toEqual(proceed)
    expect(await handler.steerAfterModel({} as never, new Message({ role: 'user', content: [] }), 'endTurn')).toEqual(
      proceed
    )
  })

  it('exposes provider context to subclasses via getSteeringContext', async () => {
    const fakeProvider: SteeringContextProvider = {
      name: 'fake',
      initAgent: () => {},
      get context(): SteeringContextData {
        return { type: 'fake', tokens: 42 }
      },
    }

    let observedContext: SteeringContextData[] | undefined

    class ContextReader extends SteeringHandler {
      override readonly name = 'context-reader'
      override async steerBeforeTool(): Promise<ToolSteeringAction> {
        observedContext = this.getSteeringContext()
        return { type: 'proceed' }
      }
    }

    const hookRegistry = new HookRegistryImplementation()
    const agent = new Agent()
    new InterventionRegistry([new ContextReader({ contextProviders: [fakeProvider] })], hookRegistry)

    await hookRegistry.invokeCallbacks(makeBeforeToolCallEvent(agent))

    expect(observedContext).toEqual([{ type: 'fake', tokens: 42 }])
  })

  it('uses custom name when provided so siblings can coexist on one agent', () => {
    class A extends SteeringHandler {}
    class B extends SteeringHandler {}

    const hookRegistry = new HookRegistryImplementation()
    expect(
      () => new InterventionRegistry([new A({ name: 'steer:tool' }), new B({ name: 'steer:model' })], hookRegistry)
    ).not.toThrow()
  })

  it('skips afterModelCall when stopData is missing', async () => {
    const called = vi.fn()

    class Spy extends SteeringHandler {
      override readonly name = 'spy'
      override async steerAfterModel(): Promise<ModelSteeringAction> {
        called()
        return { type: 'proceed' }
      }
    }

    const hookRegistry = new HookRegistryImplementation()
    const agent = new Agent()
    new InterventionRegistry([new Spy()], hookRegistry)

    const event = new AfterModelCallEvent({
      agent,
      model: {} as never,
      invocationState: {},
      attemptCount: 0,
    })
    await hookRegistry.invokeCallbacks(event)

    expect(called).not.toHaveBeenCalled()
  })

  it('confirm decision flows through the interrupt system on resume (approved)', async () => {
    class Approver extends SteeringHandler {
      override readonly name = 'approver'
      override async steerBeforeTool(): Promise<ToolSteeringAction> {
        return { type: 'confirm', prompt: 'approve searchWeb?' }
      }
    }

    const hookRegistry = new HookRegistryImplementation()
    const agent = new Agent()

    // Preload an approval response so event.interrupt() returns it instead of pausing
    const interruptId = `hook:beforeToolCall:${toolUse.toolUseId}:approver`
    const interruptState = (agent as unknown as { _interruptState: InterruptState })._interruptState
    interruptState.interrupts[interruptId] = new Interrupt({
      id: interruptId,
      name: 'approver',
      response: 'yes' as never,
      source: 'hook',
    })

    new InterventionRegistry([new Approver()], hookRegistry)

    const event = makeBeforeToolCallEvent(agent)
    await hookRegistry.invokeCallbacks(event)

    expect(event.cancel).toBe(false)
  })

  it('confirm decision sets cancel when human denies', async () => {
    class Approver extends SteeringHandler {
      override readonly name = 'approver'
      override async steerBeforeTool(): Promise<ToolSteeringAction> {
        return { type: 'confirm', prompt: 'approve searchWeb?' }
      }
    }

    const hookRegistry = new HookRegistryImplementation()
    const agent = new Agent()

    const interruptId = `hook:beforeToolCall:${toolUse.toolUseId}:approver`
    const interruptState = (agent as unknown as { _interruptState: InterruptState })._interruptState
    interruptState.interrupts[interruptId] = new Interrupt({
      id: interruptId,
      name: 'approver',
      response: 'no' as never,
      source: 'hook',
    })

    new InterventionRegistry([new Approver()], hookRegistry)

    const event = makeBeforeToolCallEvent(agent)
    await hookRegistry.invokeCallbacks(event)

    expect(event.cancel).toBe('CONFIRMATION_FAILED: approve searchWeb?')
  })
})
