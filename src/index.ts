/**
 * Main entry point for the Strands Agents TypeScript SDK.
 *
 * This is the primary export module for the SDK, providing access to all
 * public APIs and functionality.
 */

// Agent class
export { Agent } from './agent/agent.js'

// Agent state type (not constructor - internal implementation)
export type { AgentState } from './agent/state.js'

// Agent types
export type { AgentData, AgentResult } from './types/agent.js'

// Error types
export { ContextWindowOverflowError, MaxTokensError } from './errors.js'

// JSON types
export type { JSONSchema, JSONValue } from './types/json.js'

// Message types
export type {
  Role,
  StopReason,
  TextBlockData,
  ToolUseBlockData,
  ToolResultBlockData,
  ReasoningBlockData,
  CachePointBlockData,
  ContentBlock,
  ContentBlockData,
  MessageData,
  SystemPrompt,
  SystemContentBlock,
  JsonBlock,
  ToolResultContent,
} from './types/messages.js'

// Message classes
export { TextBlock, ToolUseBlock, ToolResultBlock, ReasoningBlock, CachePointBlock, Message } from './types/messages.js'

// Tool types
export type { ToolSpec, ToolUse, ToolResultStatus, ToolResult, ToolChoice } from './tools/types.js'

// Tool interface and related types
export type { Tool, InvokableTool, ToolContext, ToolStreamEvent, ToolStreamGenerator } from './tools/tool.js'

// FunctionTool implementation
export { FunctionTool } from './tools/function-tool.js'

// Tool factory function
export { tool } from './tools/zod-tool.js'

// Streaming event types
export type {
  Usage,
  Metrics,
  ModelMessageStartEventData,
  ModelMessageStartEvent,
  ToolUseStart,
  ContentBlockStart,
  ModelContentBlockStartEventData,
  ModelContentBlockStartEvent,
  TextDelta,
  ToolUseInputDelta,
  ReasoningContentDelta,
  ContentBlockDelta,
  ModelContentBlockDeltaEventData,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStopEvent,
  ModelMessageStopEventData,
  ModelMessageStopEvent,
  ModelMetadataEventData,
  ModelMetadataEvent,
  ModelStreamEvent,
} from './models/streaming.js'

// Model provider types
export type { BaseModelConfig, StreamOptions, Model } from './models/model.js'

// Bedrock model provider
export { BedrockModel as BedrockModel } from './models/bedrock.js'
export type { BedrockModelConfig, BedrockModelOptions } from './models/bedrock.js'

// Agent streaming event types
export type {
  AgentStreamEvent,
  BeforeModelEvent,
  AfterModelEvent,
  BeforeToolsEvent,
  AfterToolsEvent,
  BeforeInvocationEvent,
  AfterInvocationEvent,
} from './agent/streaming.js'
