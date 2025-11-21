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
export type { AgentConfig, ToolList } from './agent/agent.js'

// Error types
export { ContextWindowOverflowError, MaxTokensError, JsonValidationError, ConcurrentInvocationError } from './errors.js'

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
  GuardContentBlockData,
  GuardContentText,
  GuardContentImage,
  GuardQualifier,
  GuardImageFormat,
  GuardImageSource,
  ContentBlock,
  ContentBlockData,
  MessageData,
  SystemPrompt,
  SystemContentBlock,
  ToolResultContent,
} from './types/messages.js'

// Message classes
export {
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ReasoningBlock,
  CachePointBlock,
  GuardContentBlock,
  Message,
  JsonBlock,
} from './types/messages.js'

// Media classes
export { S3Location, ImageBlock, VideoBlock, DocumentBlock } from './types/media.js'

// Media types
export type {
  S3LocationData,
  ImageFormat,
  ImageSource,
  ImageSourceData,
  ImageBlockData,
  VideoFormat,
  VideoSource,
  VideoSourceData,
  VideoBlockData,
  DocumentFormat,
  DocumentSource,
  DocumentSourceData,
  DocumentBlockData,
  DocumentContentBlock,
  DocumentContentBlockData,
} from './types/media.js'

// Tool types
export type { ToolSpec, ToolUse, ToolResultStatus, ToolChoice } from './tools/types.js'

// Tool interface and related types
export type {
  Tool,
  InvokableTool,
  ToolContext,
  ToolStreamEventData,
  ToolStreamEvent,
  ToolStreamGenerator,
} from './tools/tool.js'

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
  BeforeInvocationEvent as BeforeInvocationStreamEvent,
  AfterInvocationEvent as AfterInvocationStreamEvent,
} from './agent/streaming.js'

// Hooks system
export {
  HookRegistry,
  HookEvent,
  BeforeInvocationEvent,
  AfterInvocationEvent,
  MessageAddedEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  ModelStreamEventHook,
} from './hooks/index.js'
export type { HookCallback, HookProvider, HookEventConstructor, ModelStopResponse } from './hooks/index.js'

// Conversation Manager
export { NullConversationManager } from './conversation-manager/null-conversation-manager.js'
export {
  SlidingWindowConversationManager,
  type SlidingWindowConversationManagerConfig,
} from './conversation-manager/sliding-window-conversation-manager.js'

// MCP Client types and implementations
export { type McpClientConfig, McpClient } from './mcp.js'
