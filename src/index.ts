/**
 * Main entry point for the Strands Agents TypeScript SDK.
 *
 * This is the primary export module for the SDK, providing access to all
 * public APIs and functionality.
 */

export { hello } from './hello'

// JSON types
export type { JSONSchema, JSONValue } from './types/json'

// Message types
export type {
  Role,
  StopReason,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ReasoningBlock,
  ContentBlock,
  Message,
  Messages,
} from './types/messages'

// Tool types
export type {
  ToolSpec,
  ToolUse,
  ToolResultTextContent,
  ToolResultJsonContent,
  ToolResultContent,
  ToolResultStatus,
  ToolResult,
  ToolChoice,
} from './tools/types'

// Streaming event types
export type {
  Usage,
  Metrics,
  MessageStartEvent,
  ToolUseStart,
  GenericBlockStart,
  ContentBlockStart,
  ContentBlockStartEvent,
  TextDelta,
  ToolUseInputDelta,
  ReasoningDelta,
  ContentBlockDelta,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  MessageStopEvent,
  MetadataEvent,
  ModelProviderStreamEvent,
} from './models/streaming'

// Model configuration types
export type { ModelConfig } from './models/config'

// Model provider types
export type { StreamOptions, ModelProvider } from './models/model'
