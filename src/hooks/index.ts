/**
 * Hooks module for event-driven extensibility.
 *
 * This module has two concerns with distinct naming:
 *
 * - **Events** (`StreamEvent` and subclasses) — the data objects yielded by `agent.stream()`
 *   and passed to hook callbacks. Named `Stream*` because they are members of the agent stream.
 *   See {@link StreamEvent} and `events.ts` for the full taxonomy.
 *
 * - **Hook infrastructure** (`HookProvider`, `HookCallback`, `HookRegistry`, `HookCleanup`) —
 *   the subscription mechanism that lets providers register callbacks for specific event types.
 *   Named `Hook*` because they describe the hooking/subscription pattern, not the events themselves.
 */

// Event classes
export {
  StreamEvent,
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
  BeforeToolsEvent,
  AfterToolsEvent,
} from './events.js'

// Event types
export type { ModelStopData as ModelStopResponse } from './events.js'

// Registry
export { HookRegistryImplementation as HookRegistry } from './registry.js'

// Types
export type { HookCallback, HookProvider, StreamEventConstructor, HookCleanup } from './types.js'
