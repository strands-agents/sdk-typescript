/**
 * Main entry point for the Strands Agents TypeScript SDK.
 *
 * This is the primary export module for the SDK, providing access to all
 * public APIs and functionality.
 */

// Error types
export { ContextWindowOverflowError } from './errors'

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
  ModelMessageStartEvent,
  ToolUseStart,
  ContentBlockStart,
  ModelContentBlockStartEvent,
  TextDelta,
  ToolUseInputDelta,
  ReasoningDelta,
  ContentBlockDelta,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStopEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
  ModelProviderStreamEvent,
} from './models/streaming'

// Model provider types
export type { BaseModelConfig, StreamOptions, ModelProvider } from './models/model'

// Bedrock model provider
export { BedrockModelProvider } from './models/bedrock'
export type { BedrockModelConfig, BedrockModelProviderOptions } from './models/bedrock'
