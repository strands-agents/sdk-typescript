/**
 * Main entry point for the Strands Agents TypeScript SDK.
 *
 * This is the primary export module for the SDK, providing access to all
 * public APIs and functionality.
 */

// Error types
export { ContextWindowOverflowError, MaxTokensError } from './errors'

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
  CachePointBlock,
  ContentBlock,
  Message,
  SystemPrompt,
  SystemContentBlock,
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
export type { Tool, InvokableTool, ToolContext, ToolStreamEvent, ToolStreamGenerator } from './tools/tool'

// FunctionTool implementation
export { FunctionTool } from './tools/function-tool'

// Tool factory function
export { tool } from './tools/zod-tool'

// ToolRegistry implementation
export { ToolRegistry } from './tools/registry'

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
  ReasoningContentDelta,
  ContentBlockDelta,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStopEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
  ModelStreamEvent,
} from './models/streaming'

// Model provider types
export type { BaseModelConfig, StreamOptions, Model } from './models/model'

// Bedrock model provider
export { BedrockModel as BedrockModel } from './models/bedrock'
export type { BedrockModelConfig, BedrockModelOptions } from './models/bedrock'

// Agent streaming event types
export type {
  AgentStreamEvent,
  BeforeModelEvent,
  AfterModelEvent,
  BeforeToolsEvent,
  AfterToolsEvent,
  BeforeInvocationEvent,
  AfterInvocationEvent,
} from './agent/streaming'

// Agent result type

export type { AgentResult } from './types/agent'
