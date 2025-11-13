/**
 * Hooks module for event-driven extensibility.
 *
 * Hooks provide a composable mechanism for extending agent functionality
 * by subscribing to events throughout the agent lifecycle.
 */

// Event classes
export { HookEvent, BeforeInvocationEvent, AfterInvocationEvent } from './events.js'

// Registry
export { HookRegistry } from './registry.js'

// Types
export type { HookCallback, HookProvider } from './types.js'
