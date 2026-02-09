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
export type { AgentData } from './types/agent.js'
export { AgentResult } from './types/agent.js'
export type { AgentResultMetrics } from './types/agent.js'
export type { AgentConfig, ToolList, InvokeOptions } from './agent/agent.js'

// Error types
export {
  ModelError,
  ContextWindowOverflowError,
  MaxTokensError,
  JsonValidationError,
  ConcurrentInvocationError,
  StructuredOutputError,
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

// AgentTool implementation
export { AgentTool } from './tools/agent-tool.js'
export type { AgentToolConfig } from './tools/agent-tool.js'

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
export type { BaseModelConfig, StreamOptions } from './models/model.js'

export { Model } from './models/model.js'

// Bedrock model provider
export { BedrockModel as BedrockModel } from './models/bedrock.js'
export type { BedrockModelConfig, BedrockModelOptions } from './models/bedrock.js'

// Agent streaming event types
export type { AgentStreamEvent } from './types/agent.js'

// Hooks system
export {
  HookRegistry,
  HookEvent,
  AgentInitializedEvent,
  BeforeInvocationEvent,
  AfterInvocationEvent,
  MessageAddedEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  BeforeToolsEvent,
  AfterToolsEvent,
  // ModelStreamEventHook # Disabled for now https://github.com/strands-agents/sdk-typescript/issues/288
} from './hooks/index.js'
export type { HookCallback, HookProvider, HookEventConstructor, ModelStopResponse } from './hooks/index.js'

// Conversation Manager
export { ConversationManager } from './conversation-manager/conversation-manager.js'
export { NullConversationManager } from './conversation-manager/null-conversation-manager.js'
export {
  SlidingWindowConversationManager,
  type SlidingWindowConversationManagerConfig,
} from './conversation-manager/sliding-window-conversation-manager.js'
export {
  SummarizingConversationManager,
  DEFAULT_SUMMARIZATION_PROMPT,
  type SummarizingConversationManagerConfig,
} from './conversation-manager/summarizing-conversation-manager.js'

// Logging
export { configureLogging } from './logging/logger.js'
export type { Logger } from './logging/types.js'

// MCP Client types and implementations
export { type McpClientConfig, McpClient } from './mcp.js'

// Session management
export { SessionManager } from './session/session-manager.js'
export type { SessionRepository } from './session/session-repository.js'
export { RepositorySessionManager, type RepositorySessionManagerConfig } from './session/repository-session-manager.js'
export { FileSessionManager, type FileSessionManagerConfig } from './session/file-session-manager.js'
export { S3SessionManager, type S3SessionManagerConfig } from './session/s3-session-manager.js'

// Interrupt system
export { Interrupt, InterruptException, InterruptState } from './interrupt.js'
export type { InterruptStateData } from './interrupt.js'
export type { InterruptResponse, InterruptResponseContent } from './types/interrupt.js'
export { isInterruptResponseArray } from './types/interrupt.js'

// Session types
export { SessionException } from './errors.js'
export {
  SESSION_TYPE_AGENT,
  createSession,
  createSessionAgent,
  createSessionMessage,
  sessionMessageToRecord,
  encodeBytesValues,
  decodeBytesValues,
} from './types/session.js'
export type { SessionData, SessionAgentData, SessionMessageData } from './types/session.js'

// Telemetry types
export type { AttributeValue } from './telemetry/types.js'
export { MetricsClient } from './telemetry/metrics.js'
export * as MetricsConstants from './telemetry/metrics-constants.js'

// Experimental: Agent Steering
export { Proceed, Guide, Interrupt as SteeringInterrupt } from './experimental/steering/core/action.js'
export type { ToolSteeringAction, ModelSteeringAction } from './experimental/steering/core/action.js'
export {
  SteeringContext,
  SteeringContextCallback,
  SteeringContextProvider,
} from './experimental/steering/core/context.js'
export { SteeringHandler } from './experimental/steering/core/handler.js'
export type { SteeringToolUse } from './experimental/steering/core/handler.js'
export { LLMSteeringHandler } from './experimental/steering/handlers/llm/llm-handler.js'
export type { LLMSteeringHandlerConfig } from './experimental/steering/handlers/llm/llm-handler.js'
export { DefaultPromptMapper } from './experimental/steering/handlers/llm/mappers.js'
export type { LLMPromptMapper } from './experimental/steering/handlers/llm/mappers.js'
export {
  LedgerProvider,
  LedgerBeforeToolCall,
  LedgerAfterToolCall,
} from './experimental/steering/context-providers/ledger-provider.js'

// Structured output
export { StructuredOutputTool } from './tools/structured-output/structured-output-tool.js'
export type {
  StructuredOutputToolConfig,
  StructuredOutputStoreResult,
} from './tools/structured-output/structured-output-tool.js'
export {
  StructuredOutputContext,
  DEFAULT_STRUCTURED_OUTPUT_PROMPT,
} from './tools/structured-output/structured-output-context.js'

// Multi-agent orchestration
export { Status, NodeResult, MultiAgentResult, MultiAgentBase } from './multiagent/base.js'
export type { MultiAgentInput, MultiAgentStreamEvent, MultiAgentInvokeOptions } from './multiagent/types.js'
export {
  MultiAgentNodeStartEvent,
  MultiAgentNodeStopEvent,
  MultiAgentNodeStreamEvent,
  MultiAgentHandoffEvent,
  MultiAgentNodeCancelEvent,
  MultiAgentNodeInterruptEvent,
  MultiAgentResultEvent,
} from './multiagent/streaming-events.js'
export { Swarm, SwarmNode, SharedContext, SwarmState, SwarmResult } from './multiagent/swarm.js'
export { Graph, GraphBuilder, GraphNode, GraphEdge, GraphState, GraphResult } from './multiagent/graph.js'
export type { GraphExecutor } from './multiagent/graph.js'
export {
  MultiAgentInitializedEvent,
  BeforeMultiAgentInvocationEvent,
  AfterMultiAgentInvocationEvent,
  BeforeNodeCallEvent,
  AfterNodeCallEvent,
} from './multiagent/hook-events.js'
