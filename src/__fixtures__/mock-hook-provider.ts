import type { HookEvent, HookProvider, HookRegistry } from '../hooks/index.js'
import {
  InitializedEvent,
  BeforeInvocationEvent,
  AfterInvocationEvent,
  MessageAddedEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  ModelStreamEventHook,
} from '../hooks/index.js'
import type { HookEventConstructor } from '../hooks/types.js'

/**
 * Mock hook provider that records all hook invocations for testing.
 */
export class MockHookProvider implements HookProvider {
  invocations: HookEvent[] = []
  private includeModelEvents: boolean

  constructor(options: { includeModelEvents?: boolean } = {}) {
    this.includeModelEvents = options.includeModelEvents ?? true
  }

  registerCallbacks(registry: HookRegistry): void {
    const lifecycleEvents: HookEventConstructor[] = [
      InitializedEvent,
      BeforeInvocationEvent,
      AfterInvocationEvent,
      MessageAddedEvent,
      BeforeToolCallEvent,
      AfterToolCallEvent,
      BeforeModelCallEvent,
      AfterModelCallEvent,
    ]

    const modelEvents: HookEventConstructor[] = [ModelStreamEventHook]

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
