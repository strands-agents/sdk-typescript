/**
 * Main entry point for the Strands Agents TypeScript SDK.
 *
 * This is the primary export module for the SDK, providing access to all
 * public APIs and functionality.
 */

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

// Tool interface and related types
export type { Tool, ToolContext, ToolExecutionEvent, ToolStreamEvent } from './tools/tool'

// FunctionTool implementation for testing
export { FunctionTool } from './tools/__tests__/function-tool'

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
export type { StreamOptions, ModelProvider } from './models/model'
