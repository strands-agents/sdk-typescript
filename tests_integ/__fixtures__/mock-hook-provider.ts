import type { HookEvent, HookProvider, HookRegistry } from '@strands-agents/sdk'
import {
  BeforeInvocationEvent,
  AfterInvocationEvent,
  MessageAddedEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  ModelStreamEventHook,
} from '@strands-agents/sdk'

/**
 * Mock hook provider that records all hook invocations for testing.
 */
export class MockHookProvider implements HookProvider {
  invocations: HookEvent[] = []

  registerCallbacks(registry: HookRegistry): void {
    registry.addCallback(BeforeInvocationEvent, (e) => {
      this.invocations.push(e)
    })
    registry.addCallback(AfterInvocationEvent, (e) => {
      this.invocations.push(e)
    })
    registry.addCallback(MessageAddedEvent, (e) => {
      this.invocations.push(e)
    })
    registry.addCallback(BeforeToolCallEvent, (e) => {
      this.invocations.push(e)
    })
    registry.addCallback(AfterToolCallEvent, (e) => {
      this.invocations.push(e)
    })
    registry.addCallback(BeforeModelCallEvent, (e) => {
      this.invocations.push(e)
    })
    registry.addCallback(AfterModelCallEvent, (e) => {
      this.invocations.push(e)
    })
    registry.addCallback(ModelStreamEventHook, (e) => {
      this.invocations.push(e)
    })
  }

  reset(): void {
    this.invocations = []
  }

  getEventTypes(): string[] {
    return this.invocations.map((e) => (e as HookEvent & { type: string }).type)
  }
}
