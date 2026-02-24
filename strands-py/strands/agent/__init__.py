from __future__ import annotations

import json
import logging
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, cast

from strands._conversions import (
    convert_message,
    event_from_pyo3,
    event_to_dict,
    flatten_pydantic_schema,
    lifecycle_event_from_json,
    resolve_model,
    stop_reason_to_snake,
)
from strands._strands import Agent as _RustAgent
from strands.generated.wit_world.imports.types import (
    StreamEvent_Error,
    StreamEvent_Stop,
    StreamEvent_TextDelta,
    StreamEvent_ToolResult,
    StreamEvent_ToolUse,
)
from strands.hooks import AfterToolCallEvent, HookProvider, HookRegistry
from strands.tools import DecoratedTool
from strands.types.exceptions import ContextOverflowError, MaxTokensReachedException
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

    def __str__(self) -> str:
        return self.text

    def __repr__(self) -> str:
        return f"AgentResult(stop_reason={self.stop_reason!r}, text={self.text[:80]!r})"


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

            tool_use_id = f"tooluse_{uuid.uuid4().hex[:24]}"
            while True:
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
        self.state = AgentState()
        self.hooks = HookRegistry()

        if hooks:
            for provider in hooks:
                provider.register_hooks(self.hooks)
        self._default_structured_output_model = structured_output_model
        self._load_tools_from_directory = load_tools_from_directory
        self._tools_dir_mtimes: dict[str, float] = {}
        self._printer = printer

        rust_tools = self._register_tools(tools) if tools is not None else None

        if load_tools_from_directory:
            self._scan_tools_directory()

        sp_blocks = None
        if system_prompt_blocks is not None:
            sp_blocks = (
                system_prompt_blocks
                if isinstance(system_prompt_blocks, str)
                else json.dumps(system_prompt_blocks)
            )

        self._rust_agent = _RustAgent(
            model=resolve_model(model),
            system_prompt=system_prompt,
            system_prompt_blocks=sp_blocks,
            tools=rust_tools,
        )

        if messages is not None:
            self._rust_agent.set_messages(json.dumps(messages))

    def _register_tools(self, tools: list[Any]) -> list[dict[str, Any]]:
        """Parse a tools list into the local tool map and Rust-side specs."""
        rust_tools: list[dict[str, Any]] = []
        for t in tools:
            if isinstance(t, DecoratedTool):
                self._tool_map[t.tool_name] = ToolEntry(
                    func=t.func,
                    spec=t.tool_spec,
                    context_param=t.context_param,
                )
                rust_tools.append({
                    "name": t.tool_name,
                    "description": t.tool_spec["description"],
                    "inputSchema": t.tool_spec.get("inputSchema", {}),
                    "handler": t.make_handler(agent_ref=self),
                })
            elif isinstance(t, dict):
                td = cast(dict[str, Any], t)
                if "handler" in td:
                    spec = {k: v for k, v in td.items() if k != "handler"}
                    self._tool_map[td["name"]] = ToolEntry(func=td["handler"], spec=spec)
                rust_tools.append({k: v for k, v in td.items() if k != "handler"})
        return rust_tools

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
        raw = json.loads(self._rust_agent.get_messages())
        return [convert_message(msg) for msg in raw]

    @messages.setter
    def messages(self, value: list[dict[str, Any]]) -> None:
        self._rust_agent.set_messages(json.dumps(value))

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

        stream = await self._rust_agent.start_stream(
            prompt, tools=tools, tool_choice=tool_choice,
        )
        try:
            while True:
                batch = await self._rust_agent.next_events(stream)
                if batch is None:
                    break
                for raw_event in batch:
                    if raw_event.kind == "lifecycle":
                        hook_event = lifecycle_event_from_json(raw_event.lifecycle or "")
                        if hook_event is not None:
                            await self.hooks.fire_async(hook_event)
                        continue

                    event = event_from_pyo3(raw_event)
                    if event is None:
                        continue

                    if isinstance(event, StreamEvent_TextDelta):
                        result.text_parts.append(event.value)
                        if self._printer:
                            print(event.value, end="", flush=True)

                    elif isinstance(event, StreamEvent_Stop):
                        result.stop_reason = stop_reason_to_snake(event.value.reason)
                        result.usage = event.value.usage
                        latency = event.value.metrics.latency_ms if event.value.metrics else 0.0
                        result.metrics = Metrics(latency_ms=latency)
                        if self._printer and result.text_parts:
                            print()

                    elif isinstance(event, StreamEvent_ToolUse):
                        pending_tool_start[event.value.tool_use_id] = _time.monotonic()

                    elif isinstance(event, StreamEvent_ToolResult):
                        tid = event.value.tool_use_id
                        if tid in pending_tool_start:
                            duration = _time.monotonic() - pending_tool_start.pop(tid)
                            tool_metrics.append({
                                "toolUseId": tid,
                                "duration": duration,
                                "status": event.value.status,
                            })

                    elif isinstance(event, StreamEvent_Error):
                        err_msg = event.value
                        if "context" in err_msg.lower() and "exceeded" in err_msg.lower():
                            raise ContextOverflowError(err_msg)
                        if "maximum token" in err_msg.lower():
                            raise MaxTokensReachedException(err_msg)
                        if self._printer:
                            print(f"\n[error: {err_msg}]", file=sys.stderr)

        finally:
            await self._rust_agent.close_stream(stream)

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
            self.messages = []
            sr = await self._consume_stream_async(prompt)
        except MaxTokensReachedException:
            msgs = self.messages
            msgs.append({
                "role": "user",
                "content": [{"text": "tool use was incomplete due to maximum token limits being reached"}],
            })
            self.messages = msgs
            raise

        if sr.stop_reason == "max_tokens":
            msgs = self.messages
            msgs.append({
                "role": "user",
                "content": [{"text": "tool use was incomplete due to maximum token limits being reached"}],
            })
            self.messages = msgs
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

        self._rust_agent._register_handler(so_tool_name, so_handler)
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
            self._rust_agent._unregister_handler(so_tool_name)

    def __call__(self, prompt: Any = None, **kwargs: Any) -> AgentResult:
        import asyncio

        if self._load_tools_from_directory:
            self._scan_tools_directory()
        if prompt is None:
            prompt = ""
        if isinstance(prompt, list):
            prompt = json.dumps(prompt)
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

    async def stream_async(self, prompt: Any, **kwargs: Any) -> Any:
        structured_output_model = kwargs.pop("structured_output_model", None)
        so_model = structured_output_model or self._default_structured_output_model

        if so_model is not None:
            result = await self._call_async(str(prompt), structured_output_model=so_model)
            yield {"result": result}
            return

        stream = await self._rust_agent.start_stream(str(prompt))
        try:
            while True:
                batch = await self._rust_agent.next_events(stream)
                if batch is None:
                    break
                for event in batch:
                    if event.kind == "lifecycle":
                        hook_event = lifecycle_event_from_json(event.lifecycle or "")
                        if hook_event is not None:
                            await self.hooks.fire_async(hook_event)
                        continue
                    yield event_to_dict(event)
        finally:
            await self._rust_agent.close_stream(stream)

    def get_messages(self) -> str:
        return self._rust_agent.get_messages()

    def set_messages(self, json_str: str) -> None:
        self._rust_agent.set_messages(json_str)


# Re-export for test compatibility
from strands.agent.conversation_manager import NullConversationManager  # noqa: E402

__all__ = ["Agent", "AgentResult", "NullConversationManager"]
