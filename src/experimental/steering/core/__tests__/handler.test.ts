import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SteeringHandler } from '../handler.js'
import type { SteeringToolUse } from '../handler.js'
import { Proceed, Guide, Interrupt } from '../action.js'
import type { ToolSteeringAction, ModelSteeringAction } from '../action.js'
import { SteeringContext, SteeringContextCallback, SteeringContextProvider } from '../context.js'
import { HookRegistryImplementation } from '../../../../hooks/registry.js'
import { BeforeToolCallEvent, AfterModelCallEvent } from '../../../../hooks/events.js'
import type { AgentData } from '../../../../types/agent.js'
import type { Message, StopReason } from '../../../../types/messages.js'
import { TextBlock, Message as MessageClass } from '../../../../types/messages.js'
import type { HookEventConstructor } from '../../../../hooks/types.js'
import { AgentState } from '../../../../agent/state.js'
import { NullConversationManager } from '../../../../conversation-manager/null-conversation-manager.js'
import { Interrupt as InterruptClass, InterruptState, UUID_NAMESPACE_OID } from '../../../../interrupt.js'
import { v5 as uuidv5 } from 'uuid'

// --- Test helpers ---

function createMockAgent(): AgentData & { _interruptState: InterruptState } {
  return {
    agentId: 'test-agent',
    state: new AgentState(),
    messages: [],
    conversationManager: new NullConversationManager(),
    _interruptState: new InterruptState(),
  }
}

function createToolUse(): { name: string; toolUseId: string; input: Record<string, string> } {
  return { name: 'test_tool', toolUseId: 'tu-1', input: { arg: 'value' } }
}

function createModelStopData(): { message: Message; stopReason: StopReason } {
  return {
    message: new MessageClass({ role: 'assistant', content: [new TextBlock('hello')] }),
    stopReason: 'endTurn',
  }
}

// --- Concrete handler for testing ---

class TestSteeringHandler extends SteeringHandler {
  toolAction: ToolSteeringAction = new Proceed({ reason: 'test' })
  modelAction: ModelSteeringAction = new Proceed({ reason: 'test' })
  toolError: Error | undefined
  modelError: Error | undefined

  /** Expose protected context for testing. */
  get context(): SteeringContext {
    return this.steeringContext
  }

  protected override async steerBeforeTool(_params: {
    agent: AgentData
    toolUse: SteeringToolUse
  }): Promise<ToolSteeringAction> {
    if (this.toolError) {
      throw this.toolError
    }
    return this.toolAction
  }

  protected override async steerAfterModel(_params: {
    agent: AgentData
    message: Message
    stopReason: StopReason
  }): Promise<ModelSteeringAction> {
    if (this.modelError) {
      throw this.modelError
    }
    return this.modelAction
  }
}

// --- Context provider for testing ---

class TestBeforeToolCallback extends SteeringContextCallback<BeforeToolCallEvent> {
  readonly eventType: HookEventConstructor<BeforeToolCallEvent> = BeforeToolCallEvent
  callCount = 0

  update(_event: BeforeToolCallEvent, steeringContext: SteeringContext): void {
    this.callCount++
    steeringContext.set('callback_invoked', true)
  }
}

class TestContextProvider extends SteeringContextProvider {
  readonly callback = new TestBeforeToolCallback()

  contextProviders(): SteeringContextCallback[] {
    return [this.callback]
  }
}

// --- Tests ---

describe('SteeringHandler', () => {
  let handler: TestSteeringHandler
  let registry: HookRegistryImplementation

  beforeEach(() => {
    handler = new TestSteeringHandler()
    registry = new HookRegistryImplementation()
    handler.registerCallbacks(registry)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('initializes with empty context', () => {
      expect(handler.context.getAll()).toStrictEqual({})
    })

    it('steering context can be accessed and modified', () => {
      handler.context.set('key', 'value')
      expect(handler.context.get('key')).toBe('value')
    })

    it('steering context persists across calls', () => {
      handler.context.set('test', 'value')
      expect(handler.context.get('test')).toBe('value')
      // Value should still be there after another get
      expect(handler.context.get('test')).toBe('value')
    })

    it('accepts context providers', () => {
      const provider = new TestContextProvider()
      const handlerWithProvider = new TestSteeringHandler({ contextProviders: [provider] })
      const reg = new HookRegistryImplementation()
      handlerWithProvider.registerCallbacks(reg)

      // Trigger event to verify callback was registered
      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: createToolUse(),
        tool: undefined,
      })
      reg.invokeCallbacks(event)

      expect(provider.callback.callCount).toBe(1)
    })

    it('stores multiple context callbacks from providers', async () => {
      const provider1 = new TestContextProvider()
      const provider2 = new TestContextProvider()
      const handlerWithProviders = new TestSteeringHandler({
        contextProviders: [provider1, provider2],
      })
      const reg = new HookRegistryImplementation()
      handlerWithProviders.registerCallbacks(reg)

      // Trigger event — both providers' callbacks should fire
      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: createToolUse(),
        tool: undefined,
      })
      await reg.invokeCallbacks(event)

      expect(provider1.callback.callCount).toBe(1)
      expect(provider2.callback.callCount).toBe(1)
    })
  })

  describe('default implementations', () => {
    it('default steerBeforeTool returns Proceed', async () => {
      // Use a handler that does NOT override steerBeforeTool
      class DefaultHandler extends SteeringHandler {}
      const defaultHandler = new DefaultHandler()
      const reg = new HookRegistryImplementation()
      defaultHandler.registerCallbacks(reg)

      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: createToolUse(),
        tool: undefined,
      })
      await reg.invokeCallbacks(event)

      // Default returns Proceed — tool should not be cancelled
      expect(event.cancelTool).toBeUndefined()
    })

    it('default steerAfterModel returns Proceed', async () => {
      class DefaultHandler extends SteeringHandler {}
      const defaultHandler = new DefaultHandler()
      const reg = new HookRegistryImplementation()
      defaultHandler.registerCallbacks(reg)

      const event = new AfterModelCallEvent({
        agent: createMockAgent(),
        stopData: createModelStopData(),
      })
      await reg.invokeCallbacks(event)

      // Default returns Proceed — should not retry
      expect(event.retry).toBeUndefined()
    })
  })

  describe('tool steering', () => {
    it('proceeds when steerBeforeTool returns Proceed', async () => {
      handler.toolAction = new Proceed({ reason: 'all good' })

      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: createToolUse(),
        tool: undefined,
      })
      await registry.invokeCallbacks(event)

      expect(event.cancelTool).toBeUndefined()
    })

    it('cancels tool when steerBeforeTool returns Guide', async () => {
      handler.toolAction = new Guide({ reason: 'try something else' })

      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: createToolUse(),
        tool: undefined,
      })
      await registry.invokeCallbacks(event)

      expect(event.cancelTool).toBe(
        'Tool call cancelled. try something else You MUST follow this guidance immediately.'
      )
    })

    it('raises interrupt when steerBeforeTool returns Interrupt action', async () => {
      handler.toolAction = new Interrupt({ reason: 'need human input' })

      const agent = createMockAgent()
      const event = new BeforeToolCallEvent({
        agent,
        toolUse: createToolUse(),
        tool: undefined,
      })

      // The interrupt() call throws InterruptException, which invokeCallbacks catches
      const { interrupts } = await registry.invokeCallbacks(event)
      expect(interrupts).toHaveLength(1)
      expect(interrupts[0]!.name).toMatch(/^steering_input_/)
    })

    it('does not set cancelTool when Interrupt already has response (resume path)', async () => {
      handler.toolAction = new Interrupt({ reason: 'confirm' })
      const toolUse = createToolUse()
      const agent = createMockAgent()
      const interruptName = 'steering_input_test_tool'
      const id = `v1:before_tool_call:${toolUse.toolUseId}:${uuidv5(interruptName, UUID_NAMESPACE_OID)}`
      agent._interruptState.interrupts.set(
        id,
        new InterruptClass({ id, name: interruptName, reason: 'confirm', response: 'approved' })
      )

      const event = new BeforeToolCallEvent({
        agent,
        toolUse,
        tool: undefined,
      })

      await registry.invokeCallbacks(event)

      expect(event.cancelTool).toBeUndefined()
    })

    it('handles exceptions gracefully in steerBeforeTool', async () => {
      handler.toolError = new Error('evaluation failed')

      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: createToolUse(),
        tool: undefined,
      })
      await registry.invokeCallbacks(event)

      // Should not cancel tool — exception is caught and logged
      expect(event.cancelTool).toBeUndefined()
    })
  })

  describe('model steering', () => {
    it('proceeds when steerAfterModel returns Proceed', async () => {
      handler.modelAction = new Proceed({ reason: 'response looks good' })

      const event = new AfterModelCallEvent({
        agent: createMockAgent(),
        stopData: createModelStopData(),
      })
      await registry.invokeCallbacks(event)

      expect(event.retry).toBeUndefined()
    })

    it('retries with guidance when steerAfterModel returns Guide', async () => {
      handler.modelAction = new Guide({ reason: 'reconsider approach' })

      const agent = createMockAgent()
      const event = new AfterModelCallEvent({
        agent,
        stopData: createModelStopData(),
      })
      await registry.invokeCallbacks(event)

      expect(event.retry).toBe(true)
      // Guidance message should be added to agent messages
      expect(agent.messages.length).toBe(1)
      expect(agent.messages[0]!.role).toBe('user')
      expect(agent.messages[0]!.content[0]!.type).toBe('textBlock')
      expect((agent.messages[0]!.content[0] as TextBlock).text).toBe('reconsider approach')
    })

    it('skips steering when no stop data available', async () => {
      handler.modelAction = new Guide({ reason: 'should not trigger' })

      const event = new AfterModelCallEvent({
        agent: createMockAgent(),
        error: new Error('model failed'),
      })
      await registry.invokeCallbacks(event)

      // Should not retry — no stop data means error occurred
      expect(event.retry).toBeUndefined()
    })

    it('handles exceptions gracefully in steerAfterModel', async () => {
      handler.modelError = new Error('evaluation failed')

      const event = new AfterModelCallEvent({
        agent: createMockAgent(),
        stopData: createModelStopData(),
      })
      await registry.invokeCallbacks(event)

      // Should not retry — exception is caught and logged
      expect(event.retry).toBeUndefined()
    })
  })

  describe('context providers', () => {
    it('updates context via registered callbacks before steering', async () => {
      const provider = new TestContextProvider()
      const handlerWithProvider = new TestSteeringHandler({ contextProviders: [provider] })
      const reg = new HookRegistryImplementation()
      handlerWithProvider.registerCallbacks(reg)

      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: createToolUse(),
        tool: undefined,
      })
      await reg.invokeCallbacks(event)

      // Context callback should run before steering evaluation
      expect(handlerWithProvider.context.get('callback_invoked')).toBe(true)
    })

    it('persists context across multiple events', async () => {
      const provider = new TestContextProvider()
      const handlerWithProvider = new TestSteeringHandler({ contextProviders: [provider] })
      const reg = new HookRegistryImplementation()
      handlerWithProvider.registerCallbacks(reg)

      const event1 = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: createToolUse(),
        tool: undefined,
      })
      const event2 = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: { name: 'other_tool', toolUseId: 'tu-2', input: {} },
        tool: undefined,
      })

      await reg.invokeCallbacks(event1)
      await reg.invokeCallbacks(event2)

      // Callback should have been invoked twice
      expect(provider.callback.callCount).toBe(2)
    })
  })
})
