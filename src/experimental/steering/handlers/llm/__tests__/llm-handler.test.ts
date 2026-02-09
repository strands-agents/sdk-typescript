import { afterEach, describe, expect, it, vi } from 'vitest'
import { LLMSteeringHandler } from '../llm-handler.js'
import { HookRegistryImplementation } from '../../../../../hooks/registry.js'
import { BeforeToolCallEvent } from '../../../../../hooks/events.js'
import type { AgentData } from '../../../../../types/agent.js'
import { AgentState } from '../../../../../agent/state.js'
import { NullConversationManager } from '../../../../../conversation-manager/null-conversation-manager.js'
import { InterruptState } from '../../../../../interrupt.js'
import type { Model } from '../../../../../models/model.js'
import type { LLMPromptMapper } from '../mappers.js'

// Hoisted shared state for the Agent mock — accessible to both vi.mock factory and tests
const { invokeResult, invokeArgs, invokeError } = vi.hoisted(() => ({
  invokeResult: { value: { structuredOutput: { decision: 'proceed', reason: 'default' } } as unknown },
  invokeArgs: { calls: [] as unknown[][] },
  invokeError: { value: null as Error | null },
}))

vi.mock('../../../../../agent/agent.js', () => ({
  Agent: class MockAgent {
    async invoke(...args: unknown[]): Promise<unknown> {
      invokeArgs.calls.push(args)
      if (invokeError.value !== null) {
        throw invokeError.value
      }
      return invokeResult.value
    }
  },
}))

function createMockModel(): Model {
  return {
    getConfig: () => ({ modelId: 'test-model' }),
    updateConfig: vi.fn(),
    stream: vi.fn(),
  } as unknown as Model
}

function createMockAgent(): AgentData & { _interruptState: InterruptState } {
  return {
    agentId: 'test-agent',
    state: new AgentState(),
    messages: [],
    conversationManager: new NullConversationManager(),
    _interruptState: new InterruptState(),
  }
}

function createHandler(overrides?: { promptMapper?: LLMPromptMapper }): {
  handler: LLMSteeringHandler
  registry: HookRegistryImplementation
} {
  const handler = new LLMSteeringHandler({
    systemPrompt: 'You are a security evaluator.',
    model: createMockModel(),
    contextProviders: [],
    ...overrides,
  })
  const registry = new HookRegistryImplementation()
  handler.registerCallbacks(registry)
  return { handler, registry }
}

describe('LLMSteeringHandler', () => {
  afterEach(() => {
    invokeResult.value = { structuredOutput: { decision: 'proceed', reason: 'default' } }
    invokeArgs.calls = []
    invokeError.value = null
  })

  describe('initialization', () => {
    it('creates handler with required config', () => {
      const h = new LLMSteeringHandler({
        systemPrompt: 'test prompt',
        model: createMockModel(),
      })
      expect(h).toBeInstanceOf(LLMSteeringHandler)
    })

    it('creates handler with custom prompt mapper', () => {
      const customMapper = {
        createSteeringPrompt: vi.fn().mockReturnValue('custom prompt'),
      }
      const h = new LLMSteeringHandler({
        systemPrompt: 'test',
        model: createMockModel(),
        promptMapper: customMapper,
      })
      expect(h).toBeInstanceOf(LLMSteeringHandler)
    })
  })

  describe('steerBeforeTool', () => {
    it('proceeds when LLM decides to proceed', async () => {
      invokeResult.value = { structuredOutput: { decision: 'proceed', reason: 'no issues found' } }
      const { registry } = createHandler()

      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: { name: 'safe_tool', toolUseId: 'tu-1', input: {} },
        tool: undefined,
      })
      await registry.invokeCallbacks(event)

      expect(event.cancelTool).toBeUndefined()
    })

    it('cancels tool when LLM decides to guide', async () => {
      invokeResult.value = { structuredOutput: { decision: 'guide', reason: 'use a safer approach' } }
      const { registry } = createHandler()

      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: { name: 'risky_tool', toolUseId: 'tu-2', input: {} },
        tool: undefined,
      })
      await registry.invokeCallbacks(event)

      expect(event.cancelTool).toContain('use a safer approach')
    })

    it('raises interrupt when LLM decides to interrupt', async () => {
      invokeResult.value = { structuredOutput: { decision: 'interrupt', reason: 'need approval' } }
      const { registry } = createHandler()

      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: { name: 'dangerous_tool', toolUseId: 'tu-3', input: {} },
        tool: undefined,
      })

      const { interrupts } = await registry.invokeCallbacks(event)
      expect(interrupts).toHaveLength(1)
      expect(interrupts[0]!.name).toMatch(/^steering_input_dangerous_tool$/)
    })

    it('handles agent invocation errors gracefully', async () => {
      invokeError.value = new Error('model unavailable')
      const { registry } = createHandler()

      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: { name: 'test_tool', toolUseId: 'tu-4', input: {} },
        tool: undefined,
      })

      // Should not throw — errors in steering evaluation are caught
      await registry.invokeCallbacks(event)
      expect(event.cancelTool).toBeUndefined()
    })

    it('passes prompt to steering agent', async () => {
      invokeResult.value = { structuredOutput: { decision: 'proceed', reason: 'ok' } }
      const { registry } = createHandler()

      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: { name: 'my_tool', toolUseId: 'tu-5', input: { file: 'test.txt' } },
        tool: undefined,
      })
      await registry.invokeCallbacks(event)

      expect(invokeArgs.calls).toHaveLength(1)
      const [prompt] = invokeArgs.calls[0]!
      expect(prompt).toContain('my_tool')
      expect(prompt).toContain('test.txt')
    })

    it('defaults to Proceed for unknown LLM decision', async () => {
      invokeResult.value = { structuredOutput: { decision: 'unknown', reason: 'invalid decision' } }
      const { registry } = createHandler()

      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: { name: 'test_tool', toolUseId: 'tu-7', input: {} },
        tool: undefined,
      })
      await registry.invokeCallbacks(event)

      // Unknown decision defaults to Proceed — tool should not be cancelled
      expect(event.cancelTool).toBeUndefined()
    })

    it('uses custom prompt mapper when provided', async () => {
      invokeResult.value = { structuredOutput: { decision: 'proceed', reason: 'ok' } }
      const customMapper = {
        createSteeringPrompt: vi.fn().mockReturnValue('custom evaluation prompt'),
      }
      const { registry } = createHandler({ promptMapper: customMapper })

      const event = new BeforeToolCallEvent({
        agent: createMockAgent(),
        toolUse: { name: 'test', toolUseId: 'tu-6', input: {} },
        tool: undefined,
      })
      await registry.invokeCallbacks(event)

      expect(customMapper.createSteeringPrompt).toHaveBeenCalledOnce()
      expect(invokeArgs.calls).toHaveLength(1)
      const [prompt] = invokeArgs.calls[0]!
      expect(prompt).toBe('custom evaluation prompt')
    })
  })
})
