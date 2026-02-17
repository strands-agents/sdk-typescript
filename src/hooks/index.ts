/**
 * Hooks module for event-driven extensibility.
 *
 * Hooks provide a composable mechanism for extending agent functionality
 * by subscribing to events throughout the agent lifecycle.
 */

// Event classes
export {
  HookEvent,
  InitializedEvent,
  BeforeInvocationEvent,
  AfterInvocationEvent,
  MessageAddedEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  ModelStreamEventHook,
  BeforeToolsEvent,
  AfterToolsEvent,
} from './events.js'

// Event types
export type { ModelStopData as ModelStopResponse } from './events.js'

// Registry
export { HookRegistryImplementation as HookRegistry } from './registry.js'

// Types
export type { HookCallback, HookProvider, HookEventConstructor, HookCleanup } from './types.js'
