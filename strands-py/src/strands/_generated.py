"""Auto-generated from wit/*.wit. Do not edit.

Every type in this module is emitted from a WIT interface via
``componentize-py bindings``. Regenerate with: generate-types.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Union

@dataclass
class SlidingWindowConfig:
    """
    Sliding-window strategy: trim oldest messages once the conversation
    exceeds `window-size`.
    """
    window_size: int
    should_truncate_results: bool

@dataclass
class SummarizingConfig:
    """
    Summarizing strategy: once the conversation grows, summarize older
    messages into a single summary message and keep the rest verbatim.
    """
    summary_ratio: float
    preserve_recent_messages: int
    summarization_system_prompt: Optional[str]
    summarization_model: Optional[ModelConfig]

@dataclass
class ConversationManagerConfig_None_:
    pass

@dataclass
class ConversationManagerConfig_SlidingWindow:
    value: SlidingWindowConfig

@dataclass
class ConversationManagerConfig_Summarizing:
    value: SummarizingConfig

ConversationManagerConfig = Union[ConversationManagerConfig_None_, ConversationManagerConfig_SlidingWindow, ConversationManagerConfig_Summarizing]
@dataclass
class EdgeHandlerError_Unknown:
    value: str

@dataclass
class EdgeHandlerError_Failed:
    value: str

EdgeHandlerError = Union[EdgeHandlerError_Unknown, EdgeHandlerError_Failed]

@dataclass
class HandlerState:
    """
    State snapshot passed to `evaluate` so the handler can branch on
    prior node results.
    """
    results: List[NodeResult]
    execution_count: int
@dataclass
class ElicitRequest:
    """
    Request for user input.
    """
    client_id: str
    message: str
    request: str

class ElicitAction(Enum):
    """
    Outcome of an elicitation request.
    """
    ACCEPT = 0
    DECLINE = 1
    CANCEL = 2

@dataclass
class ElicitResponse:
    """
    Response to an elicitation request.
    """
    action: ElicitAction
    content: Optional[str]

@dataclass
class ElicitationError_UnknownClient:
    value: str

@dataclass
class ElicitationError_HandlerFailed:
    value: str

@dataclass
class ElicitationError_TimedOut:
    pass

ElicitationError = Union[ElicitationError_UnknownClient, ElicitationError_HandlerFailed, ElicitationError_TimedOut]
class LogLevel(Enum):
    """
    Severity level of a log entry.
    """
    TRACE = 0
    DEBUG = 1
    INFO = 2
    WARN = 3
    ERROR = 4

@dataclass
class LogEntry:
    """
    A single structured log entry.
    """
    level: LogLevel
    message: str
    context: Optional[str]
class McpConnectionState(Enum):
    """
    Connection state of an MCP client.
    """
    DISCONNECTED = 0
    CONNECTED = 1
    FAILED = 2

@dataclass
class EnvVar:
    """
    Single environment variable entry.
    """
    key: str
    value: str

@dataclass
class StdioTransportConfig:
    """
    STDIO transport configuration.
    """
    command: str
    args: List[str]
    env: List[EnvVar]
    cwd: Optional[str]

@dataclass
class HttpHeader:
    """
    Single HTTP header entry.
    """
    name: str
    value: str

@dataclass
class HttpTransportConfig:
    """
    HTTP transport configuration.
    """
    url: str
    headers: List[HttpHeader]

@dataclass
class SseTransportConfig:
    """
    SSE transport configuration.
    """
    url: str
    headers: List[HttpHeader]

@dataclass
class McpTransport_Stdio:
    value: StdioTransportConfig

@dataclass
class McpTransport_StreamableHttp:
    value: HttpTransportConfig

@dataclass
class McpTransport_Sse:
    value: SseTransportConfig

McpTransport = Union[McpTransport_Stdio, McpTransport_StreamableHttp, McpTransport_Sse]

@dataclass
class TasksConfig:
    """
    Task-augmented tool execution. Enables long-running tools with
    progress tracking. Experimental in the MCP specification.
    """
    ttl: int
    poll_timeout: int

@dataclass
class McpClientConfig:
    """
    MCP client configuration.
    """
    client_id: str
    application_name: Optional[str]
    application_version: Optional[str]
    transport: McpTransport
    tasks_config: Optional[TasksConfig]
    elicitation_enabled: bool
    fail_open: bool
    disable_instrumentation: bool
@dataclass
class TextBlock:
    """
    Plain text.
    """
    text: str

@dataclass
class S3Location:
    """
    Object stored in Amazon S3.
    """
    uri: str
    bucket_owner: Optional[str]

@dataclass
class ImageSource_Bytes:
    value: bytes

@dataclass
class ImageSource_Url:
    value: str

@dataclass
class ImageSource_S3:
    value: S3Location

ImageSource = Union[ImageSource_Bytes, ImageSource_Url, ImageSource_S3]

@dataclass
class ImageBlock:
    """
    Image attached to a message.
    """
    format: str
    source: ImageSource

@dataclass
class VideoSource_Bytes:
    value: bytes

@dataclass
class VideoSource_S3:
    value: S3Location

VideoSource = Union[VideoSource_Bytes, VideoSource_S3]

@dataclass
class VideoBlock:
    """
    Video attached to a message.
    """
    format: str
    source: VideoSource

@dataclass
class DocumentSource_Bytes:
    value: bytes

@dataclass
class DocumentSource_Text:
    value: str

@dataclass
class DocumentSource_Content:
    value: List[TextBlock]

@dataclass
class DocumentSource_S3:
    value: S3Location

DocumentSource = Union[DocumentSource_Bytes, DocumentSource_Text, DocumentSource_Content, DocumentSource_S3]

@dataclass
class DocumentCitationsConfig:
    """
    Citation configuration attached to a document.
    """
    enabled: bool

@dataclass
class DocumentBlock:
    """
    Document attached to a message.
    """
    name: str
    format: str
    source: DocumentSource
    citations: Optional[DocumentCitationsConfig]
    context: Optional[str]

@dataclass
class ReasoningBlock:
    """
    Model's thought process. Either plain reasoning (with an optional
    signature) or an opaque redacted blob.
    """
    text: Optional[str]
    signature: Optional[str]
    redacted_content: Optional[bytes]

class CacheKind(Enum):
    """
    Prompt-caching kind. More arms will be added as providers surface
    additional cache tiers (e.g. Anthropic's `ephemeral`).
    """
    DEFAULT_CACHE = 0

@dataclass
class CachePointBlock:
    """
    Marks a caching boundary in the prompt.
    """
    kind: CacheKind

class GuardQualifier(Enum):
    """
    How a piece of guard content should be evaluated.
    """
    GROUNDING_SOURCE = 0
    QUERY = 1
    GUARD_CONTENT = 2

@dataclass
class GuardContentText:
    """
    Text submitted to a guardrail for evaluation.
    """
    qualifiers: List[GuardQualifier]
    text: str

@dataclass
class GuardContentImage:
    """
    Image submitted to a guardrail for evaluation.
    """
    format: str
    bytes: bytes

@dataclass
class GuardContentBlock_Text:
    value: GuardContentText

@dataclass
class GuardContentBlock_Image:
    value: GuardContentImage

GuardContentBlock = Union[GuardContentBlock_Text, GuardContentBlock_Image]

@dataclass
class DocumentRange:
    """
    Range within a source document (characters, pages, or chunks).
    """
    document_index: int
    start: int
    end: int

@dataclass
class SearchResultRange:
    """
    Range within a search result.
    """
    search_result_index: int
    start: int
    end: int

@dataclass
class WebLocation:
    """
    Web citation target.
    """
    url: str
    domain: Optional[str]

@dataclass
class CitationLocation_DocumentChar:
    value: DocumentRange

@dataclass
class CitationLocation_DocumentPage:
    value: DocumentRange

@dataclass
class CitationLocation_DocumentChunk:
    value: DocumentRange

@dataclass
class CitationLocation_SearchResult:
    value: SearchResultRange

@dataclass
class CitationLocation_Web:
    value: WebLocation

CitationLocation = Union[CitationLocation_DocumentChar, CitationLocation_DocumentPage, CitationLocation_DocumentChunk, CitationLocation_SearchResult, CitationLocation_Web]

@dataclass
class CitationText:
    """
    Text fragment from a source or a generated answer.
    """
    text: str

@dataclass
class Citation:
    """
    Link from generated content back to a source location.
    """
    location: CitationLocation
    source: str
    source_content: List[CitationText]
    title: str

@dataclass
class CitationsBlock:
    """
    Citations emitted by the model when citations are enabled.
    """
    citations: List[Citation]
    content: List[CitationText]

@dataclass
class ToolUseBlock:
    """
    Model's request to call a tool.
    """
    name: str
    tool_use_id: str
    input: str
    reasoning_signature: Optional[str]

class ToolResultStatus(Enum):
    """
    Whether a tool invocation succeeded. Richer failure classification
    (cancelled, timed-out, invalid-input) lives on `tool-error`
    and is carried on `lifecycle-event::after-tool-call.error` or on a
    failed `tool-stream-event::error`.
    """
    SUCCESS = 0
    ERROR = 1

@dataclass
class JsonBlock:
    """
    Structured JSON payload. Used for tool results and agent-as-tool
    outputs that carry schema-validated data, not prose.
    """
    json: str

@dataclass
class ToolResultContent_Text:
    value: TextBlock

@dataclass
class ToolResultContent_Json:
    value: JsonBlock

@dataclass
class ToolResultContent_Image:
    value: ImageBlock

@dataclass
class ToolResultContent_Video:
    value: VideoBlock

@dataclass
class ToolResultContent_Document:
    value: DocumentBlock

ToolResultContent = Union[ToolResultContent_Text, ToolResultContent_Json, ToolResultContent_Image, ToolResultContent_Video, ToolResultContent_Document]

@dataclass
class ToolResultBlock:
    """
    Outcome of a tool execution.
    """
    tool_use_id: str
    status: ToolResultStatus
    content: List[ToolResultContent]

@dataclass
class InterruptResponseBlock:
    """
    User response to a previously-raised interrupt. Supplied on the
    next invocation to resume the paused agent.
    """
    interrupt_id: str
    response: str

@dataclass
class ContentBlock_Text:
    value: TextBlock

@dataclass
class ContentBlock_Json:
    value: JsonBlock

@dataclass
class ContentBlock_ToolUse:
    value: ToolUseBlock

@dataclass
class ContentBlock_ToolResult:
    value: ToolResultBlock

@dataclass
class ContentBlock_Reasoning:
    value: ReasoningBlock

@dataclass
class ContentBlock_CachePoint:
    value: CachePointBlock

@dataclass
class ContentBlock_GuardContent:
    value: GuardContentBlock

@dataclass
class ContentBlock_Image:
    value: ImageBlock

@dataclass
class ContentBlock_Video:
    value: VideoBlock

@dataclass
class ContentBlock_Document:
    value: DocumentBlock

@dataclass
class ContentBlock_Citations:
    value: CitationsBlock

@dataclass
class ContentBlock_InterruptResponse:
    value: InterruptResponseBlock

ContentBlock = Union[ContentBlock_Text, ContentBlock_Json, ContentBlock_ToolUse, ContentBlock_ToolResult, ContentBlock_Reasoning, ContentBlock_CachePoint, ContentBlock_GuardContent, ContentBlock_Image, ContentBlock_Video, ContentBlock_Document, ContentBlock_Citations, ContentBlock_InterruptResponse]

class Role(Enum):
    """
    Who a message is from.
    """
    USER = 0
    ASSISTANT = 1

@dataclass
class Usage:
    """
    Token consumption for a model invocation.
    """
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cache_read_input_tokens: Optional[int]
    cache_write_input_tokens: Optional[int]

@dataclass
class Metrics:
    """
    Performance metrics for a model invocation.
    """
    latency_ms: float

@dataclass
class MessageMetadata:
    """
    Metadata attached to a message. Not sent to model providers; persisted
    alongside the message for bookkeeping.
    """
    usage: Optional[Usage]
    metrics: Optional[Metrics]
    custom: Optional[str]

@dataclass
class Message:
    """
    A complete message in a 
    """
    role: Role
    content: List[ContentBlock]
    metadata: Optional[MessageMetadata]

@dataclass
class PromptInput_Text:
    value: str

@dataclass
class PromptInput_Blocks:
    value: List[ContentBlock]

PromptInput = Union[PromptInput_Text, PromptInput_Blocks]
@dataclass
class ModelStreamOptions:
    """
    Options passed alongside the messages on each streaming call.
    """
    system_prompt: Optional[PromptInput]
    tools: Optional[List[ToolSpec]]
    tool_choice: Optional[ToolChoice]

@dataclass
class StartStreamArgs:
    """
    Arguments for `start-stream`.
    """
    provider_id: str
    messages: List[Message]
    options: ModelStreamOptions

@dataclass
class CountTokensArgs:
    """
    Arguments for `count-tokens`.
    """
    provider_id: str
    messages: List[Message]
    system_prompt: Optional[PromptInput]
    tools: Optional[List[ToolSpec]]
@dataclass
class AnthropicConfig:
    """
    Anthropic API model configuration.
    """
    model_id: Optional[str]
    api_key: Optional[str]
    additional_config: Optional[str]

@dataclass
class BedrockConfig:
    """
    AWS Bedrock model configuration.
    """
    model_id: str
    region: Optional[str]
    access_key_id: Optional[str]
    secret_access_key: Optional[str]
    session_token: Optional[str]
    additional_config: Optional[str]

@dataclass
class OpenaiConfig:
    """
    OpenAI API model configuration.
    """
    model_id: Optional[str]
    api_key: Optional[str]
    additional_config: Optional[str]

@dataclass
class GeminiConfig:
    """
    Google Gemini API model configuration.
    """
    model_id: Optional[str]
    api_key: Optional[str]
    additional_config: Optional[str]

@dataclass
class CustomModelConfig:
    """
    Custom model provider supplied by your application.
    """
    provider_id: str
    model_id: Optional[str]
    additional_config: Optional[str]
    stateful: bool

@dataclass
class ModelConfig_Anthropic:
    value: AnthropicConfig

@dataclass
class ModelConfig_Bedrock:
    value: BedrockConfig

@dataclass
class ModelConfig_Openai:
    value: OpenaiConfig

@dataclass
class ModelConfig_Gemini:
    value: GeminiConfig

@dataclass
class ModelConfig_Custom:
    value: CustomModelConfig

ModelConfig = Union[ModelConfig_Anthropic, ModelConfig_Bedrock, ModelConfig_Openai, ModelConfig_Gemini, ModelConfig_Custom]

@dataclass
class ModelParams:
    """
    Sampling parameters applied to every call on the chosen provider.
    """
    max_tokens: Optional[int]
    temperature: Optional[float]
    top_p: Optional[float]

@dataclass
class ModelError_UnknownProvider:
    value: str

@dataclass
class ModelError_InvalidRequest:
    value: str

@dataclass
class ModelError_Unauthorized:
    value: str

@dataclass
class ModelError_Throttled:
    value: str

@dataclass
class ModelError_ServerError:
    value: str

@dataclass
class ModelError_ContextWindowExceeded:
    pass

@dataclass
class ModelError_ContentFiltered:
    value: str

@dataclass
class ModelError_Transient:
    value: str

@dataclass
class ModelError_Internal:
    value: str

ModelError = Union[ModelError_UnknownProvider, ModelError_InvalidRequest, ModelError_Unauthorized, ModelError_Throttled, ModelError_ServerError, ModelError_ContextWindowExceeded, ModelError_ContentFiltered, ModelError_Transient, ModelError_Internal]
class OrchestrationStatus(Enum):
    """
    Lifecycle status of a node or overall run.
    """
    PENDING = 0
    EXECUTING = 1
    COMPLETED = 2
    FAILED = 3
    CANCELLED = 4

class TerminalStatus(Enum):
    """
    Terminal status of a node or run.
    """
    COMPLETED = 0
    FAILED = 1
    CANCELLED = 2

class NodeKind(Enum):
    """
    What a node is.
    """
    AGENT = 0
    MULTI_AGENT = 1

@dataclass
class AgentNodeConfig:
    """
    Definition of an agent-backed node.
    """
    id: str
    description: Optional[str]
    timeout: Optional[int]
    agent_config: str

@dataclass
class MultiAgentNodeConfig:
    """
    Definition of a node that wraps another orchestrator.
    """
    id: str
    description: Optional[str]
    orchestrator: str

@dataclass
class NodeConfig_Agent:
    value: AgentNodeConfig

@dataclass
class NodeConfig_MultiAgent:
    value: MultiAgentNodeConfig

NodeConfig = Union[NodeConfig_Agent, NodeConfig_MultiAgent]

@dataclass
class EdgeHandler:
    """
    Condition attached to a graph edge.
    """
    handler_id: str

@dataclass
class EdgeConfig:
    """
    Edge connecting two graph nodes.
    """
    source: str
    target: str
    handler: Optional[EdgeHandler]

@dataclass
class GraphConfig:
    """
    Runtime configuration for a Graph.
    """
    id: str
    nodes: List[NodeConfig]
    edges: List[EdgeConfig]
    sources: List[str]
    max_concurrency: Optional[int]
    max_steps: Optional[int]
    timeout: Optional[int]
    node_timeout: Optional[int]

@dataclass
class SwarmConfig:
    """
    Runtime configuration for a Swarm.
    """
    id: str
    nodes: List[AgentNodeConfig]
    start_node_id: str
    max_steps: Optional[int]
    timeout: Optional[int]
    node_timeout: Optional[int]

@dataclass
class NodeError_Execution:
    value: str

@dataclass
class NodeError_Timeout:
    pass

@dataclass
class NodeError_LimitExceeded:
    value: str

@dataclass
class NodeError_EdgeHandler:
    value: str

@dataclass
class NodeError_InvalidConfig:
    value: str

@dataclass
class NodeError_Internal:
    value: str

NodeError = Union[NodeError_Execution, NodeError_Timeout, NodeError_LimitExceeded, NodeError_EdgeHandler, NodeError_InvalidConfig, NodeError_Internal]

@dataclass
class NodeResult:
    """
    Result of a single node execution.
    """
    node_id: str
    status: TerminalStatus
    duration: int
    content: List[ContentBlock]
    error: Optional[NodeError]
    structured_output: Optional[str]
    usage: Optional[Usage]
    metrics: Optional[Metrics]

@dataclass
class MultiAgentResult:
    """
    Final result of a graph or swarm run.
    """
    status: TerminalStatus
    nodes: List[NodeResult]
    duration: int
    usage: Optional[Usage]
    metrics: Optional[Metrics]

@dataclass
class MultiAgentInvokeArgs:
    """
    Arguments for invoking a graph or swarm.
    """
    input: PromptInput
    invocation_state: Optional[str]

@dataclass
class NodeStartData:
    """
    Payload for `node-start`.
    """
    node_id: str
    kind: NodeKind

@dataclass
class NodeEventData:
    """
    Payload for `node-event`. Carries a nested stream event from a
    running node.
    """
    node_id: str
    event: StreamEvent

@dataclass
class HandoffEvent:
    """
    Payload for a handoff edge firing.
    """
    from_node_ids: List[str]
    to_node_ids: List[str]

@dataclass
class MultiAgentStreamEvent_NodeStart:
    value: NodeStartData

@dataclass
class MultiAgentStreamEvent_Nested:
    value: NodeEventData

@dataclass
class MultiAgentStreamEvent_NodeStop:
    value: NodeResult

@dataclass
class MultiAgentStreamEvent_Handoff:
    value: HandoffEvent

@dataclass
class MultiAgentStreamEvent_RunComplete:
    value: MultiAgentResult

MultiAgentStreamEvent = Union[MultiAgentStreamEvent_NodeStart, MultiAgentStreamEvent_Nested, MultiAgentStreamEvent_NodeStop, MultiAgentStreamEvent_Handoff, MultiAgentStreamEvent_RunComplete]
class JitterKind(Enum):
    """
    How much random variation to apply to computed delays.
    """
    NONE = 0
    FULL = 1
    EQUAL = 2
    DECORRELATED = 3

@dataclass
class ConstantBackoffConfig:
    """
    Fixed delay between attempts.
    """
    delay: int

@dataclass
class LinearBackoffConfig:
    """
    Delay grows linearly with attempt number.
    """
    base: int
    max: int
    jitter: JitterKind

@dataclass
class ExponentialBackoffConfig:
    """
    Delay grows exponentially with attempt number.
    """
    base: int
    max: int
    factor: float
    jitter: JitterKind

@dataclass
class BackoffStrategy_Constant:
    value: ConstantBackoffConfig

@dataclass
class BackoffStrategy_Linear:
    value: LinearBackoffConfig

@dataclass
class BackoffStrategy_Exponential:
    value: ExponentialBackoffConfig

BackoffStrategy = Union[BackoffStrategy_Constant, BackoffStrategy_Linear, BackoffStrategy_Exponential]

@dataclass
class ModelRetryStrategy:
    """
    A single retry strategy for model calls.
    
    Defaults approximate the TS `DefaultModelRetryStrategy`: exponential
    backoff with full jitter, capped at 6 attempts.
    """
    max_attempts: int
    backoff: BackoffStrategy
    total_budget: Optional[int]

@dataclass
class RetryConfig:
    """
    Retry configuration attached to an agent.
    
    Strategies compose: every strategy observes every failure, and a
    retry is attempted if any strategy requests one. The first strategy
    to request a delay wins. Registration order does not affect
    correctness. Supplying two strategies with the same `backoff` arm
    is almost certainly a mistake and may surface as
    `agent-error::invalid-input`.
    
    An empty list disables retries; omitting the config from
    `agent-config.retry` applies a default single `exponential` strategy.
    """
    strategies: List[ModelRetryStrategy]
@dataclass
class FileStorageConfig:
    """
    Local filesystem snapshot storage.
    """
    base_dir: str

@dataclass
class S3StorageConfig:
    """
    S3 snapshot storage.
    """
    bucket: str
    region: Optional[str]
    prefix: Optional[str]

@dataclass
class CustomStorageConfig:
    """
    Reference to an application-implemented storage backend.
    """
    backend_id: str

@dataclass
class StorageConfig_File:
    value: FileStorageConfig

@dataclass
class StorageConfig_S3:
    value: S3StorageConfig

@dataclass
class StorageConfig_Custom:
    value: CustomStorageConfig

StorageConfig = Union[StorageConfig_File, StorageConfig_S3, StorageConfig_Custom]

@dataclass
class SaveLatestPolicy_Message:
    pass

@dataclass
class SaveLatestPolicy_Invocation:
    pass

@dataclass
class SaveLatestPolicy_Trigger:
    value: str

SaveLatestPolicy = Union[SaveLatestPolicy_Message, SaveLatestPolicy_Invocation, SaveLatestPolicy_Trigger]

@dataclass
class SessionConfig:
    """
    Session persistence configuration attached to an agent.
    """
    session_id: str
    storage: StorageConfig
    save_latest: Optional[SaveLatestPolicy]

class SnapshotScope(Enum):
    """
    Which kind of state a snapshot describes.
    """
    AGENT = 0
    MULTI_AGENT = 1

@dataclass
class SnapshotLocation:
    """
    Locator for a snapshot within the storage hierarchy.
    """
    session_id: str
    scope: SnapshotScope
    scope_id: str

@dataclass
class SlidingWindowState:
    """
    Sliding-window conversation manager state at snapshot time.
    """
    removed_message_count: int

@dataclass
class SummarizingState:
    """
    Summarizing conversation manager state at snapshot time.
    """
    summary_message: Optional[Message]
    removed_message_count: int

@dataclass
class ConversationManagerState_None_:
    pass

@dataclass
class ConversationManagerState_SlidingWindow:
    value: SlidingWindowState

@dataclass
class ConversationManagerState_Summarizing:
    value: SummarizingState

ConversationManagerState = Union[ConversationManagerState_None_, ConversationManagerState_SlidingWindow, ConversationManagerState_Summarizing]

@dataclass
class RetryStrategyState:
    """
    Retry-strategy state at snapshot time.
    """
    attempts_used: int
    elapsed_ms: int

@dataclass
class PluginStateEntry:
    """
    Named piece of plugin state. Plugins identify themselves by
    `plugin-name`; `data` is an opaque JSON object specific to that
    plugin. Used for user-authored plugins and for vended plugins whose
    state isn't modeled explicitly elsewhere.
    """
    plugin_name: str
    data: str

@dataclass
class SnapshotData:
    """
    Framework-owned snapshot state. All fields are optional because an
    agent may not exercise every subsystem in a given run.
    """
    messages: List[Message]
    conversation_manager: Optional[ConversationManagerState]
    retry_strategy: Optional[RetryStrategyState]
    model_state: Optional[str]
    plugins: List[PluginStateEntry]

@dataclass
class Snapshot:
    """
    Point-in-time capture of agent or orchestrator state.
    """
    scope: SnapshotScope
    schema_version: str
    created_at: Datetime
    data: SnapshotData
    app_data: str

@dataclass
class SnapshotManifest:
    """
    Metadata describing the snapshot manifest file.
    """
    schema_version: str
    updated_at: Datetime

@dataclass
class StorageError_NotFound:
    pass

@dataclass
class StorageError_AccessDenied:
    value: str

@dataclass
class StorageError_OutOfSpace:
    pass

@dataclass
class StorageError_Corrupt:
    value: str

@dataclass
class StorageError_Conflict:
    value: str

@dataclass
class StorageError_Transient:
    value: str

@dataclass
class StorageError_Permanent:
    value: str

@dataclass
class StorageError_UnknownBackend:
    value: str

StorageError = Union[StorageError_NotFound, StorageError_AccessDenied, StorageError_OutOfSpace, StorageError_Corrupt, StorageError_Conflict, StorageError_Transient, StorageError_Permanent, StorageError_UnknownBackend]
@dataclass
class SaveSnapshotArgs:
    """
    Arguments for `save-snapshot`.
    """
    backend_id: str
    location: SnapshotLocation
    snapshot_id: str
    is_latest: bool
    snapshot: Snapshot

@dataclass
class LoadSnapshotArgs:
    """
    Arguments for `load-snapshot`.
    """
    backend_id: str
    location: SnapshotLocation
    snapshot_id: Optional[str]

@dataclass
class ListSnapshotIdsArgs:
    """
    Arguments for `list-snapshot-ids`.
    """
    backend_id: str
    location: SnapshotLocation
    limit: Optional[int]
    start_after: Optional[str]

@dataclass
class DeleteSessionArgs:
    """
    Arguments for `delete-session`.
    """
    backend_id: str
    session_id: str

@dataclass
class ManifestArgs:
    """
    Arguments for `load-manifest` / `save-manifest`.
    """
    backend_id: str
    location: SnapshotLocation

@dataclass
class SaveManifestArgs:
    """
    Arguments for `save-manifest`.
    """
    backend_id: str
    location: SnapshotLocation
    manifest: SnapshotManifest
@dataclass
class TriggerParams:
    """
    Context passed to the trigger on each call.
    """
    trigger_id: str
    message_count: int
    last_message: Optional[Message]

@dataclass
class TriggerError_Unknown:
    value: str

@dataclass
class TriggerError_Failed:
    value: str

TriggerError = Union[TriggerError_Unknown, TriggerError_Failed]
@dataclass
class Interrupt:
    """
    Human-in-the-loop interrupt raised by a tool or hook.
    """
    id: str
    name: str
    reason: Optional[str]

class StopReason(Enum):
    """
    Why the model stopped generating.
    """
    END_TURN = 0
    TOOL_USE = 1
    MAX_TOKENS = 2
    ERROR = 3
    CONTENT_FILTERED = 4
    GUARDRAIL_INTERVENED = 5
    STOP_SEQUENCE = 6
    MODEL_CONTEXT_WINDOW_EXCEEDED = 7
    CANCELLED = 8

@dataclass
class MetadataEvent:
    """
    Usage and metrics accumulated so far.
    """
    usage: Optional[Usage]
    metrics: Optional[Metrics]

@dataclass
class TraceMetadataEntry:
    """
    Single key-value pair attached to a trace. Values are string-typed
    to keep traces compact; structured payloads belong on `message`.
    """
    key: str
    value: str

@dataclass
class AgentTrace:
    """
    In-memory trace node collected during an invocation. Traces form a
    tree linked by `parent-id`. Reconstruct the tree by grouping on
    that field.
    """
    id: str
    name: str
    parent_id: Optional[str]
    start_time_ms: int
    end_time_ms: Optional[int]
    duration_ms: int
    metadata: List[TraceMetadataEntry]
    message: Optional[Message]

@dataclass
class ToolMetrics:
    """
    Per-tool execution metrics keyed by tool name in `agent-metrics`.
    """
    tool_name: str
    call_count: int
    success_count: int
    error_count: int
    total_time_ms: int

@dataclass
class InvocationMetrics:
    """
    Per-invocation metrics. Cycles are flattened into `agent-metrics.cycles`
    and linked back via `invocation-id`.
    """
    invocation_id: str
    usage: Usage

@dataclass
class AgentLoopMetrics:
    """
    Per-cycle usage tracking.
    """
    cycle_id: str
    invocation_id: str
    duration_ms: int
    usage: Usage

@dataclass
class AgentMetrics:
    """
    Snapshot of agent metrics. Returned by `agent.get-metrics`.
    """
    cycle_count: int
    accumulated_usage: Usage
    accumulated_metrics: Metrics
    invocations: List[InvocationMetrics]
    cycles: List[AgentLoopMetrics]
    tool_metrics: List[ToolMetrics]
    latest_context_size: Optional[int]
    projected_context_size: Optional[int]

@dataclass
class ToolUseData:
    """
    Mutable tool-use descriptor carried on tool-call hook events. Matches
    the shape of the tool-use block the model emitted; `before-tool-call`
    hooks may rewrite fields before execution.
    """
    name: str
    tool_use_id: str
    input: str

@dataclass
class HookRedaction:
    """
    Redaction information when guardrails block content.
    """
    user_message: str

@dataclass
class ModelStopData:
    """
    Response from a model invocation containing the message and stop
    reason, surfaced on `after-model-call`.
    """
    message: Message
    stop_reason: StopReason
    redaction: Optional[HookRedaction]

@dataclass
class BeforeInvocationData:
    """
    Payload for `before-invocation`.
    """
    invocation_state: str

@dataclass
class AfterInvocationData:
    """
    Payload for `after-invocation`.
    """
    invocation_state: str

@dataclass
class MessageAddedData:
    """
    Payload for `message-added`.
    """
    message: Message

@dataclass
class BeforeModelCallData:
    """
    Payload for `before-model-call`.
    """
    projected_input_tokens: Optional[int]

@dataclass
class AfterModelCallData:
    """
    Payload for `after-model-call`.
    """
    attempt_count: int
    stop_data: Optional[ModelStopData]
    error: Optional[ModelError]

@dataclass
class BeforeToolCallData:
    """
    Payload for `before-tool-call`.
    """
    tool_use: ToolUseData

@dataclass
class AfterToolCallData:
    """
    Payload for `after-tool-call`.
    """
    tool_use: ToolUseData
    tool_result: ToolResultBlock
    error: Optional[ToolError]

@dataclass
class ToolsBatchData:
    """
    Payload for `before-tools` / `after-tools`.
    """
    message: Message

@dataclass
class ContentBlockData:
    """
    Payload for `content-block`.
    """
    content_block: ContentBlock

@dataclass
class ModelMessageData:
    """
    Payload for `model-message`.
    """
    message: Message
    stop_reason: StopReason

@dataclass
class ToolResultData:
    """
    Payload for `tool-result-hook`.
    """
    tool_result: ToolResultBlock

@dataclass
class ToolStreamUpdateData:
    """
    Payload for `tool-stream-update`.
    """
    data: str

@dataclass
class ModelStreamUpdateData:
    """
    Payload for `model-stream-update`.
    """
    event: str

@dataclass
class InputRedaction:
    """
    Input content redaction emitted when a guardrail blocks input.
    The original input is still available in the conversation history,
    so only the replacement is carried here.
    """
    replace_content: str

@dataclass
class OutputRedaction:
    """
    Output content redaction emitted when a guardrail blocks output.
    """
    redacted_content: Optional[str]
    replace_content: str

@dataclass
class RedactionEvent:
    """
    Redaction event emitted when a guardrail blocks content. Input and
    output redactions are independent fields. At least one is always
    present in practice; both may be present at once.
    """
    input_redaction: Optional[InputRedaction]
    output_redaction: Optional[OutputRedaction]

@dataclass
class StopEvent:
    """
    Terminal event for a stream.
    """
    reason: StopReason
    usage: Optional[Usage]
    metrics: Optional[Metrics]
    structured_output: Optional[str]

@dataclass
class AgentResultData:
    """
    Payload for `agent-result`.
    """
    stop: StopEvent

@dataclass
class StreamError_Model:
    value: ModelError

@dataclass
class StreamError_Tool:
    value: ToolError

@dataclass
class StreamError_ContextWindowExceeded:
    pass

@dataclass
class StreamError_MaxTokensReached:
    pass

@dataclass
class StreamError_StructuredOutputUnavailable:
    pass

@dataclass
class StreamError_Internal:
    value: str

StreamError = Union[StreamError_Model, StreamError_Tool, StreamError_ContextWindowExceeded, StreamError_MaxTokensReached, StreamError_StructuredOutputUnavailable, StreamError_Internal]

@dataclass
class StreamEvent_TextDelta:
    value: str

@dataclass
class StreamEvent_ToolUse:
    value: ToolUseBlock

@dataclass
class StreamEvent_ToolResult:
    value: ToolResultBlock

@dataclass
class StreamEvent_Content:
    value: ContentBlock

@dataclass
class StreamEvent_Metadata:
    value: MetadataEvent

@dataclass
class StreamEvent_Stop:
    value: StopEvent

@dataclass
class StreamEvent_Redaction:
    value: RedactionEvent

@dataclass
class StreamEvent_Error:
    value: StreamError

@dataclass
class StreamEvent_Interrupt:
    value: Interrupt

@dataclass
class StreamEvent_Initialized:
    pass

@dataclass
class StreamEvent_BeforeInvocation:
    value: BeforeInvocationData

@dataclass
class StreamEvent_AfterInvocation:
    value: AfterInvocationData

@dataclass
class StreamEvent_MessageAdded:
    value: MessageAddedData

@dataclass
class StreamEvent_BeforeModelCall:
    value: BeforeModelCallData

@dataclass
class StreamEvent_AfterModelCall:
    value: AfterModelCallData

@dataclass
class StreamEvent_BeforeTools:
    value: ToolsBatchData

@dataclass
class StreamEvent_AfterTools:
    value: ToolsBatchData

@dataclass
class StreamEvent_BeforeToolCall:
    value: BeforeToolCallData

@dataclass
class StreamEvent_AfterToolCall:
    value: AfterToolCallData

@dataclass
class StreamEvent_ContentBlock:
    value: ContentBlockData

@dataclass
class StreamEvent_ModelMessage:
    value: ModelMessageData

@dataclass
class StreamEvent_ToolResultHook:
    value: ToolResultData

@dataclass
class StreamEvent_ToolUpdate:
    value: ToolStreamUpdateData

@dataclass
class StreamEvent_ModelUpdate:
    value: ModelStreamUpdateData

@dataclass
class StreamEvent_AgentResult:
    value: AgentResultData

StreamEvent = Union[StreamEvent_TextDelta, StreamEvent_ToolUse, StreamEvent_ToolResult, StreamEvent_Content, StreamEvent_Metadata, StreamEvent_Stop, StreamEvent_Redaction, StreamEvent_Error, StreamEvent_Interrupt, StreamEvent_Initialized, StreamEvent_BeforeInvocation, StreamEvent_AfterInvocation, StreamEvent_MessageAdded, StreamEvent_BeforeModelCall, StreamEvent_AfterModelCall, StreamEvent_BeforeTools, StreamEvent_AfterTools, StreamEvent_BeforeToolCall, StreamEvent_AfterToolCall, StreamEvent_ContentBlock, StreamEvent_ModelMessage, StreamEvent_ToolResultHook, StreamEvent_ToolUpdate, StreamEvent_ModelUpdate, StreamEvent_AgentResult]
@dataclass
class ToolSpec:
    """
    Declaration of a tool the model can call.
    """
    name: str
    description: str
    input_schema: str

@dataclass
class AgentAsToolConfig:
    """
    Wrap a configured agent as a tool callable by the parent agent. The
    child agent is instantiated at registration time.
    """
    name: Optional[str]
    description: Optional[str]
    preserve_context: bool
    agent_config: str

@dataclass
class CallToolArgs:
    """
    Arguments for a single tool call.
    """
    name: str
    input: str
    tool_use_id: str

@dataclass
class ToolChoice_Auto:
    pass

@dataclass
class ToolChoice_Any:
    pass

@dataclass
class ToolChoice_Named:
    value: str

ToolChoice = Union[ToolChoice_Auto, ToolChoice_Any, ToolChoice_Named]

@dataclass
class ToolError_Unknown:
    value: str

@dataclass
class ToolError_InvalidInput:
    value: str

@dataclass
class ToolError_ExecutionFailed:
    value: str

@dataclass
class ToolError_TimedOut:
    pass

@dataclass
class ToolError_Cancelled:
    pass

@dataclass
class ToolError_Internal:
    value: str

ToolError = Union[ToolError_Unknown, ToolError_InvalidInput, ToolError_ExecutionFailed, ToolError_TimedOut, ToolError_Cancelled, ToolError_Internal]

@dataclass
class ToolStreamEvent_Data:
    value: str

@dataclass
class ToolStreamEvent_Complete:
    value: List[ToolResultContent]

@dataclass
class ToolStreamEvent_Error:
    value: ToolError

ToolStreamEvent = Union[ToolStreamEvent_Data, ToolStreamEvent_Complete, ToolStreamEvent_Error]
@dataclass
class BashToolConfig:
    """
    Bash tool configuration.
    """
    default_timeout_s: Optional[int]

@dataclass
class FileEditorToolConfig:
    """
    File editor tool configuration.
    """
    workspace_root: Optional[str]

@dataclass
class HttpRequestToolConfig:
    """
    HTTP request tool configuration.
    """
    allowed_hosts: List[str]
    max_response_bytes: int

@dataclass
class NotebookToolConfig:
    """
    Notebook tool configuration.
    """
    workspace_root: Optional[str]

@dataclass
class VendedTool_Bash:
    value: BashToolConfig

@dataclass
class VendedTool_FileEditor:
    value: FileEditorToolConfig

@dataclass
class VendedTool_HttpRequest:
    value: HttpRequestToolConfig

@dataclass
class VendedTool_Notebook:
    value: NotebookToolConfig

VendedTool = Union[VendedTool_Bash, VendedTool_FileEditor, VendedTool_HttpRequest, VendedTool_Notebook]

@dataclass
class SkillSource:
    """
    Location of a skill definition on disk.
    """
    path: str

@dataclass
class SkillsPluginConfig:
    """
    Skills plugin configuration.
    """
    skills: List[SkillSource]
    strict: bool
    max_resource_files: Optional[int]
    state_key: Optional[str]

@dataclass
class ContextOffloaderPluginConfig:
    """
    Context offloader plugin configuration.
    """
    max_result_tokens: Optional[int]
    preview_tokens: Optional[int]
    include_retrieval_tool: bool

@dataclass
class VendedPlugin_Skills:
    value: SkillsPluginConfig

@dataclass
class VendedPlugin_ContextOffloader:
    value: ContextOffloaderPluginConfig

VendedPlugin = Union[VendedPlugin_Skills, VendedPlugin_ContextOffloader]
@dataclass
class Datetime:
    """
    A time and date in seconds plus nanoseconds.
    """
    seconds: int
    nanoseconds: int
@dataclass
class ConcurrentOptions:
    """
    Concurrent-execution options.
    """
    max_concurrency: Optional[int]

@dataclass
class ToolExecutorStrategy_Sequential:
    pass

@dataclass
class ToolExecutorStrategy_Concurrent:
    value: ConcurrentOptions

ToolExecutorStrategy = Union[ToolExecutorStrategy_Sequential, ToolExecutorStrategy_Concurrent]

@dataclass
class AttributeValue_StringValue:
    value: str

@dataclass
class AttributeValue_IntValue:
    value: int

@dataclass
class AttributeValue_DoubleValue:
    value: float

@dataclass
class AttributeValue_BoolValue:
    value: bool

AttributeValue = Union[AttributeValue_StringValue, AttributeValue_IntValue, AttributeValue_DoubleValue, AttributeValue_BoolValue]

@dataclass
class TraceAttribute:
    """
    Single key-value pair attached to every OpenTelemetry span the
    agent emits. The OTEL-typed `attribute-value` distinguishes these
    from `trace-metadata-entry`, which annotates local
    in-memory trace nodes and only carries strings.
    """
    key: str
    value: AttributeValue

@dataclass
class TraceContext:
    """
    W3C Trace Context propagation headers. Links the agent's spans to a
    caller-supplied trace.
    """
    traceparent: str
    tracestate: Optional[str]

@dataclass
class AgentIdentity:
    """
    Display-level identity of the agent. All fields are optional and
    fall back to sensible defaults.
    """
    name: Optional[str]
    id: Optional[str]
    description: Optional[str]

@dataclass
class AgentConfig:
    """
    Configuration passed to the `agent` constructor.
    
    Invalid configuration is not reported here (resource constructors
    cannot return `result`); errors surface on the first `generate`
    call as `agent-error::invalid-input`.
    """
    model: Optional[ModelConfig]
    model_params: Optional[ModelParams]
    messages: Optional[List[Message]]
    system_prompt: Optional[PromptInput]
    tools: Optional[List[ToolSpec]]
    agent_tools: Optional[List[AgentAsToolConfig]]
    vended_tools: Optional[List[VendedTool]]
    vended_plugins: Optional[List[VendedPlugin]]
    mcp_clients: Optional[List[McpClientConfig]]
    identity: Optional[AgentIdentity]
    tool_executor: Optional[ToolExecutorStrategy]
    display_output: Optional[bool]
    trace_attributes: Optional[List[TraceAttribute]]
    trace_context: Optional[TraceContext]
    session: Optional[SessionConfig]
    conversation_manager: Optional[ConversationManagerConfig]
    retry: Optional[RetryConfig]
    structured_output_schema: Optional[str]
    app_state: Optional[str]
    model_state: Optional[str]

@dataclass
class InvokeArgs:
    """
    Arguments for `agent.generate`.
    """
    input: PromptInput
    tools: Optional[List[ToolSpec]]
    tool_choice: Optional[ToolChoice]
    structured_output_schema: Optional[str]

@dataclass
class RespondArgs:
    """
    Payload supplied when resuming from a human-in-the-loop interrupt.
    """
    interrupt_id: str
    response: str

@dataclass
class AgentError_NoSessionConfigured:
    pass

@dataclass
class AgentError_Storage:
    value: StorageError

@dataclass
class AgentError_InvalidInput:
    value: str

@dataclass
class AgentError_UnknownInterrupt:
    value: str

@dataclass
class AgentError_Internal:
    value: str

AgentError = Union[AgentError_NoSessionConfigured, AgentError_Storage, AgentError_InvalidInput, AgentError_UnknownInterrupt, AgentError_Internal]

AgentErrorInternal = AgentError_Internal
AgentErrorInvalidInput = AgentError_InvalidInput
AgentErrorNoSessionConfigured = AgentError_NoSessionConfigured
AgentErrorStorage = AgentError_Storage
AgentErrorUnknownInterrupt = AgentError_UnknownInterrupt
AttributeValueBoolValue = AttributeValue_BoolValue
AttributeValueDoubleValue = AttributeValue_DoubleValue
AttributeValueIntValue = AttributeValue_IntValue
AttributeValueStringValue = AttributeValue_StringValue
BackoffStrategyConstant = BackoffStrategy_Constant
BackoffStrategyExponential = BackoffStrategy_Exponential
BackoffStrategyLinear = BackoffStrategy_Linear
CitationLocationDocumentChar = CitationLocation_DocumentChar
CitationLocationDocumentChunk = CitationLocation_DocumentChunk
CitationLocationDocumentPage = CitationLocation_DocumentPage
CitationLocationSearchResult = CitationLocation_SearchResult
CitationLocationWeb = CitationLocation_Web
ContentBlockCachePoint = ContentBlock_CachePoint
ContentBlockCitations = ContentBlock_Citations
ContentBlockDocument = ContentBlock_Document
ContentBlockGuardContent = ContentBlock_GuardContent
ContentBlockImage = ContentBlock_Image
ContentBlockInterruptResponse = ContentBlock_InterruptResponse
ContentBlockJson = ContentBlock_Json
ContentBlockReasoning = ContentBlock_Reasoning
ContentBlockText = ContentBlock_Text
ContentBlockToolResult = ContentBlock_ToolResult
ContentBlockToolUse = ContentBlock_ToolUse
ContentBlockVideo = ContentBlock_Video
ConversationManagerConfigNone = ConversationManagerConfig_None_
ConversationManagerConfigSlidingWindow = ConversationManagerConfig_SlidingWindow
ConversationManagerConfigSummarizing = ConversationManagerConfig_Summarizing
ConversationManagerStateNone = ConversationManagerState_None_
ConversationManagerStateSlidingWindow = ConversationManagerState_SlidingWindow
ConversationManagerStateSummarizing = ConversationManagerState_Summarizing
DocumentSourceBytes = DocumentSource_Bytes
DocumentSourceContent = DocumentSource_Content
DocumentSourceS3 = DocumentSource_S3
DocumentSourceText = DocumentSource_Text
EdgeHandlerErrorFailed = EdgeHandlerError_Failed
EdgeHandlerErrorUnknown = EdgeHandlerError_Unknown
ElicitationErrorHandlerFailed = ElicitationError_HandlerFailed
ElicitationErrorTimedOut = ElicitationError_TimedOut
ElicitationErrorUnknownClient = ElicitationError_UnknownClient
GuardContentBlockImage = GuardContentBlock_Image
GuardContentBlockText = GuardContentBlock_Text
ImageSourceBytes = ImageSource_Bytes
ImageSourceS3 = ImageSource_S3
ImageSourceUrl = ImageSource_Url
McpTransportSse = McpTransport_Sse
McpTransportStdio = McpTransport_Stdio
McpTransportStreamableHttp = McpTransport_StreamableHttp
ModelConfigAnthropic = ModelConfig_Anthropic
ModelConfigBedrock = ModelConfig_Bedrock
ModelConfigCustom = ModelConfig_Custom
ModelConfigGemini = ModelConfig_Gemini
ModelConfigOpenai = ModelConfig_Openai
ModelErrorContentFiltered = ModelError_ContentFiltered
ModelErrorContextWindowExceeded = ModelError_ContextWindowExceeded
ModelErrorInternal = ModelError_Internal
ModelErrorInvalidRequest = ModelError_InvalidRequest
ModelErrorServerError = ModelError_ServerError
ModelErrorThrottled = ModelError_Throttled
ModelErrorTransient = ModelError_Transient
ModelErrorUnauthorized = ModelError_Unauthorized
ModelErrorUnknownProvider = ModelError_UnknownProvider
MultiAgentStreamEventHandoff = MultiAgentStreamEvent_Handoff
MultiAgentStreamEventNested = MultiAgentStreamEvent_Nested
MultiAgentStreamEventNodeStart = MultiAgentStreamEvent_NodeStart
MultiAgentStreamEventNodeStop = MultiAgentStreamEvent_NodeStop
MultiAgentStreamEventRunComplete = MultiAgentStreamEvent_RunComplete
NodeConfigAgent = NodeConfig_Agent
NodeConfigMultiAgent = NodeConfig_MultiAgent
NodeErrorEdgeHandler = NodeError_EdgeHandler
NodeErrorExecution = NodeError_Execution
NodeErrorInternal = NodeError_Internal
NodeErrorInvalidConfig = NodeError_InvalidConfig
NodeErrorLimitExceeded = NodeError_LimitExceeded
NodeErrorTimeout = NodeError_Timeout
PromptInputBlocks = PromptInput_Blocks
PromptInputText = PromptInput_Text
SaveLatestPolicyInvocation = SaveLatestPolicy_Invocation
SaveLatestPolicyMessage = SaveLatestPolicy_Message
SaveLatestPolicyTrigger = SaveLatestPolicy_Trigger
StorageConfigCustom = StorageConfig_Custom
StorageConfigFile = StorageConfig_File
StorageConfigS3 = StorageConfig_S3
StorageErrorAccessDenied = StorageError_AccessDenied
StorageErrorConflict = StorageError_Conflict
StorageErrorCorrupt = StorageError_Corrupt
StorageErrorNotFound = StorageError_NotFound
StorageErrorOutOfSpace = StorageError_OutOfSpace
StorageErrorPermanent = StorageError_Permanent
StorageErrorTransient = StorageError_Transient
StorageErrorUnknownBackend = StorageError_UnknownBackend
StreamErrorContextWindowExceeded = StreamError_ContextWindowExceeded
StreamErrorInternal = StreamError_Internal
StreamErrorMaxTokensReached = StreamError_MaxTokensReached
StreamErrorModel = StreamError_Model
StreamErrorStructuredOutputUnavailable = StreamError_StructuredOutputUnavailable
StreamErrorTool = StreamError_Tool
StreamEventAfterInvocation = StreamEvent_AfterInvocation
StreamEventAfterModelCall = StreamEvent_AfterModelCall
StreamEventAfterToolCall = StreamEvent_AfterToolCall
StreamEventAfterTools = StreamEvent_AfterTools
StreamEventAgentResult = StreamEvent_AgentResult
StreamEventBeforeInvocation = StreamEvent_BeforeInvocation
StreamEventBeforeModelCall = StreamEvent_BeforeModelCall
StreamEventBeforeToolCall = StreamEvent_BeforeToolCall
StreamEventBeforeTools = StreamEvent_BeforeTools
StreamEventContent = StreamEvent_Content
StreamEventContentBlock = StreamEvent_ContentBlock
StreamEventError = StreamEvent_Error
StreamEventInitialized = StreamEvent_Initialized
StreamEventInterrupt = StreamEvent_Interrupt
StreamEventMessageAdded = StreamEvent_MessageAdded
StreamEventMetadata = StreamEvent_Metadata
StreamEventModelMessage = StreamEvent_ModelMessage
StreamEventModelUpdate = StreamEvent_ModelUpdate
StreamEventRedaction = StreamEvent_Redaction
StreamEventStop = StreamEvent_Stop
StreamEventTextDelta = StreamEvent_TextDelta
StreamEventToolResult = StreamEvent_ToolResult
StreamEventToolResultHook = StreamEvent_ToolResultHook
StreamEventToolUpdate = StreamEvent_ToolUpdate
StreamEventToolUse = StreamEvent_ToolUse
ToolChoiceAny = ToolChoice_Any
ToolChoiceAuto = ToolChoice_Auto
ToolChoiceNamed = ToolChoice_Named
ToolErrorCancelled = ToolError_Cancelled
ToolErrorExecutionFailed = ToolError_ExecutionFailed
ToolErrorInternal = ToolError_Internal
ToolErrorInvalidInput = ToolError_InvalidInput
ToolErrorTimedOut = ToolError_TimedOut
ToolErrorUnknown = ToolError_Unknown
ToolExecutorStrategyConcurrent = ToolExecutorStrategy_Concurrent
ToolExecutorStrategySequential = ToolExecutorStrategy_Sequential
ToolResultContentDocument = ToolResultContent_Document
ToolResultContentImage = ToolResultContent_Image
ToolResultContentJson = ToolResultContent_Json
ToolResultContentText = ToolResultContent_Text
ToolResultContentVideo = ToolResultContent_Video
ToolStreamEventComplete = ToolStreamEvent_Complete
ToolStreamEventData = ToolStreamEvent_Data
ToolStreamEventError = ToolStreamEvent_Error
TriggerErrorFailed = TriggerError_Failed
TriggerErrorUnknown = TriggerError_Unknown
VendedPluginContextOffloader = VendedPlugin_ContextOffloader
VendedPluginSkills = VendedPlugin_Skills
VendedToolBash = VendedTool_Bash
VendedToolFileEditor = VendedTool_FileEditor
VendedToolHttpRequest = VendedTool_HttpRequest
VendedToolNotebook = VendedTool_Notebook
VideoSourceBytes = VideoSource_Bytes
VideoSourceS3 = VideoSource_S3

__all__ = [
    "AfterInvocationData",
    "AfterModelCallData",
    "AfterToolCallData",
    "AgentAsToolConfig",
    "AgentConfig",
    "AgentError",
    "AgentErrorInternal",
    "AgentErrorInvalidInput",
    "AgentErrorNoSessionConfigured",
    "AgentErrorStorage",
    "AgentErrorUnknownInterrupt",
    "AgentIdentity",
    "AgentLoopMetrics",
    "AgentMetrics",
    "AgentNodeConfig",
    "AgentResultData",
    "AgentTrace",
    "AnthropicConfig",
    "AttributeValue",
    "AttributeValueBoolValue",
    "AttributeValueDoubleValue",
    "AttributeValueIntValue",
    "AttributeValueStringValue",
    "BackoffStrategy",
    "BackoffStrategyConstant",
    "BackoffStrategyExponential",
    "BackoffStrategyLinear",
    "BashToolConfig",
    "BedrockConfig",
    "BeforeInvocationData",
    "BeforeModelCallData",
    "BeforeToolCallData",
    "CacheKind",
    "CachePointBlock",
    "CallToolArgs",
    "Citation",
    "CitationLocation",
    "CitationLocationDocumentChar",
    "CitationLocationDocumentChunk",
    "CitationLocationDocumentPage",
    "CitationLocationSearchResult",
    "CitationLocationWeb",
    "CitationText",
    "CitationsBlock",
    "ConcurrentOptions",
    "ConstantBackoffConfig",
    "ContentBlock",
    "ContentBlockCachePoint",
    "ContentBlockCitations",
    "ContentBlockData",
    "ContentBlockDocument",
    "ContentBlockGuardContent",
    "ContentBlockImage",
    "ContentBlockInterruptResponse",
    "ContentBlockJson",
    "ContentBlockReasoning",
    "ContentBlockText",
    "ContentBlockToolResult",
    "ContentBlockToolUse",
    "ContentBlockVideo",
    "ContextOffloaderPluginConfig",
    "ConversationManagerConfig",
    "ConversationManagerConfigNone",
    "ConversationManagerConfigSlidingWindow",
    "ConversationManagerConfigSummarizing",
    "ConversationManagerState",
    "ConversationManagerStateNone",
    "ConversationManagerStateSlidingWindow",
    "ConversationManagerStateSummarizing",
    "CountTokensArgs",
    "CustomModelConfig",
    "CustomStorageConfig",
    "Datetime",
    "DeleteSessionArgs",
    "DocumentCitationsConfig",
    "DocumentRange",
    "DocumentSource",
    "DocumentSourceBytes",
    "DocumentSourceContent",
    "DocumentSourceS3",
    "DocumentSourceText",
    "EdgeConfig",
    "EdgeHandler",
    "EdgeHandlerError",
    "EdgeHandlerErrorFailed",
    "EdgeHandlerErrorUnknown",
    "ElicitAction",
    "ElicitRequest",
    "ElicitResponse",
    "ElicitationError",
    "ElicitationErrorHandlerFailed",
    "ElicitationErrorTimedOut",
    "ElicitationErrorUnknownClient",
    "EnvVar",
    "ExponentialBackoffConfig",
    "FileEditorToolConfig",
    "FileStorageConfig",
    "GeminiConfig",
    "GraphConfig",
    "GuardContentBlock",
    "GuardContentBlockImage",
    "GuardContentBlockText",
    "GuardContentImage",
    "GuardContentText",
    "GuardQualifier",
    "HandlerState",
    "HandoffEvent",
    "HookRedaction",
    "HttpHeader",
    "HttpRequestToolConfig",
    "HttpTransportConfig",
    "ImageSource",
    "ImageSourceBytes",
    "ImageSourceS3",
    "ImageSourceUrl",
    "InputRedaction",
    "Interrupt",
    "InvocationMetrics",
    "InvokeArgs",
    "JitterKind",
    "JsonBlock",
    "LinearBackoffConfig",
    "ListSnapshotIdsArgs",
    "LoadSnapshotArgs",
    "LogEntry",
    "LogLevel",
    "ManifestArgs",
    "McpClientConfig",
    "McpConnectionState",
    "McpTransport",
    "McpTransportSse",
    "McpTransportStdio",
    "McpTransportStreamableHttp",
    "MessageAddedData",
    "MessageMetadata",
    "MetadataEvent",
    "Metrics",
    "ModelConfig",
    "ModelConfigAnthropic",
    "ModelConfigBedrock",
    "ModelConfigCustom",
    "ModelConfigGemini",
    "ModelConfigOpenai",
    "ModelError",
    "ModelErrorContentFiltered",
    "ModelErrorContextWindowExceeded",
    "ModelErrorInternal",
    "ModelErrorInvalidRequest",
    "ModelErrorServerError",
    "ModelErrorThrottled",
    "ModelErrorTransient",
    "ModelErrorUnauthorized",
    "ModelErrorUnknownProvider",
    "ModelMessageData",
    "ModelParams",
    "ModelStopData",
    "ModelStreamOptions",
    "ModelStreamUpdateData",
    "MultiAgentInvokeArgs",
    "MultiAgentNodeConfig",
    "MultiAgentResult",
    "MultiAgentStreamEvent",
    "MultiAgentStreamEventHandoff",
    "MultiAgentStreamEventNested",
    "MultiAgentStreamEventNodeStart",
    "MultiAgentStreamEventNodeStop",
    "MultiAgentStreamEventRunComplete",
    "NodeConfig",
    "NodeConfigAgent",
    "NodeConfigMultiAgent",
    "NodeError",
    "NodeErrorEdgeHandler",
    "NodeErrorExecution",
    "NodeErrorInternal",
    "NodeErrorInvalidConfig",
    "NodeErrorLimitExceeded",
    "NodeErrorTimeout",
    "NodeEventData",
    "NodeKind",
    "NodeResult",
    "NodeStartData",
    "NotebookToolConfig",
    "OpenaiConfig",
    "OrchestrationStatus",
    "OutputRedaction",
    "PluginStateEntry",
    "PromptInput",
    "PromptInputBlocks",
    "PromptInputText",
    "ReasoningBlock",
    "RedactionEvent",
    "RespondArgs",
    "RetryConfig",
    "RetryStrategyState",
    "Role",
    "S3Location",
    "S3StorageConfig",
    "SaveLatestPolicy",
    "SaveLatestPolicyInvocation",
    "SaveLatestPolicyMessage",
    "SaveLatestPolicyTrigger",
    "SaveManifestArgs",
    "SaveSnapshotArgs",
    "SearchResultRange",
    "SessionConfig",
    "SkillSource",
    "SkillsPluginConfig",
    "SlidingWindowConfig",
    "SlidingWindowState",
    "Snapshot",
    "SnapshotData",
    "SnapshotLocation",
    "SnapshotManifest",
    "SnapshotScope",
    "SseTransportConfig",
    "StartStreamArgs",
    "StdioTransportConfig",
    "StopEvent",
    "StopReason",
    "StorageConfig",
    "StorageConfigCustom",
    "StorageConfigFile",
    "StorageConfigS3",
    "StorageError",
    "StorageErrorAccessDenied",
    "StorageErrorConflict",
    "StorageErrorCorrupt",
    "StorageErrorNotFound",
    "StorageErrorOutOfSpace",
    "StorageErrorPermanent",
    "StorageErrorTransient",
    "StorageErrorUnknownBackend",
    "StreamError",
    "StreamErrorContextWindowExceeded",
    "StreamErrorInternal",
    "StreamErrorMaxTokensReached",
    "StreamErrorModel",
    "StreamErrorStructuredOutputUnavailable",
    "StreamErrorTool",
    "StreamEvent",
    "StreamEventAfterInvocation",
    "StreamEventAfterModelCall",
    "StreamEventAfterToolCall",
    "StreamEventAfterTools",
    "StreamEventAgentResult",
    "StreamEventBeforeInvocation",
    "StreamEventBeforeModelCall",
    "StreamEventBeforeToolCall",
    "StreamEventBeforeTools",
    "StreamEventContent",
    "StreamEventContentBlock",
    "StreamEventError",
    "StreamEventInitialized",
    "StreamEventInterrupt",
    "StreamEventMessageAdded",
    "StreamEventMetadata",
    "StreamEventModelMessage",
    "StreamEventModelUpdate",
    "StreamEventRedaction",
    "StreamEventStop",
    "StreamEventTextDelta",
    "StreamEventToolResult",
    "StreamEventToolResultHook",
    "StreamEventToolUpdate",
    "StreamEventToolUse",
    "SummarizingConfig",
    "SummarizingState",
    "SwarmConfig",
    "TasksConfig",
    "TerminalStatus",
    "TextBlock",
    "ToolChoice",
    "ToolChoiceAny",
    "ToolChoiceAuto",
    "ToolChoiceNamed",
    "ToolError",
    "ToolErrorCancelled",
    "ToolErrorExecutionFailed",
    "ToolErrorInternal",
    "ToolErrorInvalidInput",
    "ToolErrorTimedOut",
    "ToolErrorUnknown",
    "ToolExecutorStrategy",
    "ToolExecutorStrategyConcurrent",
    "ToolExecutorStrategySequential",
    "ToolMetrics",
    "ToolResultBlock",
    "ToolResultContent",
    "ToolResultContentDocument",
    "ToolResultContentImage",
    "ToolResultContentJson",
    "ToolResultContentText",
    "ToolResultContentVideo",
    "ToolResultData",
    "ToolResultStatus",
    "ToolSpec",
    "ToolStreamEvent",
    "ToolStreamEventComplete",
    "ToolStreamEventData",
    "ToolStreamEventError",
    "ToolStreamUpdateData",
    "ToolUseBlock",
    "ToolUseData",
    "ToolsBatchData",
    "TraceAttribute",
    "TraceContext",
    "TraceMetadataEntry",
    "TriggerError",
    "TriggerErrorFailed",
    "TriggerErrorUnknown",
    "TriggerParams",
    "Usage",
    "VendedPlugin",
    "VendedPluginContextOffloader",
    "VendedPluginSkills",
    "VendedTool",
    "VendedToolBash",
    "VendedToolFileEditor",
    "VendedToolHttpRequest",
    "VendedToolNotebook",
    "VideoSource",
    "VideoSourceBytes",
    "VideoSourceS3",
    "WebLocation",
]
