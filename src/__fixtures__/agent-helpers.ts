/**
 * Test fixtures and helpers for Agent testing.
 * This module provides utilities for testing Agent-related implementations.
 */

import type { Agent } from '../agent/agent.js'
import { Message, TextBlock } from '../types/messages.js'
import type { Role } from '../types/messages.js'
import { StateStore } from '../state-store.js'
import type { JSONValue } from '../types/json.js'
import { ToolRegistry } from '../registry/tool-registry.js'
import type { HookableEvent } from '../hooks/events.js'
import type { HookableEventConstructor, HookCallback } from '../hooks/types.js'

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
