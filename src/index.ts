/**
 * Main entry point for the Strands Agents TypeScript SDK.
 *
 * This is the primary export module for the SDK, providing access to all
 * public APIs and functionality.
 */

export { hello } from './hello'

// Message types
export type { Role, ReasoningContent, ContentBlock, Message, Messages } from './types/messages'

// Tool types
export type {
  JSONSchema,
  ToolSpec,
  ToolUse,
  ToolResultContent,
  ToolResultStatus,
  ToolResult,
  ToolChoice,
} from './tools/types'

// Streaming event types
export type {
  StopReason,
  Usage,
  Metrics,
  MessageStartEvent,
  ContentBlockStart,
  ContentBlockStartEvent,
  ContentBlockDelta,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  MessageStopEvent,
  MetadataEvent,
  StreamEvent,
} from './streaming/events'

// Model configuration types
export type { ModelConfig } from './models/config'

// Model provider types
export type { StreamOptions, ModelProvider } from './models/provider'
