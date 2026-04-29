/**
 * Steering system for Strands agents.
 *
 * Provides contextual guidance for agents through modular prompting.
 * Instead of front-loading all instructions, steering handlers provide
 * just-in-time feedback based on context data from registered providers.
 *
 * Core components:
 * - SteeringHandler: base class for guidance logic
 * - SteeringProvider: interface for context data providers
 * - ToolSteeringAction/ModelSteeringAction: proceed/guide/interrupt decisions
 *
 * @example
 * ```typescript
 * import { LLMSteeringHandler } from '@strands-agents/sdk/vended-plugins/steering'
 *
 * const handler = new LLMSteeringHandler({
 *   systemPrompt: '...',
 *   model: new BedrockModel(),
 * })
 * const agent = new Agent({ tools: [...], plugins: [handler] })
 * ```
 */

// Core
export type { Guide, Interrupt, ModelSteeringAction, Proceed, ToolSteeringAction } from './actions.js'
export type { SteeringContextData, SteeringProvider } from './providers/provider.js'
export { SteeringHandler } from './handlers/handler.js'

// Context providers
export { ToolLedgerSteeringProvider } from './providers/ledgers.js'

// Handler implementations
export { LLMSteeringHandler, type LLMSteeringHandlerConfig } from './handlers/llm.js'
