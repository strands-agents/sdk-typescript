"""Strands Agents SDK — Python surface.

Generated types in :mod:`strands._generated` are the source of truth.
Classes here subclass the matching generated record so users never
reach into ``_generated`` and so wire-level dataclasses double as the
SDK surface. The ``__init__`` overrides add coercion (seconds →
nanoseconds, string → TextBlock, flat kwargs → tagged variant arms).
"""

from __future__ import annotations

import inspect
import json
import typing
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import asdict, is_dataclass
from typing import Any, Protocol, TypeVar, get_type_hints, runtime_checkable

from strands import _generated as _t
from strands._generated import *  # noqa: F401,F403 — re-export every generated type & variant-arm alias


class StrandsError(Exception):
    """Base class for all SDK-raised errors."""


class _ModelErrorBase(StrandsError):
    """Base for errors surfaced by a model provider."""


class ContextWindowOverflowError(_ModelErrorBase):
    """Input exceeded the model's context window and no recovery was possible."""


class MaxTokensError(_ModelErrorBase):
    """Model stopped generating because it hit the max-tokens budget."""

    def __init__(self, message: str, partial_message: _t.Message | None = None) -> None:
        super().__init__(message)
        self.partial_message = partial_message


class ModelThrottledError(_ModelErrorBase):
    """Model provider throttled the request. Hook into retry to recover."""


class ProviderTokenCountError(_ModelErrorBase):
    """Provider-native token counting failed; base heuristic should run instead."""


class ToolValidationError(StrandsError):
    """A tool failed validation at registration or invocation time."""


class JsonValidationError(StrandsError):
    """A value could not be serialized to JSON."""


class StructuredOutputError(StrandsError):
    """Model refused to use the structured-output tool even after being forced."""


class ConcurrentInvocationError(StrandsError):
    """Agent is already processing an invocation; concurrent calls are not allowed."""


class SessionError(StrandsError):
    """Session storage read/write failed."""


# Inputs Message / PromptInput accept. Plain strings auto-wrap as text.
_ContentInput = (
    str
    | _t.ContentBlock
    | _t.TextBlock
    | _t.JsonBlock
    | _t.ToolUseBlock
    | _t.ToolResultBlock
    | _t.ReasoningBlock
    | _t.CachePointBlock
    | _t.ImageBlock
    | _t.VideoBlock
    | _t.DocumentBlock
    | _t.CitationsBlock
    | _t.InterruptResponseBlock
)


def _as_content_block(item: _ContentInput) -> _t.ContentBlock:
    """Wrap any accepted content shape in its tagged ContentBlock arm."""
    if isinstance(item, str):
        return _t.ContentBlock_Text(value=_t.TextBlock(text=item))
    if isinstance(item, _t.TextBlock):
        return _t.ContentBlock_Text(value=item)
    if isinstance(item, _t.JsonBlock):
        return _t.ContentBlock_Json(value=item)
    if isinstance(item, _t.ToolUseBlock):
        return _t.ContentBlock_ToolUse(value=item)
    if isinstance(item, _t.ToolResultBlock):
        return _t.ContentBlock_ToolResult(value=item)
    if isinstance(item, _t.ReasoningBlock):
        return _t.ContentBlock_Reasoning(value=item)
    if isinstance(item, _t.CachePointBlock):
        return _t.ContentBlock_CachePoint(value=item)
    if isinstance(item, _t.ImageBlock):
        return _t.ContentBlock_Image(value=item)
    if isinstance(item, _t.VideoBlock):
        return _t.ContentBlock_Video(value=item)
    if isinstance(item, _t.DocumentBlock):
        return _t.ContentBlock_Document(value=item)
    if isinstance(item, _t.CitationsBlock):
        return _t.ContentBlock_Citations(value=item)
    if isinstance(item, _t.InterruptResponseBlock):
        return _t.ContentBlock_InterruptResponse(value=item)
    return item  # already a ContentBlock arm


class ImageBlock(_t.ImageBlock):
    def __init__(
        self,
        *,
        format: str,
        bytes: bytes | None = None,
        url: str | None = None,
        s3: _t.S3Location | None = None,
    ) -> None:
        provided = [x for x in (bytes, url, s3) if x is not None]
        if len(provided) != 1:
            raise ValueError("ImageBlock requires exactly one of bytes, url, or s3")
        if bytes is not None:
            source: _t.ImageSource = _t.ImageSource_Bytes(value=bytes)
        elif url is not None:
            source = _t.ImageSource_Url(value=url)
        else:
            assert s3 is not None
            source = _t.ImageSource_S3(value=s3)
        super().__init__(format=format, source=source)


class VideoBlock(_t.VideoBlock):
    def __init__(
        self,
        *,
        format: str,
        bytes: bytes | None = None,
        s3: _t.S3Location | None = None,
    ) -> None:
        if (bytes is None) == (s3 is None):
            raise ValueError("VideoBlock requires exactly one of bytes or s3")
        source: _t.VideoSource = (
            _t.VideoSource_Bytes(value=bytes) if bytes is not None else _t.VideoSource_S3(value=s3)  # type: ignore[arg-type]
        )
        super().__init__(format=format, source=source)


class DocumentBlock(_t.DocumentBlock):
    def __init__(
        self,
        *,
        name: str,
        format: str,
        bytes: bytes | None = None,
        text: str | None = None,
        content: list[_t.TextBlock] | None = None,
        s3: _t.S3Location | None = None,
        citations: bool = False,
        context: str | None = None,
    ) -> None:
        provided = [x for x in (bytes, text, content, s3) if x is not None]
        if len(provided) != 1:
            raise ValueError("DocumentBlock requires exactly one of bytes, text, content, or s3")
        if bytes is not None:
            source: _t.DocumentSource = _t.DocumentSource_Bytes(value=bytes)
        elif text is not None:
            source = _t.DocumentSource_Text(value=text)
        elif content is not None:
            source = _t.DocumentSource_Content(value=content)
        else:
            assert s3 is not None
            source = _t.DocumentSource_S3(value=s3)
        super().__init__(
            name=name,
            format=format,
            source=source,
            citations=_t.DocumentCitationsConfig(enabled=citations) if citations else None,
            context=context,
        )


class InterruptResponseBlock(_t.InterruptResponseBlock):
    def __init__(self, *, interrupt_id: str, response: Any) -> None:
        payload = response if isinstance(response, str) else json.dumps(response)
        super().__init__(interrupt_id=interrupt_id, response=payload)


class Message(_t.Message):
    def __init__(
        self,
        *,
        role: _t.Role,
        content: Iterable[_ContentInput],
        metadata: _t.MessageMetadata | None = None,
    ) -> None:
        super().__init__(
            role=role,
            content=[_as_content_block(c) for c in content],
            metadata=metadata,
        )

    @classmethod
    def user(cls, *content: _ContentInput, metadata: _t.MessageMetadata | None = None) -> Message:
        return cls(role=_t.Role.USER, content=content, metadata=metadata)

    @classmethod
    def assistant(cls, *content: _ContentInput, metadata: _t.MessageMetadata | None = None) -> Message:
        return cls(role=_t.Role.ASSISTANT, content=content, metadata=metadata)


def _extras_to_json(extras: dict[str, Any] | None) -> str | None:
    return json.dumps(extras) if extras else None


class BedrockModel(_t.ModelConfig_Bedrock):
    def __init__(
        self,
        model_id: str = "us.anthropic.claude-opus-4-7-v1:0",
        *,
        region: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        session_token: str | None = None,
        **extras: Any,
    ) -> None:
        super().__init__(
            value=_t.BedrockConfig(
                model_id=model_id,
                region=region,
                access_key_id=access_key_id,
                secret_access_key=secret_access_key,
                session_token=session_token,
                additional_config=_extras_to_json(extras),
            )
        )


class AnthropicModel(_t.ModelConfig_Anthropic):
    def __init__(self, model_id: str | None = None, *, api_key: str | None = None, **extras: Any) -> None:
        super().__init__(
            value=_t.AnthropicConfig(model_id=model_id, api_key=api_key, additional_config=_extras_to_json(extras))
        )


class OpenAIModel(_t.ModelConfig_Openai):
    def __init__(self, model_id: str | None = None, *, api_key: str | None = None, **extras: Any) -> None:
        super().__init__(
            value=_t.OpenaiConfig(model_id=model_id, api_key=api_key, additional_config=_extras_to_json(extras))
        )


class GoogleModel(_t.ModelConfig_Gemini):
    def __init__(self, model_id: str | None = None, *, api_key: str | None = None, **extras: Any) -> None:
        super().__init__(
            value=_t.GeminiConfig(model_id=model_id, api_key=api_key, additional_config=_extras_to_json(extras))
        )


class CustomModel(_t.ModelConfig_Custom):
    """Host-implemented provider. Pair with a ``model-provider`` callback."""

    def __init__(
        self,
        provider_id: str,
        *,
        model_id: str | None = None,
        stateful: bool = False,
        **extras: Any,
    ) -> None:
        super().__init__(
            value=_t.CustomModelConfig(
                provider_id=provider_id,
                model_id=model_id,
                additional_config=_extras_to_json(extras),
                stateful=stateful,
            )
        )


class PydanticTool:
    """Tool whose input schema is derived from a pydantic ``BaseModel``.

    Python analog to TS's ``ZodTool``. The model's JSON schema is sent
    to the model provider; incoming arguments are validated through
    pydantic before the callback runs, so the callback receives a real
    model instance::

        class WeatherInput(BaseModel):
            city: str
            units: Literal['c', 'f'] = 'c'

        def get_weather(input: WeatherInput) -> str:
            ...

        tool = PydanticTool(
            name='get_weather',
            description='Return the current weather for a city.',
            input_model=WeatherInput,
            func=get_weather,
        )

    ``pydantic`` is not a hard runtime dependency of ``strands``; users
    who reach for this class install pydantic themselves.
    """

    def __init__(
        self,
        *,
        name: str,
        description: str,
        input_model: type,
        func: Callable[..., Any],
    ) -> None:
        if not hasattr(input_model, "model_json_schema") or not hasattr(input_model, "model_validate"):
            raise TypeError(f"input_model must be a pydantic BaseModel subclass; got {input_model!r}")
        self.name = name
        self.description = description
        self._input_model = input_model
        self.input_schema = input_model.model_json_schema()
        self.func = func

    def to_spec(self) -> _t.ToolSpec:
        return _t.ToolSpec(
            name=self.name,
            description=self.description,
            input_schema=json.dumps(self.input_schema),
        )

    def invoke(self, raw_input: str) -> list[_t.ToolResultContent]:
        payload = json.loads(raw_input) if raw_input else {}
        validated = self._input_model.model_validate(payload)
        return _coerce_tool_result(self.func(validated))


class Tool:
    """Registered tool: spec plus Python callable. Build via :func:`tool`.

    Not a generated record — the callable lives host-side and is routed
    through the tool-provider interface separately from the ``ToolSpec``
    the model sees.
    """

    def __init__(
        self,
        *,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        func: Callable[..., Any],
    ) -> None:
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self.func = func

    def to_spec(self) -> _t.ToolSpec:
        return _t.ToolSpec(
            name=self.name,
            description=self.description,
            input_schema=json.dumps(self.input_schema),
        )

    def invoke(self, raw_input: str) -> list[_t.ToolResultContent]:
        kwargs = json.loads(raw_input) if raw_input else {}
        return _coerce_tool_result(self.func(**kwargs))


def _coerce_tool_result(result: Any) -> list[_t.ToolResultContent]:
    if isinstance(result, str):
        return [_t.ToolResultContent_Text(value=_t.TextBlock(text=result))]
    if isinstance(result, _t.TextBlock):
        return [_t.ToolResultContent_Text(value=result)]
    if isinstance(result, _t.JsonBlock):
        return [_t.ToolResultContent_Json(value=result)]
    if isinstance(result, dict):
        return [_t.ToolResultContent_Json(value=_t.JsonBlock(json=json.dumps(result)))]
    if is_dataclass(result) and not isinstance(result, type):
        return [_t.ToolResultContent_Json(value=_t.JsonBlock(json=json.dumps(asdict(result))))]
    if isinstance(result, list):
        return result  # assumed to already be ToolResultContent arms
    return [_t.ToolResultContent_Text(value=_t.TextBlock(text=str(result)))]


def _py_type_to_schema(py_type: Any) -> dict[str, Any]:
    origin = typing.get_origin(py_type)
    if py_type is str:
        return {"type": "string"}
    if py_type is int:
        return {"type": "integer"}
    if py_type is float:
        return {"type": "number"}
    if py_type is bool:
        return {"type": "boolean"}
    if origin is list:
        args = typing.get_args(py_type)
        return {"type": "array", "items": _py_type_to_schema(args[0]) if args else {}}
    if origin is dict:
        return {"type": "object"}
    return {}


def tool(
    func: Callable[..., Any] | None = None,
    *,
    name: str | None = None,
    description: str | None = None,
) -> Any:
    """Decorator that turns a Python function into a :class:`Tool`.

    Type hints become the JSON schema; the docstring (or ``description``
    kwarg) is the tool description shown to the model::

        @tool
        def get_weather(city: str) -> str:
            '''Return the current weather for a city.'''
            return ...
    """

    def wrap(f: Callable[..., Any]) -> Tool:
        hints = get_type_hints(f)
        sig = inspect.signature(f)
        properties: dict[str, Any] = {}
        required: list[str] = []
        for param_name, param in sig.parameters.items():
            properties[param_name] = _py_type_to_schema(hints.get(param_name, str))
            if param.default is inspect.Parameter.empty:
                required.append(param_name)
        schema: dict[str, Any] = {"type": "object", "properties": properties}
        if required:
            schema["required"] = required
        return Tool(
            name=name or f.__name__,
            description=description or (f.__doc__ or "").strip() or f.__name__,
            input_schema=schema,
            func=f,
        )

    return wrap(func) if func is not None else wrap


class NullConversationManager(_t.ConversationManagerConfig_None_):
    """No management. History grows without bound."""


class SlidingWindowConversationManager(_t.ConversationManagerConfig_SlidingWindow):
    def __init__(self, *, window_size: int = 40, should_truncate_results: bool = True) -> None:
        super().__init__(
            value=_t.SlidingWindowConfig(window_size=window_size, should_truncate_results=should_truncate_results)
        )


class SummarizingConversationManager(_t.ConversationManagerConfig_Summarizing):
    def __init__(
        self,
        *,
        summary_ratio: float = 0.3,
        preserve_recent_messages: int = 10,
        summarization_system_prompt: str | None = None,
        summarization_model: _t.ModelConfig | None = None,
    ) -> None:
        super().__init__(
            value=_t.SummarizingConfig(
                summary_ratio=summary_ratio,
                preserve_recent_messages=preserve_recent_messages,
                summarization_system_prompt=summarization_system_prompt,
                summarization_model=summarization_model,
            )
        )


def _seconds_to_ns(seconds: float) -> int:
    return int(seconds * 1_000_000_000)


def _optional_ns(seconds: float | None) -> int | None:
    return None if seconds is None else _seconds_to_ns(seconds)


class ConstantBackoff(_t.BackoffStrategy_Constant):
    def __init__(self, *, delay: float = 1.0) -> None:
        super().__init__(value=_t.ConstantBackoffConfig(delay=_seconds_to_ns(delay)))


class LinearBackoff(_t.BackoffStrategy_Linear):
    def __init__(
        self,
        *,
        base: float = 1.0,
        max: float = 30.0,
        jitter: _t.JitterKind = _t.JitterKind.FULL,
    ) -> None:
        super().__init__(
            value=_t.LinearBackoffConfig(base=_seconds_to_ns(base), max=_seconds_to_ns(max), jitter=jitter)
        )


class ExponentialBackoff(_t.BackoffStrategy_Exponential):
    def __init__(
        self,
        *,
        base: float = 1.0,
        max: float = 30.0,
        factor: float = 2.0,
        jitter: _t.JitterKind = _t.JitterKind.FULL,
    ) -> None:
        super().__init__(
            value=_t.ExponentialBackoffConfig(
                base=_seconds_to_ns(base),
                max=_seconds_to_ns(max),
                factor=factor,
                jitter=jitter,
            )
        )


class ModelRetryStrategy(_t.ModelRetryStrategy):
    def __init__(
        self,
        *,
        max_attempts: int = 6,
        backoff: _t.BackoffStrategy | None = None,
        total_budget: float | None = None,
    ) -> None:
        super().__init__(
            max_attempts=max_attempts,
            backoff=backoff if backoff is not None else ExponentialBackoff(),
            total_budget=_optional_ns(total_budget),
        )


class FileStorage(_t.StorageConfig_File):
    def __init__(self, base_dir: str) -> None:
        super().__init__(value=_t.FileStorageConfig(base_dir=base_dir))


class S3Storage(_t.StorageConfig_S3):
    def __init__(self, *, bucket: str, region: str | None = None, prefix: str | None = None) -> None:
        super().__init__(value=_t.S3StorageConfig(bucket=bucket, region=region, prefix=prefix))


class CustomStorage(_t.StorageConfig_Custom):
    """Host-implemented backend. Pair with a ``snapshot-storage`` handler."""

    def __init__(self, backend_id: str) -> None:
        super().__init__(value=_t.CustomStorageConfig(backend_id=backend_id))


class SessionManager(_t.SessionConfig):
    """Attach session persistence to an agent. Adds a default for ``save_latest``."""

    def __init__(
        self,
        *,
        session_id: str,
        storage: _t.StorageConfig,
        save_latest: _t.SaveLatestPolicy | None = None,
    ) -> None:
        super().__init__(session_id=session_id, storage=storage, save_latest=save_latest)


def _coerce_nested_config(value: Any) -> str:
    """Orchestrators embed a nested agent/graph/swarm as a JSON string."""
    if isinstance(value, str):
        return value
    return json.dumps(value, default=_json_default)


def _json_default(obj: Any) -> Any:
    if is_dataclass(obj) and not isinstance(obj, type):
        return asdict(obj)
    if hasattr(obj, "__dict__"):
        return {k: v for k, v in obj.__dict__.items() if not k.startswith("_")}
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


class AgentNode(_t.NodeConfig_Agent):
    def __init__(
        self,
        *,
        id: str,
        agent_config: Any,
        description: str | None = None,
        timeout: float | None = None,
    ) -> None:
        super().__init__(
            value=_t.AgentNodeConfig(
                id=id,
                description=description,
                timeout=_optional_ns(timeout),
                agent_config=_coerce_nested_config(agent_config),
            )
        )


class MultiAgentNode(_t.NodeConfig_MultiAgent):
    def __init__(self, *, id: str, orchestrator: Any, description: str | None = None) -> None:
        super().__init__(
            value=_t.MultiAgentNodeConfig(
                id=id,
                description=description,
                orchestrator=_coerce_nested_config(orchestrator),
            )
        )


class Graph(_t.GraphConfig):
    def __init__(
        self,
        *,
        id: str,
        nodes: list[_t.NodeConfig],
        edges: list[_t.EdgeConfig] | None = None,
        sources: list[str] | None = None,
        max_concurrency: int | None = None,
        max_steps: int | None = None,
        timeout: float | None = None,
        node_timeout: float | None = None,
    ) -> None:
        super().__init__(
            id=id,
            nodes=nodes,
            edges=edges or [],
            sources=sources or [],
            max_concurrency=max_concurrency,
            max_steps=max_steps,
            timeout=_optional_ns(timeout),
            node_timeout=_optional_ns(node_timeout),
        )


class Swarm(_t.SwarmConfig):
    def __init__(
        self,
        *,
        id: str,
        nodes: list[_t.AgentNodeConfig],
        start_node_id: str,
        max_steps: int | None = None,
        timeout: float | None = None,
        node_timeout: float | None = None,
    ) -> None:
        super().__init__(
            id=id,
            nodes=nodes,
            start_node_id=start_node_id,
            max_steps=max_steps,
            timeout=_optional_ns(timeout),
            node_timeout=_optional_ns(node_timeout),
        )


class BashTool(_t.VendedTool_Bash):
    def __init__(self, *, default_timeout: int | None = None) -> None:
        super().__init__(value=_t.BashToolConfig(default_timeout_s=default_timeout))


class FileEditorTool(_t.VendedTool_FileEditor):
    def __init__(self, *, workspace_root: str | None = None) -> None:
        super().__init__(value=_t.FileEditorToolConfig(workspace_root=workspace_root))


class HttpRequestTool(_t.VendedTool_HttpRequest):
    def __init__(self, *, allowed_hosts: list[str] | None = None, max_response_bytes: int = 0) -> None:
        super().__init__(
            value=_t.HttpRequestToolConfig(
                allowed_hosts=allowed_hosts or [],
                max_response_bytes=max_response_bytes,
            )
        )


class NotebookTool(_t.VendedTool_Notebook):
    def __init__(self, *, workspace_root: str | None = None) -> None:
        super().__init__(value=_t.NotebookToolConfig(workspace_root=workspace_root))


class SkillsPlugin(_t.VendedPlugin_Skills):
    def __init__(
        self,
        *,
        skills: list[str],
        strict: bool = False,
        max_resource_files: int | None = None,
        state_key: str | None = None,
    ) -> None:
        super().__init__(
            value=_t.SkillsPluginConfig(
                skills=[_t.SkillSource(path=p) for p in skills],
                strict=strict,
                max_resource_files=max_resource_files,
                state_key=state_key,
            )
        )


class ContextOffloaderPlugin(_t.VendedPlugin_ContextOffloader):
    def __init__(
        self,
        *,
        max_result_tokens: int | None = None,
        preview_tokens: int | None = None,
        include_retrieval_tool: bool = True,
    ) -> None:
        super().__init__(
            value=_t.ContextOffloaderPluginConfig(
                max_result_tokens=max_result_tokens,
                preview_tokens=preview_tokens,
                include_retrieval_tool=include_retrieval_tool,
            )
        )


class StdioMcpTransport(_t.McpTransport_Stdio):
    """Launch an MCP server as a subprocess and talk to it over stdio."""

    def __init__(
        self,
        *,
        command: str,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
        cwd: str | None = None,
    ) -> None:
        super().__init__(
            value=_t.StdioTransportConfig(
                command=command,
                args=args or [],
                env=[_t.EnvVar(key=k, value=v) for k, v in (env or {}).items()],
                cwd=cwd,
            )
        )


class StreamableHttpMcpTransport(_t.McpTransport_StreamableHttp):
    """Talk to a hosted MCP server over streamable HTTP."""

    def __init__(self, *, url: str, headers: dict[str, str] | None = None) -> None:
        super().__init__(
            value=_t.HttpTransportConfig(
                url=url,
                headers=[_t.HttpHeader(name=k, value=v) for k, v in (headers or {}).items()],
            )
        )


class SseMcpTransport(_t.McpTransport_Sse):
    """Legacy SSE transport. Retained for older MCP servers."""

    def __init__(self, *, url: str, headers: dict[str, str] | None = None) -> None:
        super().__init__(
            value=_t.SseTransportConfig(
                url=url,
                headers=[_t.HttpHeader(name=k, value=v) for k, v in (headers or {}).items()],
            )
        )


class McpClient(_t.McpClientConfig):
    """Declare an MCP client the host should open and route tools from.

    The agent loop sees the server-advertised tools alongside any in
    ``tools=``. ``client_id`` is the handle passed back on elicitation
    callbacks.
    """

    def __init__(
        self,
        *,
        client_id: str,
        transport: _t.McpTransport,
        application_name: str | None = None,
        application_version: str | None = None,
        tasks_ttl: float | None = None,
        tasks_poll_timeout: float | None = None,
        elicitation_enabled: bool = False,
        fail_open: bool = False,
        disable_instrumentation: bool = False,
    ) -> None:
        tasks = None
        if tasks_ttl is not None or tasks_poll_timeout is not None:
            tasks = _t.TasksConfig(
                ttl=_seconds_to_ns(tasks_ttl if tasks_ttl is not None else 60.0),
                poll_timeout=_seconds_to_ns(tasks_poll_timeout if tasks_poll_timeout is not None else 300.0),
            )
        super().__init__(
            client_id=client_id,
            application_name=application_name,
            application_version=application_version,
            transport=transport,
            tasks_config=tasks,
            elicitation_enabled=elicitation_enabled,
            fail_open=fail_open,
            disable_instrumentation=disable_instrumentation,
        )


class InterruptResponse(_t.RespondArgs):
    """Reply to a paused agent via ``response-stream.respond``."""

    def __init__(self, *, interrupt_id: str, response: Any) -> None:
        payload = response if isinstance(response, str) else json.dumps(response)
        super().__init__(interrupt_id=interrupt_id, response=payload)


_ToolInput = Tool | PydanticTool | Callable[..., Any]
_ToolChoiceInput = _t.ToolChoice | str | None


def _coerce_tool(item: _ToolInput) -> Tool | PydanticTool:
    if isinstance(item, (Tool, PydanticTool)):
        return item
    if callable(item):
        return tool(item)
    raise TypeError(f"unsupported tool: {type(item).__name__}")


def _coerce_prompt(value: str | _t.PromptInput | Iterable[_ContentInput]) -> _t.PromptInput:
    if isinstance(value, str):
        return _t.PromptInput_Text(value=value)
    if isinstance(value, (_t.PromptInput_Text, _t.PromptInput_Blocks)):
        return value
    return _t.PromptInput_Blocks(value=[_as_content_block(c) for c in value])


def _coerce_tool_choice(value: _ToolChoiceInput) -> _t.ToolChoice | None:
    if value is None:
        return None
    if isinstance(value, str):
        return _t.ToolChoice_Named(value=value)
    return value


class Agent:
    """Strands agent. Construct once; call to invoke.

    The class holds a fully-built :class:`_t.AgentConfig` plus the
    Python callables backing any ``@tool`` the caller passed in. Runtime
    plumbing (WASM host, streaming) lands once componentize-js supports
    component-model streams; today the class is a config builder and API
    skeleton that will transparently gain runtime behavior when the host
    is wired in.
    """

    def __init__(
        self,
        *,
        model: _t.ModelConfig | None = None,
        messages: list[_t.Message] | None = None,
        system_prompt: str | _t.PromptInput | Iterable[_ContentInput] | None = None,
        tools: list[_ToolInput] | None = None,
        agent_tools: list[_t.AgentAsToolConfig] | None = None,
        vended_tools: list[_t.VendedTool] | None = None,
        vended_plugins: list[_t.VendedPlugin] | None = None,
        mcp_clients: list[_t.McpClientConfig] | None = None,
        name: str | None = None,
        id: str | None = None,
        description: str | None = None,
        tool_executor: _t.ToolExecutorStrategy | None = None,
        display_output: bool | None = None,
        trace_attributes: list[_t.TraceAttribute] | None = None,
        trace_context: _t.TraceContext | None = None,
        session: _t.SessionConfig | None = None,
        conversation_manager: _t.ConversationManagerConfig | None = None,
        retry: _t.RetryConfig | None = None,
        structured_output_schema: str | None = None,
        app_state: dict[str, Any] | None = None,
        model_state: dict[str, Any] | None = None,
    ) -> None:
        self._tools: list[Tool | PydanticTool] = [_coerce_tool(t) for t in (tools or [])]
        identity = None
        if name is not None or id is not None or description is not None:
            identity = _t.AgentIdentity(name=name, id=id, description=description)

        self._config = _t.AgentConfig(
            model=model,
            model_params=None,
            messages=messages,
            system_prompt=(_coerce_prompt(system_prompt) if system_prompt is not None else None),
            tools=[t.to_spec() for t in self._tools] or None,
            agent_tools=agent_tools,
            vended_tools=vended_tools,
            vended_plugins=vended_plugins,
            mcp_clients=mcp_clients,
            identity=identity,
            tool_executor=tool_executor,
            display_output=display_output,
            trace_attributes=trace_attributes,
            trace_context=trace_context,
            session=session,
            conversation_manager=conversation_manager,
            retry=retry,
            structured_output_schema=structured_output_schema,
            app_state=json.dumps(app_state) if app_state else None,
            model_state=json.dumps(model_state) if model_state else None,
        )

    @property
    def config(self) -> _t.AgentConfig:
        """The built WIT `agent-config`. Read-only."""
        return self._config

    def invoke(
        self,
        prompt: str | _t.PromptInput | Iterable[_ContentInput],
        *,
        tools: list[_ToolInput] | None = None,
        tool_choice: _ToolChoiceInput = None,
        structured_output_schema: str | None = None,
    ) -> _t.InvokeArgs:
        """Build an ``InvokeArgs`` ready to hand to the guest.

        The method returns the configured arguments rather than running
        the invocation; the WASM host glue (which owns the runtime) calls
        through once it's wired in.
        """
        extra_tools = [_coerce_tool(t).to_spec() for t in (tools or [])] or None
        return _t.InvokeArgs(
            input=_coerce_prompt(prompt),
            tools=extra_tools,
            tool_choice=_coerce_tool_choice(tool_choice),
            structured_output_schema=structured_output_schema,
        )

    def respond(self, interrupt_id: str, response: Any) -> _t.RespondArgs:
        """Build a ``RespondArgs`` resuming a paused invocation.

        ``response`` is serialized to JSON when it isn't already a
        string. The returned record is what the WASM host forwards to
        ``response-stream.respond`` once the runtime is wired in::

            for event in stream:
                match event:
                    case strands.StreamEventInterrupt(value=interrupt):
                        args = agent.respond(interrupt.id, {"approve": True})
                        # hand `args` to the response-stream resource
        """
        payload = response if isinstance(response, str) else json.dumps(response)
        return _t.RespondArgs(interrupt_id=interrupt_id, response=payload)


_HookEventT = TypeVar("_HookEventT")

_HookCallback = Callable[[Any], Any]


@runtime_checkable
class HookProvider(Protocol):
    """Bundle of related hook registrations.

    Implement ``register_hooks`` to attach a group of callbacks at
    once::

        class LoggingHooks:
            def register_hooks(self, registry: HookRegistry) -> None:
                registry.add_callback(BeforeInvocationData, self._log_start)
                registry.add_callback(AfterInvocationData, self._log_end)

        registry.add_hook(LoggingHooks())
    """

    def register_hooks(self, registry: HookRegistry) -> None: ...


class HookRegistry:
    """Register callbacks keyed by StreamEvent arm or hook payload class.

    Subscribers match by exact type (``type(event) is event_type``).
    Variant arms are distinct classes, so that primitive is enough —
    users pick ``strands.StreamEventTextDelta`` or
    ``strands.BeforeInvocationData`` directly.

    Callbacks for arms whose name begins with ``After`` dispatch in
    reverse registration order, mirroring the teardown semantics of the
    TS SDK's ``after-*`` hooks. Everything else dispatches FIFO.
    """

    def __init__(self) -> None:
        self._callbacks: dict[type, list[_HookCallback]] = {}

    def add_callback(
        self,
        event_type: type[_HookEventT],
        callback: Callable[[_HookEventT], Any],
    ) -> Callable[[], None]:
        """Register ``callback`` for ``event_type``. Returns an unsubscribe."""
        entries = self._callbacks.setdefault(event_type, [])
        entry = typing.cast(_HookCallback, callback)
        entries.append(entry)

        def _remove() -> None:
            try:
                self._callbacks[event_type].remove(entry)
            except (KeyError, ValueError):
                pass

        return _remove

    def add_hook(self, provider: HookProvider) -> None:
        """Register every callback the provider exposes."""
        provider.register_hooks(self)

    def dispatch(self, event: Any) -> None:
        """Run registered callbacks synchronously.

        Raises ``RuntimeError`` if any matching callback is async; use
        :meth:`dispatch_async` instead.
        """
        callbacks = self._callbacks_for(event)
        if any(inspect.iscoroutinefunction(cb) for cb in callbacks):
            raise RuntimeError(f"event={type(event).__name__} | use dispatch_async for async callbacks")
        for cb in callbacks:
            cb(event)

    async def dispatch_async(self, event: Any) -> None:
        """Run registered callbacks, awaiting any coroutine returned."""
        for cb in self._callbacks_for(event):
            result = cb(event)
            if inspect.iscoroutine(result):
                await typing.cast(Awaitable[Any], result)

    def _callbacks_for(self, event: Any) -> list[_HookCallback]:
        entries = self._callbacks.get(type(event), [])
        return list(reversed(entries)) if type(event).__name__.startswith("After") else list(entries)


class AgentResult:
    """Terminal result of an agent invocation.

    Carries the final model turn, why the loop stopped, and any
    aggregates collected along the way (usage, metrics, traces,
    interrupts, structured output). Produced once WASM streaming lands;
    today callers build it themselves from the final stream event.
    """

    def __init__(
        self,
        *,
        stop_reason: _t.StopReason,
        last_message: _t.Message,
        invocation_state: dict[str, Any] | None = None,
        traces: list[_t.AgentTrace] | None = None,
        metrics: _t.AgentMetrics | None = None,
        usage: _t.Usage | None = None,
        structured_output: Any = None,
        interrupts: list[_t.Interrupt] | None = None,
    ) -> None:
        self.stop_reason = stop_reason
        self.last_message = last_message
        self.invocation_state = invocation_state if invocation_state is not None else {}
        self.traces = traces
        self.metrics = metrics
        self.usage = usage
        self.structured_output = structured_output
        self.interrupts = interrupts

    @property
    def context_size(self) -> int | None:
        """Input token count from the last model call, if known."""
        return self.metrics.latest_context_size if self.metrics else None

    @property
    def projected_context_size(self) -> int | None:
        """Projected input tokens for the next model call, if known."""
        return self.metrics.projected_context_size if self.metrics else None

    def __str__(self) -> str:
        """Concatenate text from TextBlock and ReasoningBlock content, joined by newlines."""
        chunks: list[str] = []
        for block in self.last_message.content:
            if isinstance(block, _t.ContentBlock_Text):
                chunks.append(block.value.text)
            elif isinstance(block, _t.ContentBlock_Reasoning) and block.value.text:
                chunks.append(block.value.text)
        return "\n".join(chunks)
