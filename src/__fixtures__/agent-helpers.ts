/**
 * Test fixtures and helpers for Agent testing.
 * This module provides utilities for testing Agent-related implementations.
 */

import { expect } from 'vitest'
import type { Agent } from '../agent/agent.js'
import type { AgentResult } from '../types/agent.js'
import type { StopReason } from '../types/messages.js'
import { Message, TextBlock } from '../types/messages.js'
import type { Role } from '../types/messages.js'
import { StateStore } from '../state-store.js'
import type { JSONValue } from '../types/json.js'
import { ToolRegistry } from '../registry/tool-registry.js'
import type { HookableEvent } from '../hooks/events.js'
import type { HookableEventConstructor, HookCallback } from '../hooks/types.js'
import { expectLoopMetrics, type LoopMetricsMatcher } from './metrics-helpers.js'

/**
 * A hook registration captured by the mock agent's addHook.
 */
export type TrackedHook = {
  eventType: HookableEventConstructor<HookableEvent>
  callback: HookCallback<HookableEvent>
}

/**
 * Data for creating a mock Agent.
 */
export interface MockAgentData {
  /**
   * Messages for the agent.
   */
  messages?: Message[]
  /**
   * Initial state for the agent.
   */
  appState?: Record<string, JSONValue>
  /**
   * Optional tool registry for the agent.
   */
  toolRegistry?: ToolRegistry
  /**
   * Additional properties to spread onto the mock agent.
   */
  extra?: Partial<Agent>
}

/**
 * A mock Agent with a `trackedHooks` array populated by `addHook` calls.
 */
export type MockAgent = Agent & { trackedHooks: TrackedHook[] }

/**
 * Helper to create a mock Agent for testing.
 * Provides minimal Agent interface with messages, appState, and tool registry.
 * `addHook` captures registrations into `trackedHooks` for test inspection.
 *
 * @param data - Optional mock agent data
 * @returns Mock Agent with trackedHooks
 */
export function createMockAgent(data?: MockAgentData): MockAgent {
  const trackedHooks: TrackedHook[] = []
  return {
    messages: data?.messages ?? [],
    appState: new StateStore(data?.appState ?? {}),
    toolRegistry: data?.toolRegistry ?? new ToolRegistry(),
    addHook: <T extends HookableEvent>(eventType: HookableEventConstructor<T>, callback: HookCallback<T>) => {
      trackedHooks.push({
        eventType: eventType as HookableEventConstructor<HookableEvent>,
        callback: callback as HookCallback<HookableEvent>,
      })
      return () => {}
    },
    ...data?.extra,
    trackedHooks,
  } as unknown as MockAgent
}

/**
 * Creates a Message with the given role containing a single TextBlock.
 *
 * @param role - The message role
 * @param text - The text content
 * @returns A Message with the specified role
 */
export function textMessage(role: Role, text: string): Message {
  return new Message({ role, content: [new TextBlock(text)] })
}

/**
 * Finds the tracked hook for the given event type and invokes it with the provided event.
 * Throws if no hook is registered for that event type.
 *
 * @param agent - The mock agent with tracked hooks
 * @param event - The event instance to dispatch
 */
export async function invokeTrackedHook<T extends HookableEvent>(agent: MockAgent, event: T): Promise<void> {
  const hook = agent.trackedHooks.find((h) => h.eventType === event.constructor)
  if (!hook) {
    throw new Error(`No hook registered for event type: ${event.constructor.name}`)
  }
  await hook.callback(event)
}

/**
 * Options for building an AgentResult matcher.
 */
export interface AgentResultMatcher extends Omit<LoopMetricsMatcher, 'cycleCount'> {
  /**
   * Expected stop reason from the final model response.
   */
  stopReason: StopReason

  /**
   * Expected text content in the last assistant message's TextBlock.
   * When provided, asserts exact text match in a TextBlock with role 'assistant'.
   * When omitted, only validates lastMessage exists with role 'assistant'.
   */
  messageText?: string

  /**
   * Expected number of agent loop cycles.
   */
  cycleCount: number

  /**
   * Expected number of traces. When provided, asserts exact array length.
   * When omitted, asserts traces array exists with at least one element.
   */
  traceCount?: number
}

/**
 * Creates an asymmetric matcher that validates AgentResult structure and values.
 * Reduces nesting in test assertions by providing a clean, readable matcher.
 *
 * @param options - Expected result values
 * @returns An asymmetric matcher suitable for use in expect().toEqual()
 *
 * @example
 * ```typescript
 * expect(result).toEqual(expectAgentResult({
 *   stopReason: 'endTurn',
 *   messageText: 'Hello',
 *   cycleCount: 1,
 * }))
 * ```
 */
export function expectAgentResult(options: AgentResultMatcher): AgentResult {
  const { stopReason, messageText, cycleCount, traceCount, toolNames, usage } = options

  const expectedLastMessage = messageText
    ? expect.objectContaining({
        role: 'assistant',
        content: expect.arrayContaining([expect.objectContaining({ type: 'textBlock', text: messageText })]),
      })
    : expect.objectContaining({ role: 'assistant' })

  const expectedTraces =
    traceCount !== undefined
      ? expect.objectContaining({ length: traceCount })
      : expect.arrayContaining([expect.objectContaining({ name: expect.any(String) })])

  // Build metrics matcher options, only including defined properties
  const metricsOptions: LoopMetricsMatcher = { cycleCount }
  if (toolNames !== undefined) {
    metricsOptions.toolNames = toolNames
  }
  if (usage !== undefined) {
    metricsOptions.usage = usage
  }

  return expect.objectContaining({
    type: 'agentResult',
    stopReason,
    lastMessage: expectedLastMessage,
    metrics: expectLoopMetrics(metricsOptions),
    traces: expectedTraces,
  }) as AgentResult
}
