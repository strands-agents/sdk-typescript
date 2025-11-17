import type { HookEvent, HookProvider, HookRegistry } from '../hooks/index.js'
import {
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

  registerCallbacks(registry: HookRegistry): void {
    const eventTypes: HookEventConstructor[] = [
      BeforeInvocationEvent,
      AfterInvocationEvent,
      MessageAddedEvent,
      BeforeToolCallEvent,
      AfterToolCallEvent,
      BeforeModelCallEvent,
      AfterModelCallEvent,
      ModelStreamEventHook,
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

  getEventTypes(): string[] {
    return this.invocations.map((e) => (e as HookEvent & { type: string }).type)
  }
}
