/**
 * Main entry point for the Strands Agents TypeScript SDK.
 *
 * This is the primary export module for the SDK, providing access to all
 * public APIs and functionality.
 */

// Agent class
export { Agent } from './agent/agent.js'

// App state
export { AppState } from './app-state.js'

// Agent types
export { AgentResult } from './types/agent.js'
export type { AgentConfig, ToolList } from './agent/agent.js'

// Error types
export {
  ModelError,
  ContextWindowOverflowError,
  MaxTokensError,
  JsonValidationError,
  ConcurrentInvocationError,
  ModelThrottledError,
  ToolValidationError,
} from './errors.js'

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
  SystemPromptData,
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
  contentBlockFromData,
  toolResultContentFromData,
} from './types/messages.js'

// Citation types
export type {
  CitationsBlockData,
  Citation,
  CitationLocation,
  CitationSourceContent,
  CitationGeneratedContent,
} from './types/citations.js'

// Citation class
export { CitationsBlock } from './types/citations.js'

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
  InvokableTool,
  ToolContext,
  ToolStreamEventData,
  ToolStreamEvent,
  ToolStreamGenerator,
} from './tools/tool.js'

// Tool base class
export { Tool } from './tools/tool.js'

// FunctionTool implementation
export { FunctionTool } from './tools/function-tool.js'
export type { FunctionToolConfig, FunctionToolCallback } from './tools/function-tool.js'

// ZodTool implementation
export { ZodTool } from './tools/zod-tool.js'
export type { ZodToolConfig } from './tools/zod-tool.js'

// Tool factory function
export { tool } from './tools/tool-factory.js'

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
  CitationsDelta,
  ContentBlockDelta,
  ModelContentBlockDeltaEventData,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStopEvent,
  ModelMessageStopEventData,
  ModelMessageStopEvent,
  ModelMetadataEventData,
  ModelMetadataEvent,
  RedactInputContent,
  RedactOutputContent,
  ModelRedactionEventData,
  ModelRedactionEvent,
  ModelStreamEvent,
} from './models/streaming.js'
export { isModelStreamEvent } from './models/streaming.js'

// Model provider types
export type { BaseModelConfig, StreamOptions, CacheConfig } from './models/model.js'

export { Model } from './models/model.js'

// Bedrock model provider
export { BedrockModel as BedrockModel } from './models/bedrock.js'
export type {
  BedrockModelConfig,
  BedrockModelOptions,
  BedrockGuardrailConfig,
  BedrockGuardrailRedactionConfig,
} from './models/bedrock.js'

// Agent streaming event types
export type { AgentStreamEvent } from './types/agent.js'

// Hooks system
export {
  HookRegistry,
  StreamEvent,
  HookableEvent,
  InitializedEvent,
  BeforeInvocationEvent,
  AfterInvocationEvent,
  MessageAddedEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  BeforeToolsEvent,
  AfterToolsEvent,
  ContentBlockEvent,
  ModelMessageEvent,
  ToolResultEvent,
  ToolStreamUpdateEvent,
  AgentResultEvent,
  ModelStreamUpdateEvent,
} from './hooks/index.js'
export type { HookCallback, HookableEventConstructor, ModelStopResponse, Redaction } from './hooks/index.js'

// Plugin system
export type { Plugin } from './plugins/index.js'

// Conversation Manager
export {
  ConversationManager,
  type ConversationManagerReduceOptions,
} from './conversation-manager/conversation-manager.js'
export { NullConversationManager } from './conversation-manager/null-conversation-manager.js'
export {
  SlidingWindowConversationManager,
  type SlidingWindowConversationManagerConfig,
} from './conversation-manager/sliding-window-conversation-manager.js'

// Logging
export { configureLogging } from './logging/logger.js'
export type { Logger } from './logging/types.js'

// MCP Client types and implementations
export { type McpClientConfig, type TasksConfig, McpClient } from './mcp.js'

// Structured output
export { StructuredOutputException } from './structured-output/exceptions.js'

// Session management
export { SessionManager } from './session/session-manager.js'
export type { SessionManagerConfig, SaveLatestStrategy } from './session/session-manager.js'
export type { SnapshotManifest, SnapshotTriggerCallback, SnapshotTriggerParams } from './session/types.js'
export type { SessionStorage, SnapshotStorage, SnapshotLocation } from './session/storage.js'
export { FileStorage } from './session/file-storage.js'
export { S3Storage, type S3StorageConfig } from './session/s3-storage.js'
export type { Scope, Snapshot } from './agent/snapshot.js'

// Telemetry
export * as telemetry from './telemetry/index.js'

// Local Metrics
export { AgentMetrics } from './telemetry/meter.js'

// Multi-agent orchestration
export { Graph } from './multiagent/index.js'
export { Swarm } from './multiagent/index.js'
