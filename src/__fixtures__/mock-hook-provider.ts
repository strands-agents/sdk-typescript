import type { HookEvent, HookProvider, HookRegistry } from '../hooks/index.js'
import { BeforeInvocationEvent, AfterInvocationEvent } from '../hooks/index.js'

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
  }

  reset(): void {
    this.invocations = []
  }
}
