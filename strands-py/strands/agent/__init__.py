from __future__ import annotations

import json
import logging
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, cast

from strands._conversions import (
    convert_message,
    event_to_dict,
    flatten_pydantic_schema,
    lifecycle_event_from_wit,
    resolve_model,
    stop_reason_to_snake,
)
from strands._wasm_host import (
    LogHandlerBase as _LogHandlerBase,
    ModelConfigInput as _ModelConfigInput,
    ToolDispatcherBase as _ToolDispatcherBase,
    WasmAgent as _WasmAgent,
)
from strands._generated.types import (
    StreamEvent_Error,
    StreamEvent_Lifecycle,
    StreamEvent_Stop,
    StreamEvent_TextDelta,
    StreamEvent_ToolResult,
    StreamEvent_ToolUse,
    ToolSpec as _ToolSpec,
)
from strands.hooks import AfterToolCallEvent, HookProvider, HookRegistry
from strands.tools import DecoratedTool
from strands.types.exceptions import ContextOverflowError, MaxTokensReachedException, ToolProviderException
from strands.types.tools import ToolContext

log = logging.getLogger(__name__)


class AgentState(dict[str, Any]):
    """Dict subclass with .set() for SDK compatibility."""

    def set(self, key: str, value: Any) -> None:
        self[key] = value


@dataclass
class ToolEntry:
    """A registered tool — its callable, JSON spec, and optional context parameter."""

    func: Callable[..., Any]
    spec: dict[str, Any]
    context_param: str | None = None


@dataclass
class Metrics:
    """Python-side metrics wrapper with tool_metrics support."""

    latency_ms: float = 0.0
    tool_metrics: list[dict[str, Any]] | None = None


class _ToolMetric:
    """Tracks call/success/error counts for a single tool."""

    def __init__(self) -> None:
        self.call_count = 0
        self.success_count = 0
        self.error_count = 0


class _EventLoopMetrics:
    """Tracks per-tool execution metrics."""

    def __init__(self) -> None:
        self.tool_metrics: dict[str, _ToolMetric] = {}

    def record_call(self, tool_name: str, success: bool) -> None:
        if tool_name not in self.tool_metrics:
            self.tool_metrics[tool_name] = _ToolMetric()
        self.tool_metrics[tool_name].call_count += 1
        if success:
            self.tool_metrics[tool_name].success_count += 1
        else:
            self.tool_metrics[tool_name].error_count += 1


@dataclass
class StreamResult:
    """Structured return value from a streaming invocation."""

    text_parts: list[str] = field(default_factory=list)
    stop_reason: str = "end_turn"
    usage: Any = None
    metrics: Metrics = field(default_factory=Metrics)


class AgentResult:
    """SDK-compatible result from an agent invocation."""

    def __init__(
        self,
        text: str,
        stop_reason: str,
        usage: Any = None,
        metrics: Any = None,
        structured_output: Any = None,
        message: dict[str, Any] | None = None,
        interrupts: list[Any] | None = None,
    ):
        self.text = text
        self.stop_reason = stop_reason
        self.usage = usage
        self.metrics = metrics
        self.structured_output = structured_output
        self.message: dict[str, Any] = message or {
            "role": "assistant",
            "content": [{"text": text}],
        }
        self.interrupts: list[Any] = interrupts or []

    def __str__(self) -> str:
        return self.text

    def __repr__(self) -> str:
        return f"AgentResult(stop_reason={self.stop_reason!r}, text={self.text[:80]!r})"


class _ToolDispatcher(_ToolDispatcherBase):
    """Routes tool calls from the WASM guest to Python handlers."""

    def __init__(self) -> None:
        self._handlers: dict[str, Callable[[str, str], str]] = {}

    def register(self, name: str, handler: Callable[[str, str], str]) -> None:
        self._handlers[name] = handler

    def unregister(self, name: str) -> None:
        self._handlers.pop(name, None)

    def call_tool(self, name: str, input: str, tool_use_id: str) -> str:
        handler = self._handlers.get(name)
        if handler is None:
            return json.dumps({"status": "error", "content": [{"text": f"unknown tool: {name}"}]})
        try:
            return handler(input, tool_use_id)
        except Exception as exc:
            return json.dumps({"status": "error", "content": [{"text": str(exc)}]})


class _LogHandler(_LogHandlerBase):
    """Routes WASM guest log entries to Python's logging framework."""

    def log(self, level: str, message: str, context: str | None) -> None:
        logger = logging.getLogger("strands.wasm")
        py_level = {"error": 40, "warn": 30, "info": 20, "debug": 10, "trace": 10}.get(level, 20)
        msg = f"{message} | {context}" if context else message
        logger.log(py_level, msg)


class _ToolRegistryProxy:
    """Proxy for agent.tool_registry with mutable registry/tool_config."""

    def __init__(self, registry: dict[str, ToolEntry]):
        self.registry = registry
        self.tool_config: dict[str, Any] = {}


class _ToolProxy:
    def __init__(self, tools: dict[str, ToolEntry], agent: Any = None):
        self._tools = tools
        self._agent = agent

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        if name not in self._tools:
            raise AttributeError(f"No tool named '{name}'")
        entry = self._tools[name]
        agent = self._agent

        def invoke(**kwargs: Any) -> dict[str, Any]:
            import uuid

            max_retries = 3
            tool_use_id = f"tooluse_{uuid.uuid4().hex[:24]}"
            for _attempt in range(max_retries + 1):
                call_kwargs: dict[str, Any] = dict(kwargs)
                if entry.context_param and agent is not None:
                    call_kwargs[entry.context_param] = ToolContext(
                        tool_use={"toolUseId": tool_use_id},
                        agent=agent,
                    )
                try:
                    raw = entry.func(**call_kwargs)
                    if isinstance(raw, dict) and "status" in raw and "content" in raw:
                        result: dict[str, Any] = cast(dict[str, Any], raw)
                    else:
                        result = {"status": "success", "content": [{"text": str(cast(Any, raw))}]}
                except Exception as exc:
                    result = {"status": "error", "content": [{"text": str(exc)}]}

                if agent is not None and hasattr(agent, "hooks"):
                    event = AfterToolCallEvent()
                    event.tool_use = {"toolUseId": tool_use_id}
                    event.result = result
                    event.retry = False
                    agent.hooks.fire(event)
                    if event.retry:
                        continue
                return result

        return invoke


class Agent:
    """SDK-compatible Agent wrapping the WASM-hosted runtime.

    Usage matches the existing Python SDK::

        agent = Agent(tools=[my_tool], system_prompt="Be helpful.")
        result = agent("Hello!")
        print(result)
    """

    def __init__(
        self,
        *,
        model: Any = None,
        system_prompt: str | None = None,
        system_prompt_blocks: Any = None,
        tools: list[Any] | None = None,
        messages: list[Any] | None = None,
        callback_handler: Any = None,
        hooks: list[HookProvider] | None = None,
        load_tools_from_directory: bool = False,
        printer: bool = True,
        structured_output_model: type | None = None,
        agent_id: str | None = None,
        session_manager: Any = None,
        **kwargs: Any,
    ):
        if kwargs:
            log.debug("ignoring unknown kwargs: %s", list(kwargs.keys()))

        self.agent_id = agent_id
        self._tool_map: dict[str, ToolEntry] = {}
        self._mcp_clients: list[Any] = []
        self.state = AgentState()
        self.hooks = HookRegistry()
        self.event_loop_metrics = _EventLoopMetrics()
        self._last_tool_result: dict[str, Any] = {}

        if hooks:
            for provider in hooks:
                provider.register_hooks(self.hooks)
        self._default_structured_output_model = structured_output_model
        self._load_tools_from_directory = load_tools_from_directory
        self._tools_dir_mtimes: dict[str, float] = {}
        self._printer = printer

        self._dispatcher = _ToolDispatcher()
        wasm_tools = self._register_tools(tools) if tools is not None else None

        if load_tools_from_directory:
            self._scan_tools_directory()

        sp_blocks = None
        sp_str = system_prompt
        if system_prompt_blocks is not None:
            sp_blocks = (
                system_prompt_blocks
                if isinstance(system_prompt_blocks, str)
                else json.dumps(system_prompt_blocks)
            )
        elif isinstance(system_prompt, list):
            sp_blocks = json.dumps(system_prompt)
            sp_str = None

        # Detect host-side model providers (have stream() method — e.g. SageMaker, Mistral, Writer).
        # These run on the Python side and are invoked by the WASM guest via model-provider import.
        model_provider_callback = None
        if model is not None and hasattr(model, "stream") and callable(getattr(model, "stream", None)):
            from strands.models.host_adapter import HostModelAdapter

            model_provider_callback = HostModelAdapter(model)
            model_config = _ModelConfigInput(
                provider="host-model",
                additional_config=json.dumps({"provider_type": type(model).__name__}),
            )
        else:
            model_config = self._build_model_config(resolve_model(model))

        tool_specs = (
            [
                _ToolSpec(
                    name=t["name"],
                    description=t["description"],
                    input_schema=json.dumps(t.get("inputSchema", {})),
                )
                for t in wasm_tools
            ]
            if wasm_tools
            else None
        )

        self._wasm_agent = _WasmAgent(
            model=model_config,
            system_prompt=sp_str,
            system_prompt_blocks=sp_blocks,
            tools=tool_specs,
            tool_dispatcher=self._dispatcher,
            log_handler=_LogHandler(),
            model_provider=model_provider_callback,
            use_callback_relay=False,
        )

        if messages is not None:
            self._wasm_agent.set_messages(json.dumps(messages))

    @staticmethod
    def _build_model_config(model_dict: dict[str, Any] | None) -> _ModelConfigInput | None:
        if model_dict is None:
            return None
        return _ModelConfigInput(
            provider=model_dict.get("provider", "bedrock"),
            model_id=model_dict.get("model_id"),
            api_key=model_dict.get("api_key"),
            region=model_dict.get("region"),
            access_key_id=model_dict.get("access_key_id"),
            secret_access_key=model_dict.get("secret_access_key"),
            session_token=model_dict.get("session_token"),
            additional_config=model_dict.get("additional_config"),
        )

    def _register_tools(self, tools: list[Any]) -> list[dict[str, Any]]:
        """Parse a tools list into the local tool map and dispatcher.

        Handles DecoratedTool, dict specs, and MCPClient/ToolProvider instances
        (which are expanded via list_tools_sync()).
        """
        wasm_tools: list[dict[str, Any]] = []
        for t in tools:
            if isinstance(t, DecoratedTool):
                self._tool_map[t.tool_name] = ToolEntry(
                    func=t.func,
                    spec=t.tool_spec,
                    context_param=t.context_param,
                )
                handler = t.make_handler(agent_ref=self)
                self._dispatcher.register(t.tool_name, handler)
                wasm_tools.append({
                    "name": t.tool_name,
                    "description": t.tool_spec["description"],
                    "inputSchema": t.tool_spec.get("inputSchema", {}),
                })
            elif isinstance(t, dict):
                td = cast(dict[str, Any], t)
                if "handler" in td:
                    spec = {k: v for k, v in td.items() if k != "handler"}
                    self._tool_map[td["name"]] = ToolEntry(func=td["handler"], spec=spec)
                    self._dispatcher.register(td["name"], td["handler"])
                wasm_tools.append({k: v for k, v in td.items() if k != "handler"})
            elif hasattr(t, "tool_name") and hasattr(t, "tool_spec") and callable(t):
                name = t.tool_name
                spec = t.tool_spec
                agent_ref = self

                def _make_tool_callable(tool_obj: Any) -> Callable[..., Any]:
                    def func(**kwargs: Any) -> Any:
                        return tool_obj(**kwargs)
                    return func

                def _make_tool_handler(tool_obj: Any, agent: Any) -> Callable[[str, str], str]:
                    def handler(input_json: str, tool_use_id: str = "") -> str:
                        data = json.loads(input_json)
                        result = tool_obj(**data)
                        if isinstance(result, dict):
                            agent._last_tool_result = result
                            return json.dumps(result)
                        wrapped = {"status": "success", "content": [{"text": str(result)}]}
                        agent._last_tool_result = wrapped
                        return json.dumps(wrapped)
                    return handler

                self._tool_map[name] = ToolEntry(func=_make_tool_callable(t), spec=spec)
                handler = _make_tool_handler(t, agent_ref)
                self._dispatcher.register(name, handler)
                wasm_tools.append({
                    "name": name,
                    "description": spec.get("description", ""),
                    "inputSchema": spec.get("inputSchema", {}),
                })
            elif hasattr(t, "list_tools_sync"):
                if hasattr(t, "start") and hasattr(t, "_tool_provider_started") and not t._tool_provider_started:
                    try:
                        t.start()
                    except Exception as exc:
                        tp_exc = ToolProviderException(f"Failed to start tool provider: {exc}")
                        tp_exc.__cause__ = exc
                        raise ValueError(f"Failed to load tools from provider: {exc}") from tp_exc
                self._mcp_clients.append(t)
                if hasattr(t, "_consumers"):
                    t._consumers.add(id(self))
                mcp_tools = t.list_tools_sync()
                for mt in mcp_tools:
                    name = mt.tool_name
                    spec = mt.tool_spec

                    def _make_mcp_callable(mcp_tool: Any) -> Callable[..., Any]:
                        def func(**kwargs: Any) -> Any:
                            return mcp_tool(**kwargs)
                        return func

                    def _make_mcp_handler(mcp_tool: Any) -> Callable[[str, str], str]:
                        def handler(input_json: str, tool_use_id: str = "") -> str:
                            data = json.loads(input_json)
                            result = mcp_tool(**data)
                            return json.dumps(result) if isinstance(result, dict) else json.dumps({"status": "success", "content": [{"text": str(result)}]})
                        return handler

                    self._tool_map[name] = ToolEntry(func=_make_mcp_callable(mt), spec=spec)
                    self._dispatcher.register(name, _make_mcp_handler(mt))
                    wasm_tools.append({
                        "name": name,
                        "description": spec.get("description", ""),
                        "inputSchema": spec.get("inputSchema", {}),
                    })
        return wasm_tools

    def _scan_tools_directory(self) -> None:
        """Scan ./tools/ for .py files with @tool-decorated functions."""
        import importlib.util
        from pathlib import Path

        tools_dir = Path.cwd() / "tools"
        if not tools_dir.is_dir():
            return

        for py_file in tools_dir.glob("*.py"):
            mtime = py_file.stat().st_mtime
            name = py_file.stem
            if name in self._tools_dir_mtimes and self._tools_dir_mtimes[name] >= mtime:
                continue
            self._tools_dir_mtimes[name] = mtime
            try:
                spec = importlib.util.spec_from_file_location(f"tools.{name}", py_file)
                if spec is None or spec.loader is None:
                    continue
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                for attr_name in dir(mod):
                    obj = getattr(mod, attr_name)
                    if isinstance(obj, DecoratedTool):
                        self._tool_map[obj.tool_name] = ToolEntry(
                            func=obj.func,
                            spec=obj.tool_spec,
                            context_param=obj.context_param,
                        )
            except Exception:
                log.warning("failed to load tool from %s", py_file, exc_info=True)

    @property
    def messages(self) -> list[dict[str, Any]]:
        raw = json.loads(self._wasm_agent.get_messages())
        return [convert_message(msg) for msg in raw]

    @messages.setter
    def messages(self, value: list[dict[str, Any]]) -> None:
        self._wasm_agent.set_messages(json.dumps(value))

    @property
    def tool(self) -> _ToolProxy:
        if self._load_tools_from_directory:
            self._scan_tools_directory()
        return _ToolProxy(self._tool_map, agent=self)

    @property
    def tool_names(self) -> list[str]:
        if self._load_tools_from_directory:
            self._scan_tools_directory()
        return list(self._tool_map.keys())

    @property
    def tool_registry(self) -> _ToolRegistryProxy:
        return _ToolRegistryProxy(self._tool_map)

    async def _consume_stream_async(
        self,
        prompt: str,
        *,
        tools: Any = None,
        tool_choice: Any = None,
    ) -> StreamResult:
        import time as _time

        result = StreamResult()
        tool_metrics: list[dict[str, Any]] = []
        pending_tool_start: dict[str, float] = {}

        if tools is not None or tool_choice is not None:
            wasm_tool_specs = (
                [
                    _ToolSpec(
                        name=t["name"],
                        description=t.get("description", ""),
                        input_schema=json.dumps(t.get("inputSchema", {})),
                    )
                    for t in tools
                ]
                if tools
                else None
            )
            stream = await self._wasm_agent.start_stream_with_options(
                prompt, wasm_tool_specs, tool_choice,
            )
        else:
            stream = await self._wasm_agent.start_stream(prompt)
        completed = False
        try:
            while True:
                batch = await self._wasm_agent.next_events(stream)
                if batch is None:
                    completed = True
                    break
                for raw_event in batch:
                    if isinstance(raw_event, StreamEvent_Lifecycle):
                        hook_event = lifecycle_event_from_wit(raw_event.value)
                        if hook_event is not None:
                            if isinstance(hook_event, AfterToolCallEvent) and self._last_tool_result:
                                merged = dict(self._last_tool_result)
                                if hasattr(hook_event, "tool_use") and hook_event.tool_use:
                                    merged.setdefault("toolUseId", hook_event.tool_use.get("toolUseId", ""))
                                hook_event.result = merged
                                self._last_tool_result = {}
                            await self.hooks.fire_async(hook_event)
                        continue

                    if isinstance(raw_event, StreamEvent_TextDelta):
                        text = raw_event.value or ""
                        result.text_parts.append(text)
                        if self._printer:
                            print(text, end="", flush=True)

                    elif isinstance(raw_event, StreamEvent_Stop):
                        sd = raw_event.value
                        result.stop_reason = stop_reason_to_snake(sd)
                        result.usage = sd.usage
                        latency = sd.metrics.latency_ms if sd.metrics else 0.0
                        result.metrics = Metrics(latency_ms=latency)
                        if self._printer and result.text_parts:
                            print()

                    elif isinstance(raw_event, StreamEvent_ToolUse):
                        tu = raw_event.value
                        pending_tool_start[tu.tool_use_id] = _time.monotonic()
                        pending_tool_start[f"{tu.tool_use_id}:name"] = tu.name

                    elif isinstance(raw_event, StreamEvent_ToolResult):
                        tr = raw_event.value
                        tid = tr.tool_use_id
                        tool_name = pending_tool_start.pop(f"{tid}:name", "")
                        if tid in pending_tool_start:
                            duration = _time.monotonic() - pending_tool_start.pop(tid)
                            tool_metrics.append({
                                "toolUseId": tid,
                                "duration": duration,
                                "status": tr.status,
                            })
                        success = tr.status == "success"
                        if tool_name:
                            self.event_loop_metrics.record_call(tool_name, success)

                    elif isinstance(raw_event, StreamEvent_Error):
                        err_msg = raw_event.value or ""
                        if "context" in err_msg.lower() and "exceeded" in err_msg.lower():
                            raise ContextOverflowError(err_msg)
                        if "maximum token" in err_msg.lower():
                            raise MaxTokensReachedException(err_msg)
                        if self._printer:
                            print(f"\n[error: {err_msg}]", file=sys.stderr)

        finally:
            if not completed:
                await self._wasm_agent.close_stream(stream)

        if result.stop_reason == "model_context_window_exceeded":
            raise ContextOverflowError("context window exceeded")

        result.metrics.tool_metrics = tool_metrics or None
        return result

    async def _call_async(self, prompt: str, **kwargs: Any) -> AgentResult:
        structured_output_model = kwargs.pop("structured_output_model", None)
        so_model = structured_output_model or self._default_structured_output_model

        if so_model is not None:
            return await self._call_with_structured_output_async(prompt, so_model)

        try:
            sr = await self._consume_stream_async(prompt)
        except ContextOverflowError:
            await self._wasm_agent.set_messages_async("[]")
            sr = await self._consume_stream_async(prompt)
        except MaxTokensReachedException:
            raw = await self._wasm_agent.get_messages_async()
            msgs = [convert_message(m) for m in json.loads(raw)]
            msgs.append({
                "role": "user",
                "content": [{"text": "tool use was incomplete due to maximum token limits being reached"}],
            })
            await self._wasm_agent.set_messages_async(json.dumps(msgs))
            raise

        if sr.stop_reason == "max_tokens":
            raw = await self._wasm_agent.get_messages_async()
            msgs = [convert_message(m) for m in json.loads(raw)]
            msgs.append({
                "role": "user",
                "content": [{"text": "tool use was incomplete due to maximum token limits being reached"}],
            })
            await self._wasm_agent.set_messages_async(json.dumps(msgs))
            raise MaxTokensReachedException("max tokens reached")

        return AgentResult(
            text="".join(sr.text_parts),
            stop_reason=sr.stop_reason,
            usage=sr.usage,
            metrics=sr.metrics,
        )

    async def _call_with_structured_output_async(
        self, prompt: str, so_model: type,
    ) -> AgentResult:
        so_tool_name = so_model.__name__
        schema = flatten_pydantic_schema(so_model.model_json_schema())  # type: ignore[attr-defined]
        so_tool_spec: dict[str, Any] = {
            "name": so_tool_name,
            "description": (getattr(so_model, "__doc__", None) or so_tool_name)
            + " -- You MUST call this tool to return structured output.",
            "inputSchema": schema,
        }

        so_result: Any = None

        def so_handler(input_json: str, _tool_use_id: str = "") -> str:
            nonlocal so_result
            data = json.loads(input_json)
            try:
                so_result = so_model(**data)
                return json.dumps({"status": "success", "content": [{"text": json.dumps(data)}]})
            except Exception as exc:
                raise ValueError(f"Validation error: {exc}") from exc

        self._dispatcher.register(so_tool_name, so_handler)
        try:
            existing_tools = [entry.spec for entry in self._tool_map.values()]
            all_tools = existing_tools + [so_tool_spec]
            sr = await self._consume_stream_async(prompt, tools=all_tools)

            if so_result is None and sr.stop_reason != "max_tokens":
                sr = await self._consume_stream_async(
                    json.dumps([{
                        "text": "You must format the previous response as structured output. "
                        f"Call the {so_tool_name} tool now.",
                    }]),
                    tools=[so_tool_spec],
                    tool_choice=json.dumps({"any": {}}),
                )

            if sr.stop_reason == "max_tokens":
                raise MaxTokensReachedException("max tokens reached")

            return AgentResult(
                text="".join(sr.text_parts),
                stop_reason=sr.stop_reason,
                usage=sr.usage,
                metrics=sr.metrics,
                structured_output=so_result,
            )
        finally:
            self._dispatcher.unregister(so_tool_name)

    def __call__(self, prompt: Any = None, **kwargs: Any) -> AgentResult:
        import asyncio

        if self._load_tools_from_directory:
            self._scan_tools_directory()
        if prompt is None:
            prompt = ""
        if isinstance(prompt, list):
            prompt = json.dumps(prompt, default=self._json_default)
        prompt = str(prompt)
        return asyncio.run(self._call_async(prompt, **kwargs))

    def invoke(self, prompt: str) -> AgentResult:
        old = self._printer
        self._printer = False
        try:
            return self(prompt)
        finally:
            self._printer = old

    async def invoke_async(self, prompt: str, **kwargs: Any) -> AgentResult:
        return await self._call_async(str(prompt), **kwargs)

    def structured_output(self, output_model: type, prompt: Any, **kwargs: Any) -> Any:
        """Invoke the agent with structured output validation. Returns the parsed model instance."""
        result = self(prompt, structured_output_model=output_model, **kwargs)
        return result.structured_output if result.structured_output is not None else result

    async def structured_output_async(self, output_model: type, prompt: Any, **kwargs: Any) -> Any:
        """Invoke the agent with structured output validation (async). Returns the parsed model instance."""
        if isinstance(prompt, list):
            prompt = json.dumps(prompt)
        result = await self._call_async(str(prompt), structured_output_model=output_model, **kwargs)
        return result.structured_output if result.structured_output is not None else result

    async def stream_async(self, prompt: Any, **kwargs: Any) -> Any:
        structured_output_model = kwargs.pop("structured_output_model", None)
        so_model = structured_output_model or self._default_structured_output_model

        if so_model is not None:
            result = await self._call_async(str(prompt), structured_output_model=so_model)
            yield {"result": result}
            return

        stream = await self._wasm_agent.start_stream(str(prompt))
        completed = False
        try:
            while True:
                batch = await self._wasm_agent.next_events(stream)
                if batch is None:
                    completed = True
                    break
                for event in batch:
                    if isinstance(event, StreamEvent_Lifecycle):
                        hook_event = lifecycle_event_from_wit(event.value)
                        if hook_event is not None:
                            await self.hooks.fire_async(hook_event)
                        continue
                    yield event_to_dict(event)
        finally:
            if not completed:
                await self._wasm_agent.close_stream(stream)

    @staticmethod
    def _json_default(obj: Any) -> Any:
        """JSON serializer for objects not serializable by default (e.g., bytes → base64)."""
        import base64

        if isinstance(obj, (bytes, bytearray)):
            return base64.b64encode(obj).decode("ascii")
        raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

    def get_messages(self) -> str:
        return self._wasm_agent.get_messages()

    def set_messages(self, json_str: str) -> None:
        self._wasm_agent.set_messages(json_str)

    def cleanup(self) -> None:
        """Clean up resources (MCP clients, etc.).

        Uses consumer counting: only stops a client when no other agents hold it.
        """
        for client in self._mcp_clients:
            if hasattr(client, "_consumers"):
                client._consumers.discard(id(self))
                if not client._consumers:
                    if hasattr(client, "stop"):
                        client.stop()
            elif hasattr(client, "stop"):
                client.stop()
        self._mcp_clients.clear()


# Re-export for test compatibility
from strands.agent.conversation_manager import NullConversationManager  # noqa: E402

__all__ = ["Agent", "AgentResult", "NullConversationManager"]