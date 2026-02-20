import type { StreamEvent, HookProvider, HookRegistry } from '../hooks/index.js'
import {
  InitializedEvent,
  BeforeInvocationEvent,
  AfterInvocationEvent,
  MessageAddedEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  ModelStreamUpdateEvent,
  ContentBlockCompleteEvent,
  ModelMessageEvent,
  ToolResultEvent,
  ToolStreamUpdateEvent,
  AgentResultEvent,
} from '../hooks/index.js'
import type { StreamEventConstructor } from '../hooks/types.js'

/**
 * Mock hook provider that records all hook invocations for testing.
 */
export class MockHookProvider implements HookProvider {
  invocations: StreamEvent[] = []
  private includeModelEvents: boolean

  constructor(options: { includeModelEvents?: boolean } = {}) {
    this.includeModelEvents = options.includeModelEvents ?? true
  }

  registerCallbacks(registry: HookRegistry): void {
    const lifecycleEvents: StreamEventConstructor[] = [
      InitializedEvent,
      BeforeInvocationEvent,
      AfterInvocationEvent,
      MessageAddedEvent,
      BeforeToolCallEvent,
      AfterToolCallEvent,
      BeforeModelCallEvent,
      AfterModelCallEvent,
    ]

    const modelEvents: StreamEventConstructor[] = [
      ModelStreamUpdateEvent,
      ContentBlockCompleteEvent,
      ModelMessageEvent,
      ToolResultEvent,
      ToolStreamUpdateEvent,
      AgentResultEvent,
    ]

    const eventTypes = this.includeModelEvents ? [...lifecycleEvents, ...modelEvents] : lifecycleEvents

    for (const eventType of eventTypes) {
      registry.addCallback(eventType, (e) => {
        this.invocations.push(e)
      })
    }
  }

  reset(): void {
    this.invocations = []
  }
}
