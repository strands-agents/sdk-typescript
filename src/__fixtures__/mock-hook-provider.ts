import type { HookableEvent, HookProvider, HookRegistry } from '../hooks/index.js'
import {
  InitializedEvent,
  BeforeInvocationEvent,
  AfterInvocationEvent,
  MessageAddedEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
} from '../hooks/index.js'
import type { HookableEventConstructor } from '../hooks/types.js'

/**
 * Mock hook provider that records all hookable event invocations for testing.
 */
export class MockHookProvider implements HookProvider {
  invocations: HookableEvent[] = []

  registerCallbacks(registry: HookRegistry): void {
    const eventTypes: HookableEventConstructor[] = [
      InitializedEvent,
      BeforeInvocationEvent,
      AfterInvocationEvent,
      MessageAddedEvent,
      BeforeToolCallEvent,
      AfterToolCallEvent,
      BeforeModelCallEvent,
      AfterModelCallEvent,
    ]

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
