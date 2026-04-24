"""Direct WASM host using wasmtime-py.

Loads the WASM component, links WASI + custom imports, and provides
a ``WasmAgent`` class with the same API as the former native ``Agent``.

Data flow across the WASM boundary:

  Exports (TS implements, Python calls in):
    api — agent construction, generate, get/set messages, session ops.
    All model HTTP calls (Bedrock, Anthropic, etc.) happen inside the guest.

  Imports (Python implements, TS calls back):
    tool-provider — the guest calls call-tool when the model requests tool use.
    host-log — the guest emits structured log entries for Python's logging.
"""

from __future__ import annotations

import asyncio
import configparser
import logging
import os
import threading
import typing
from pathlib import Path

from wasmtime import Config, Engine, Store, WasiConfig
from wasmtime import _ffi as ffi
from wasmtime.component import Component, Func, Linker, Record, Variant

from abc import ABC, abstractmethod

from strands._generated.types import (
    LifecycleEvent,
    LifecycleEventType,
    MetadataEvent,
    Metrics,
    StopData,
    StopReason,
    StreamEvent,
    StreamEvent_Error,
    StreamEvent_Interrupt,
    StreamEvent_Lifecycle,
    StreamEvent_Metadata,
    StreamEvent_Stop,
    StreamEvent_TextDelta,
    StreamEvent_ToolResult,
    StreamEvent_ToolUse,
    ToolResultEvent,
    ToolSpec,
    ToolUseEvent,
    Usage,
)

log = logging.getLogger(__name__)


class ModelConfigInput:
    """Flattened union of all model provider configs for Python API convenience."""

    def __init__(
        self,
        *,
        provider: str,
        model_id: typing.Optional[str] = None,
        api_key: typing.Optional[str] = None,
        region: typing.Optional[str] = None,
        access_key_id: typing.Optional[str] = None,
        secret_access_key: typing.Optional[str] = None,
        session_token: typing.Optional[str] = None,
        additional_config: typing.Optional[str] = None,
    ):
        self.provider = provider
        self.model_id = model_id
        self.api_key = api_key
        self.region = region
        self.access_key_id = access_key_id
        self.secret_access_key = secret_access_key
        self.session_token = session_token
        self.additional_config = additional_config


class ToolDispatcherBase(ABC):
    @abstractmethod
    def call_tool(self, name: str, input: str, tool_use_id: str) -> str:
        raise NotImplementedError


class LogHandlerBase(ABC):
    @abstractmethod
    def log(self, level: str, message: str, context: typing.Optional[str]) -> None:
        raise NotImplementedError


def _run_sync(coro: typing.Coroutine) -> typing.Any:
    """Run an async coroutine from sync context, even if an event loop is running."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    # Already inside a running loop — run in a fresh thread to avoid nesting
    result = [None]
    exc = [None]
    def _target():
        try:
            result[0] = asyncio.run(coro)
        except Exception as e:
            exc[0] = e
    t = threading.Thread(target=_target)
    t.start()
    t.join()
    if exc[0] is not None:
        raise exc[0]
    return result[0]


# ---------------------------------------------------------------------------
# Engine / Component cache (process-wide singleton)
# ---------------------------------------------------------------------------

_CACHE_LOCK = threading.Lock()
_ENGINE: Engine | None = None
_COMPONENT: Component | None = None


def _resolve_wasm_path() -> str:
    env = os.environ.get("STRANDS_WASM_PATH")
    if env:
        return env
    # Development default: relative to this file
    pkg_dir = Path(__file__).resolve().parent
    candidates = [
        pkg_dir / "_wasm" / "strands-agent.wasm",
        pkg_dir.parent.parent / "strands-wasm" / "dist" / "strands-agent.wasm",
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    raise FileNotFoundError(
        "Cannot find strands-agent.wasm. Set STRANDS_WASM_PATH or place it in "
        "strands-wasm/dist/strands-agent.wasm"
    )


def _get_engine_and_component() -> tuple[Engine, Component]:
    global _ENGINE, _COMPONENT
    if _ENGINE is not None and _COMPONENT is not None:
        return _ENGINE, _COMPONENT
    with _CACHE_LOCK:
        if _ENGINE is not None and _COMPONENT is not None:
            return _ENGINE, _COMPONENT
        config = Config()
        config.concurrency_support = True
        config.async_stack_size = 64 * 1024 * 1024
        config.wasm_component_model_async = True
        # Properties not yet exposed on the Python Config class:
        ffi.wasmtime_config_wasm_component_model_set(config.ptr(), True)

        engine = Engine(config)
        wasm_path = _resolve_wasm_path()
        log.debug("loading WASM component from %s", wasm_path)
        component = Component.from_file(engine, wasm_path)
        _ENGINE = engine
        _COMPONENT = component
        return engine, component


# ---------------------------------------------------------------------------
# Record / Variant builders  (Python → WIT kebab-case)
# ---------------------------------------------------------------------------

def _rec(**kwargs: typing.Any) -> Record:
    """Build a wasmtime-py Record with the given kebab-case fields."""
    r = Record.__new__(Record)
    for k, v in kwargs.items():
        r.__dict__[k] = v
    return r


def _build_tool_spec(ts: ToolSpec) -> Record:
    return _rec(name=ts.name, description=ts.description, **{"input-schema": ts.input_schema})


def _build_model_config_variant(cfg: ModelConfigInput) -> Variant:
    provider = cfg.provider
    if provider == "anthropic":
        payload = _rec(
            **{
                "model-id": cfg.model_id,
                "api-key": cfg.api_key,
                "additional-config": cfg.additional_config,
            }
        )
        return Variant("anthropic", payload)
    if provider == "bedrock":
        payload = _rec(
            **{
                "model-id": cfg.model_id or "",
                "region": cfg.region,
                "access-key-id": cfg.access_key_id,
                "secret-access-key": cfg.secret_access_key,
                "session-token": cfg.session_token,
                "additional-config": cfg.additional_config,
            }
        )
        return Variant("bedrock", payload)
    if provider == "openai":
        payload = _rec(
            **{
                "model-id": cfg.model_id,
                "api-key": cfg.api_key,
                "additional-config": cfg.additional_config,
            }
        )
        return Variant("openai", payload)
    if provider == "gemini":
        payload = _rec(
            **{
                "model-id": cfg.model_id,
                "api-key": cfg.api_key,
                "additional-config": cfg.additional_config,
            }
        )
        return Variant("gemini", payload)
    raise ValueError(f"unknown model provider: {provider}")


def _build_conversation_manager_variant(
    config: dict[str, typing.Any] | None,
) -> Record | None:
    """Build the conversation-manager WIT record.

    Returns None when no config is provided (uses TS SDK default).
    Uses a flat record with a string strategy discriminator to avoid
    wasmtime-py limitations with option<variant>.
    """
    if config is None:
        return None
    cm_type = config.get("type")
    summarizing_defaults = {
        "summary-ratio": None,
        "preserve-recent-messages": None,
        "summarization-system-prompt": None,
        "summarization-model-config": None,
    }
    if cm_type == "none":
        return _rec(
            strategy="none",
            **{"window-size": 0, "should-truncate-results": False},
            **summarizing_defaults,
        )
    if cm_type == "sliding-window":
        return _rec(
            strategy="sliding-window",
            **{
                "window-size": config.get("window_size", 40),
                "should-truncate-results": config.get("should_truncate_results", True),
            },
            **summarizing_defaults,
        )
    if cm_type == "summarizing":
        return _rec(
            strategy="summarizing",
            **{
                "window-size": 0,
                "should-truncate-results": False,
                "summary-ratio": config.get("summary_ratio"),
                "preserve-recent-messages": config.get("preserve_recent_messages"),
                "summarization-system-prompt": config.get("summarization_system_prompt"),
                "summarization-model-config": config.get("summarization_model_config"),
            },
        )
    raise ValueError(f"unknown conversation manager type: {cm_type}")


def _build_agent_config(
    model: ModelConfigInput | None,
    system_prompt: str | None,
    system_prompt_blocks: str | None,
    tools: list[ToolSpec] | None,
    conversation_manager_config: dict[str, typing.Any] | None = None,
) -> Record:
    model_variant = None
    if model is not None:
        model = _inject_aws_credentials(model)
        model_variant = _build_model_config_variant(model)
    else:
        model_variant = _inject_aws_credentials_default()

    tool_recs = [_build_tool_spec(t) for t in tools] if tools else None
    cm_variant = _build_conversation_manager_variant(conversation_manager_config)

    rec_kwargs: dict[str, typing.Any] = {
        "model-params": None,
        "system-prompt": system_prompt,
        "system-prompt-blocks": system_prompt_blocks,
        "trace-context": None,
        "session": None,
        "conversation-manager": cm_variant,
    }

    return _rec(
        model=model_variant,
        tools=tool_recs,
        **rec_kwargs,
    )


def _build_stream_args(
    input_text: str,
    tools: list[ToolSpec] | None,
    tool_choice: str | None,
) -> Record:
    tool_recs = [_build_tool_spec(t) for t in tools] if tools else None
    return _rec(input=input_text, tools=tool_recs, **{"tool-choice": tool_choice})


# ---------------------------------------------------------------------------
# Variant → flat StreamEvent converters  (WIT → Python types)
# ---------------------------------------------------------------------------

def _opt_attr(rec: typing.Any, name: str) -> typing.Any:
    """Read an optional attribute from a wasmtime Record (kebab-case)."""
    return getattr(rec, name, None) if rec is not None else None


def _convert_usage(rec: typing.Any) -> Usage | None:
    if rec is None:
        return None
    return Usage(
        input_tokens=getattr(rec, "input-tokens"),
        output_tokens=getattr(rec, "output-tokens"),
        total_tokens=getattr(rec, "total-tokens"),
        cache_read_input_tokens=_opt_attr(rec, "cache-read-input-tokens"),
        cache_write_input_tokens=_opt_attr(rec, "cache-write-input-tokens"),
    )


def _convert_metrics(rec: typing.Any) -> Metrics | None:
    if rec is None:
        return None
    return Metrics(latency_ms=getattr(rec, "latency-ms"))


def _stop_reason_from_str(s: str) -> StopReason:
    """Map a wasmtime kebab-case stop-reason string to the StopReason enum."""
    return StopReason[s.upper().replace("-", "_")]


def _lifecycle_type_from_str(s: str) -> LifecycleEventType:
    """Map a wasmtime kebab-case lifecycle-event-type string to the enum."""
    return LifecycleEventType[s.upper().replace("-", "_")]


def _convert_stream_event(v: Variant) -> StreamEvent:
    """Convert a wasmtime-py Variant (WIT stream-event) to a StreamEvent."""
    tag = v.tag
    p = v.payload

    if tag == "text-delta":
        return StreamEvent_TextDelta(value=p)

    if tag == "tool-use":
        tu = ToolUseEvent(
            name=getattr(p, "name"),
            tool_use_id=getattr(p, "tool-use-id"),
            input=getattr(p, "input"),
        )
        return StreamEvent_ToolUse(value=tu)

    if tag == "tool-result":
        tr = ToolResultEvent(
            tool_use_id=getattr(p, "tool-use-id"),
            status=getattr(p, "status"),
            content=getattr(p, "content"),
        )
        return StreamEvent_ToolResult(value=tr)

    if tag == "metadata":
        me = MetadataEvent(
            usage=_convert_usage(_opt_attr(p, "usage")),
            metrics=_convert_metrics(_opt_attr(p, "metrics")),
        )
        return StreamEvent_Metadata(value=me)

    if tag == "stop":
        sd = StopData(
            reason=_stop_reason_from_str(getattr(p, "reason")),
            usage=_convert_usage(_opt_attr(p, "usage")),
            metrics=_convert_metrics(_opt_attr(p, "metrics")),
        )
        return StreamEvent_Stop(value=sd)

    if tag == "error":
        return StreamEvent_Error(value=p)

    if tag == "interrupt":
        return StreamEvent_Interrupt(value=p)

    if tag == "lifecycle":
        le = LifecycleEvent(
            event_type=_lifecycle_type_from_str(getattr(p, "event-type")),
            tool_use=_opt_attr(p, "tool-use"),
            tool_result=_opt_attr(p, "tool-result"),
        )
        return StreamEvent_Lifecycle(value=le)

    log.warning("unknown stream-event tag: %s", tag)
    return StreamEvent_Error(value=f"unknown tag: {tag}")


# ---------------------------------------------------------------------------
# AWS credential injection
# ---------------------------------------------------------------------------

def _resolve_aws_credentials() -> tuple[str, str, str | None] | None:
    key_id = os.environ.get("AWS_ACCESS_KEY_ID")
    secret = os.environ.get("AWS_SECRET_ACCESS_KEY")
    if key_id and secret:
        token = os.environ.get("AWS_SESSION_TOKEN")
        return key_id, secret, token

    home = os.environ.get("HOME") or os.environ.get("USERPROFILE")
    if not home:
        return None
    creds_path = Path(home) / ".aws" / "credentials"
    if not creds_path.exists():
        return None

    profile = os.environ.get("AWS_PROFILE", "default")
    cp = configparser.ConfigParser()
    try:
        cp.read(str(creds_path))
    except Exception:
        return None
    if not cp.has_section(profile):
        return None
    kid = cp.get(profile, "aws_access_key_id", fallback=None)
    sec = cp.get(profile, "aws_secret_access_key", fallback=None)
    if not kid or not sec:
        return None
    tok = cp.get(profile, "aws_session_token", fallback=None)
    return kid, sec, tok


def _inject_aws_credentials(cfg: ModelConfigInput) -> ModelConfigInput:
    if cfg.provider != "bedrock" or cfg.access_key_id is not None:
        return cfg
    creds = _resolve_aws_credentials()
    if creds is None:
        return cfg
    key_id, secret, token = creds
    return ModelConfigInput(
        provider=cfg.provider,
        model_id=cfg.model_id,
        api_key=cfg.api_key,
        region=cfg.region,
        access_key_id=key_id,
        secret_access_key=secret,
        session_token=token,
        additional_config=cfg.additional_config,
    )


def _inject_aws_credentials_default() -> Variant | None:
    """When no model config is provided, try to create a Bedrock config with resolved credentials."""
    creds = _resolve_aws_credentials()
    if creds is None:
        return None
    key_id, secret, token = creds
    payload = _rec(
        **{
            "model-id": "",
            "region": None,
            "access-key-id": key_id,
            "secret-access-key": secret,
            "session-token": token,
            "additional-config": None,
        }
    )
    return Variant("bedrock", payload)


# ---------------------------------------------------------------------------
# Import callback factories
# ---------------------------------------------------------------------------

def _make_call_tool_fn(dispatcher: ToolDispatcherBase | None) -> typing.Callable[..., typing.Any]:
    def call_tool(store_ctx: typing.Any, args: typing.Any) -> Variant:
        name = getattr(args, "name")
        input_json = getattr(args, "input")
        tool_use_id = getattr(args, "tool-use-id")
        if dispatcher is None:
            return Variant("err", f"no handler for tool '{name}'")
        try:
            result = dispatcher.call_tool(name, input_json, tool_use_id)
            return Variant("ok", result)
        except Exception as exc:
            return Variant("err", str(exc))
    return call_tool


def _make_call_tools_fn(dispatcher: ToolDispatcherBase | None) -> typing.Callable[..., typing.Any]:
    def call_tools(store_ctx: typing.Any, args: typing.Any) -> list[Variant]:
        calls = getattr(args, "calls")
        results: list[Variant] = []
        for call in calls:
            name = getattr(call, "name")
            input_json = getattr(call, "input")
            tool_use_id = getattr(call, "tool-use-id")
            if dispatcher is None:
                results.append(Variant("err", f"no handler for tool '{name}'"))
                continue
            try:
                result = dispatcher.call_tool(name, input_json, tool_use_id)
                results.append(Variant("ok", result))
            except Exception as exc:
                results.append(Variant("err", str(exc)))
        return results
    return call_tools


def _make_log_fn(handler: LogHandlerBase | None) -> typing.Callable[..., None]:
    def log_fn(store_ctx: typing.Any, entry: typing.Any) -> None:
        level = getattr(entry, "level")
        message = getattr(entry, "message")
        context = getattr(entry, "context")
        if handler is not None:
            handler.log(level, message, context)
        else:
            logger = logging.getLogger("strands.wasm")
            py_level = {"error": 40, "warn": 30, "info": 20, "debug": 10, "trace": 10}.get(
                level, 20
            )
            msg = f"{message} | {context}" if context else message
            logger.log(py_level, msg)
    return log_fn


# ---------------------------------------------------------------------------
# WasmAgent — drop-in replacement for the former native Agent class
# ---------------------------------------------------------------------------

class WasmAgent:
    """WASM-hosted agent with the same API as the former native ``Agent``."""

    def __init__(
        self,
        model: ModelConfigInput | None,
        system_prompt: str | None,
        system_prompt_blocks: str | None,
        tools: list[ToolSpec] | None,
        tool_dispatcher: ToolDispatcherBase | None,
        log_handler: LogHandlerBase | None,
        conversation_manager_config: dict[str, typing.Any] | None = None,
        use_callback_relay: bool = False,
    ):
        engine, component = _get_engine_and_component()

        # --- linker (per-agent, callbacks are instance-specific) ---
        linker = Linker(engine)
        linker.add_wasip2_async()
        linker.add_wasi_http_async()

        with linker.root() as root:
            with root.add_instance("strands:agent/tool-provider") as tp:
                tp.add_func("call-tool", _make_call_tool_fn(tool_dispatcher))
                tp.add_func("call-tools", _make_call_tools_fn(tool_dispatcher))
            with root.add_instance("strands:agent/host-log") as hl:
                hl.add_func("log", _make_log_fn(log_handler))

        # --- store ---
        store = Store(engine)
        wasi = WasiConfig()
        wasi.inherit_env()
        wasi.inherit_stdin()
        wasi.inherit_stdout()
        wasi.inherit_stderr()
        store.set_wasi(wasi)
        store.set_wasi_http()

        self._store = store
        self._linker = linker
        self._component = component

        # --- instantiate + construct agent (async, run synchronously) ---
        agent_config = _build_agent_config(model, system_prompt, system_prompt_blocks, tools, conversation_manager_config)
        _run_sync(self._init_async(linker, store, component, agent_config))

    async def _init_async(
        self,
        linker: Linker,
        store: Store,
        component: Component,
        agent_config: Record,
    ) -> None:
        instance = await linker.instantiate_async(store, component)
        self._instance = instance

        # Resolve export functions
        api_idx = instance.get_export_index(store, "strands:agent/api")

        def _fn(name: str) -> Func:
            idx = instance.get_export_index(store, name, api_idx)
            assert idx is not None, f"export {name!r} not found under strands:agent/api"
            f = instance.get_func(store, idx)
            assert f is not None, f"export {name!r} is not a function"
            return f

        self._ctor_fn = _fn("[constructor]agent")
        self._generate_fn = _fn("[method]agent.generate")
        self._get_messages_fn = _fn("[method]agent.get-messages")
        self._set_messages_fn = _fn("[method]agent.set-messages")
        self._read_next_fn = _fn("[method]response-stream.read-next")
        self._respond_fn = _fn("[method]response-stream.respond")
        self._cancel_fn = _fn("[method]response-stream.cancel")

        # Construct the agent resource
        self._agent_handle = await self._ctor_fn.call_async(store, agent_config)

    # --- streaming API (async) ---

    async def start_stream(self, input_text: str) -> typing.Any:
        args = _build_stream_args(input_text, None, None)
        return await self._generate_fn.call_async(
            self._store, self._agent_handle, args
        )

    async def start_stream_with_options(
        self,
        input_text: str,
        tools: list[ToolSpec] | None,
        tool_choice: str | None,
    ) -> typing.Any:
        args = _build_stream_args(input_text, tools, tool_choice)
        return await self._generate_fn.call_async(
            self._store, self._agent_handle, args
        )

    async def next_events(
        self, stream_handle: typing.Any
    ) -> list[StreamEvent] | None:
        raw = await self._read_next_fn.call_async(self._store, stream_handle)
        if raw is None:
            return None
        return [_convert_stream_event(v) for v in raw]

    async def close_stream(self, stream_handle: typing.Any) -> None:
        # Cannot use stream_handle.drop(store) because ResourceAny.drop is
        # sync-only and our store has concurrency_support=True which requires
        # all WASM entry points to be async.  Instead we call the guest's
        # cancel method (an async WASM call) which lets the guest clean up,
        # then free the Python-side handle without re-entering WASM.
        await self._cancel_fn.call_async(self._store, stream_handle)

    # --- message methods ---

    async def get_messages_async(self) -> str:
        return await self._get_messages_fn.call_async(self._store, self._agent_handle)

    async def set_messages_async(self, json: str) -> None:
        args = _rec(json=json)
        await self._set_messages_fn.call_async(self._store, self._agent_handle, args)

    def get_messages(self) -> str:
        """Sync wrapper — safe from any context (inside or outside event loop)."""
        return _run_sync(self.get_messages_async())

    def set_messages(self, json: str) -> None:
        """Sync wrapper — safe from any context (inside or outside event loop)."""
        _run_sync(self.set_messages_async(json))
