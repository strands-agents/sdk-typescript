"""Wasmtime-backed runtime adapter for :class:`strands.Agent`.

Implementation detail of the public SDK surface in ``strands/__init__.py``.
This module owns:

* the process-wide ``Engine`` + ``Component`` (one wasm load per process)
* the per-Agent ``Store`` + ``Linker`` + ``Instance`` lifecycle
* host-import callbacks (``tool-provider.call-tool``, ``host-log``)
* the host-side ``tool-event-stream`` resource the wasm component drains
* the async :class:`EventStream` wrapper that turns the sync wasm
  ``read()`` call into an ``AsyncIterator`` for SDK callers

External SDK code talks to ``_AgentRuntime`` and ``EventStream``; everything
else (WASI setup, marshaling, resource bookkeeping) is private.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable

from wasmtime import Config, Engine, Store, WasiConfig
from wasmtime.component import (
    Component,
    Linker,
    ResourceAny,
    ResourceHost,
    ResourceType,
    Variant,
)

from . import _generated as _t

if TYPE_CHECKING:
    from . import Agent


_GUEST_LOGGER = logging.getLogger("strands.guest")


_singleton_lock = threading.RLock()
_engine: Engine | None = None
_component: Component | None = None


def _wasm_path() -> Path:
    env = os.environ.get("STRANDS_AGENT_WASM")
    if env:
        return Path(env)

    bundled = Path(__file__).resolve().parent / "strands-agent.wasm"
    if bundled.exists():
        return bundled

    sdk_root = Path(__file__).resolve().parents[3]
    dev = sdk_root / "strands-wasm" / "dist" / "strands-agent.wasm"
    if dev.exists():
        return dev

    raise FileNotFoundError(
        "Could not locate strands-agent.wasm. Set STRANDS_AGENT_WASM, install the "
        "bundled wheel, or build strands-wasm/dist/strands-agent.wasm."
    )


def _get_engine() -> Engine:
    global _engine
    with _singleton_lock:
        if _engine is None:
            cfg = Config()
            cfg.wasm_component_model = True
            _engine = Engine(cfg)
        return _engine


def _get_component() -> Component:
    global _component
    with _singleton_lock:
        if _component is None:
            _component = Component.from_file(_get_engine(), str(_wasm_path()))
        return _component


_TOOL_STREAM_RESOURCE_TYPE_TAG = 0x1
_tool_stream_resource_type: ResourceType | None = None
_tool_stream_reps: dict[int, "_HostToolEventStream"] = {}
_tool_stream_next_rep = 1
_tool_stream_lock = threading.Lock()


class _HostToolEventStream:
    """Host-side tool-event-stream backing a single ``call-tool`` invocation.

    Holds a queue of WIT ``tool-stream-event`` Variants. ``read()`` returns
    them one at a time, then ``None`` after the terminal ``complete`` /
    ``error`` event has been delivered.
    """

    def __init__(self) -> None:
        self._events: list[Variant] = []
        self._closed = False

    def push(self, event: Variant) -> None:
        self._events.append(event)

    def close(self) -> None:
        self._closed = True

    def read(self) -> Variant | None:
        if self._events:
            return self._events.pop(0)
        return None


def _tool_stream_register(stream: _HostToolEventStream) -> int:
    global _tool_stream_next_rep
    with _tool_stream_lock:
        rep = _tool_stream_next_rep
        _tool_stream_next_rep += 1
        _tool_stream_reps[rep] = stream
        return rep


def _tool_stream_lookup(rep: int) -> _HostToolEventStream:
    with _tool_stream_lock:
        return _tool_stream_reps[rep]


def _tool_stream_drop(_store: Any, rep: int) -> None:
    with _tool_stream_lock:
        _tool_stream_reps.pop(rep, None)


def _ensure_tool_stream_type() -> ResourceType:
    global _tool_stream_resource_type
    if _tool_stream_resource_type is None:
        _tool_stream_resource_type = ResourceType.host(_TOOL_STREAM_RESOURCE_TYPE_TAG)
    return _tool_stream_resource_type


def _make_tool_call_handler(agent: "Agent"):
    def call_tool(store: Any, args: Any) -> ResourceHost:
        name = getattr(args, "name", "")
        raw_input = getattr(args, "input", "")
        stream = _HostToolEventStream()
        try:
            tool = agent._lookup_tool(name)
            content_list = tool.invoke(raw_input)
        except Exception as exc:  # noqa: BLE001  surface any tool exception as a tool-error
            stream.push(_t.ToolStreamEvent.error(_t.ToolError.execution_failed(str(exc))))
            stream.close()
        else:
            # content_list items are already ToolResultContent wire variants.
            stream.push(_t.ToolStreamEvent.complete(content_list))
            stream.close()

        rep = _tool_stream_register(stream)
        return ResourceHost.own(rep, _TOOL_STREAM_RESOURCE_TYPE_TAG)

    return call_tool


def _host_log(_store: Any, entry: Any) -> None:
    level = getattr(entry, "level", "info")
    if not isinstance(level, str):
        level = str(level)
    message = getattr(entry, "message", "")
    context_raw = getattr(entry, "context", None)
    extra = {}
    if context_raw:
        try:
            extra = {"context": json.loads(context_raw)}
        except Exception:
            extra = {"context": context_raw}
    py_level = {
        "trace": logging.DEBUG,
        "debug": logging.DEBUG,
        "info": logging.INFO,
        "warn": logging.WARNING,
        "error": logging.ERROR,
    }.get(level.lower(), logging.INFO)
    _GUEST_LOGGER.log(py_level, message, extra={"strands": extra} if extra else None)


def _tool_event_stream_read(store: Any, handle: ResourceAny) -> Variant | None:
    host = handle.to_host(store)
    rep = host.rep
    stream = _tool_stream_lookup(rep)
    return stream.read()


def _trap(name: str):
    def _f(*_a, **_k):
        raise RuntimeError(f"host import not implemented: {name}")
    return _f


_MODEL_EVENT_STREAM_TYPE_TAG = 0x2


def _register_imports(linker: Linker, agent: "Agent") -> None:
    tool_stream_type = _ensure_tool_stream_type()
    # model-provider's host-side stream type. Only reached on custom providers.
    model_event_stream_type = ResourceType.host(_MODEL_EVENT_STREAM_TYPE_TAG)

    with linker.root() as root:
        with root.add_instance("strands:agent/host-log@0.1.0") as ns:
            ns.add_func("log", _host_log)

        with root.add_instance("strands:agent/tools@0.1.0") as ns:
            ns.add_resource("tool-event-stream", tool_stream_type, _tool_stream_drop)
            ns.add_func("[method]tool-event-stream.read", _tool_event_stream_read)

        with root.add_instance("strands:agent/tool-provider@0.1.0") as ns:
            ns.add_func("call-tool", _make_tool_call_handler(agent))

        # Stubs for the imports the basic Agent.invoke flow never reaches.
        with root.add_instance("strands:agent/model-provider@0.1.0") as ns:
            ns.add_resource("model-event-stream", model_event_stream_type, lambda _s, _r: None)
            ns.add_func("[method]model-event-stream.read", _trap("model-event-stream.read"))
            ns.add_func("start-stream", _trap("model-provider.start-stream"))
            ns.add_func("count-tokens", _trap("model-provider.count-tokens"))

        with root.add_instance("strands:agent/snapshot-storage@0.1.0") as ns:
            for fname in ("save-snapshot", "load-snapshot", "list-snapshot-ids",
                          "delete-session", "load-manifest", "save-manifest"):
                ns.add_func(fname, _trap(f"snapshot-storage.{fname}"))

        with root.add_instance("strands:agent/snapshot-trigger-handler@0.1.0") as ns:
            ns.add_func("should-snapshot", _trap("snapshot-trigger-handler.should-snapshot"))

        with root.add_instance("strands:agent/edge-handler-registry@0.1.0") as ns:
            ns.add_func("evaluate", _trap("edge-handler-registry.evaluate"))

        with root.add_instance("strands:agent/elicitation-handler@0.1.0") as ns:
            ns.add_func("elicit", _trap("elicitation-handler.elicit"))


# --- Store + Linker -----------------------------------------------------

def _make_store_and_linker(agent: "Agent") -> tuple[Store, Linker]:
    engine = _get_engine()
    store = Store(engine)
    wasi = WasiConfig()
    wasi.inherit_stdout()
    wasi.inherit_stderr()
    wasi.inherit_env()
    store.set_wasi(wasi)
    store.set_wasi_http()

    linker = Linker(engine)
    linker.allow_shadowing = True
    linker.add_wasip2()
    linker.add_wasi_http_async()
    _register_imports(linker, agent)
    return store, linker


class EventStream:
    """Async iterator over guest-emitted :class:`StreamEvent` values.

    Wraps the wasm-side ``[method]event-stream.read`` call. Each ``__anext__``
    runs ``read`` on a worker thread so the asyncio loop stays responsive
    while the guest blocks waiting for the next event.
    """

    def __init__(self, runtime: "_AgentRuntime", handle: ResourceAny) -> None:
        self._runtime = runtime
        self._handle: ResourceAny | None = handle
        self._closed = False

    def __aiter__(self) -> "EventStream":
        return self

    async def __anext__(self) -> Any:
        if self._closed or self._handle is None:
            raise StopAsyncIteration
        raw = await self._runtime.event_stream_read(self._handle)
        if raw is None:
            self._closed = True
            handle = self._handle
            self._handle = None
            handle.drop(self._runtime._store)
            raise StopAsyncIteration
        # Lift the wire Variant into an SDK StreamEventBase subclass.
        from . import _lift_stream_event

        return _lift_stream_event(raw)


class _AgentRuntime:
    """Lazy wrapper around the wasm Agent resource for one ``strands.Agent``.

    Construction is split across :meth:`__init__` (sync, cheap) and
    :meth:`async_init` (drives the wasm constructor through ``call_async``).
    Callers must await ``async_init`` before invoking any other method.
    """

    def __init__(self, agent: "Agent") -> None:
        self._agent = agent
        self._lock = threading.Lock()
        self._store, self._linker = _make_store_and_linker(agent)
        self._instance = self._linker.instantiate(self._store, _get_component())
        self._funcs = _ApiFuncs(self._store, self._instance)
        self._handle: ResourceAny | None = None
        self._current_response: ResourceAny | None = None

    def init(self) -> None:
        if self._handle is not None:
            return
        # The bindgen AgentConfig is already wire-shape; pass through.
        self._handle = self._funcs.constructor(self._store, self._agent._config)
        self._funcs.constructor.post_return(self._store)

    async def async_init(self) -> None:
        # Async hook so callers don't need to know construction is sync.
        self.init()

    async def generate(self, args: _t.InvokeArgs) -> EventStream:
        # Run sync wasm calls in a worker thread so the asyncio loop stays free.
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._generate_blocking, args)

    def _generate_blocking(self, args: _t.InvokeArgs) -> EventStream:
        with self._lock:
            response_handle: ResourceAny = self._funcs.generate(self._store, self._handle, args)
            self._funcs.generate.post_return(self._store)
            self._current_response = response_handle
            stream_handle: ResourceAny = self._funcs.events(self._store, response_handle)
            self._funcs.events.post_return(self._store)
            return EventStream(self, stream_handle)

    def cancel(self) -> None:
        with self._lock:
            handle = self._current_response
            if handle is None:
                return
            self._funcs.cancel(self._store, handle)
            self._funcs.cancel.post_return(self._store)

    async def respond(self, args: _t.RespondArgs) -> None:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._respond_blocking, args)

    def _respond_blocking(self, args: _t.RespondArgs) -> None:
        with self._lock:
            handle = self._current_response
            if handle is None:
                from . import StrandsError

                raise StrandsError("respond() called with no in-flight invocation")
            res = self._funcs.respond(self._store, handle, args)
            self._funcs.respond.post_return(self._store)
        _raise_on_err(res)

    async def get_messages(self) -> list[_t.Message]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._get_messages_blocking)

    def _get_messages_blocking(self) -> list[Any]:
        with self._lock:
            raw = self._funcs.get_messages(self._store, self._handle)
            self._funcs.get_messages.post_return(self._store)
        return raw  # wasmtime-py records expose the same kebab-case attrs as bindgen Message

    async def set_messages(self, messages: Iterable[Any]) -> None:
        # bindgen Message instances are already wire-shape; pass through.
        wit = list(messages)
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._set_messages_blocking, wit)

    def _set_messages_blocking(self, wit: list[Any]) -> None:
        with self._lock:
            res = self._funcs.set_messages(self._store, self._handle, wit)
            self._funcs.set_messages.post_return(self._store)
        _raise_on_err(res)

    async def get_app_state(self) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._get_app_state_blocking)

    def _get_app_state_blocking(self) -> dict[str, Any]:
        with self._lock:
            raw = self._funcs.get_app_state(self._store, self._handle)
            self._funcs.get_app_state.post_return(self._store)
        return json.loads(raw) if raw else {}

    async def set_app_state(self, state: dict[str, Any]) -> None:
        payload = json.dumps(state)
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._set_app_state_blocking, payload)

    def _set_app_state_blocking(self, payload: str) -> None:
        with self._lock:
            res = self._funcs.set_app_state(self._store, self._handle, payload)
            self._funcs.set_app_state.post_return(self._store)
        _raise_on_err(res)

    async def get_model_state(self) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._get_model_state_blocking)

    def _get_model_state_blocking(self) -> dict[str, Any]:
        with self._lock:
            raw = self._funcs.get_model_state(self._store, self._handle)
            self._funcs.get_model_state.post_return(self._store)
        return json.loads(raw) if raw else {}

    async def set_model_state(self, state: dict[str, Any]) -> None:
        payload = json.dumps(state)
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._set_model_state_blocking, payload)

    def _set_model_state_blocking(self, payload: str) -> None:
        with self._lock:
            res = self._funcs.set_model_state(self._store, self._handle, payload)
            self._funcs.set_model_state.post_return(self._store)
        _raise_on_err(res)

    async def event_stream_read(self, handle: ResourceAny) -> Variant | None:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._event_stream_read_blocking, handle)

    def _event_stream_read_blocking(self, handle: ResourceAny) -> Variant | None:
        with self._lock:
            raw = self._funcs.event_stream_read(self._store, handle)
            self._funcs.event_stream_read.post_return(self._store)
        return raw


def _raise_on_err(res: Any) -> None:
    if isinstance(res, Variant) and res.tag == "err":
        from . import StrandsError

        # res.payload is a wire AgentError Variant; surface it raw for now.
        raise StrandsError(f"agent call failed: {res.payload!r}")


class _ApiFuncs:
    """Caches every exported function from ``strands:agent/api@0.1.0``."""

    def __init__(self, store: Store, instance: Any) -> None:
        api = instance.get_export_index(store, "strands:agent/api@0.1.0")
        if api is None:
            raise RuntimeError("component is missing strands:agent/api@0.1.0 export")

        def f(name: str):
            fn = instance.get_func(store, instance.get_export_index(store, name, api))
            if fn is None:
                raise RuntimeError(f"missing api export: {name}")
            return fn

        self.constructor = f("[constructor]agent")
        self.generate = f("[method]agent.generate")
        self.get_messages = f("[method]agent.get-messages")
        self.set_messages = f("[method]agent.set-messages")
        self.get_app_state = f("[method]agent.get-app-state")
        self.set_app_state = f("[method]agent.set-app-state")
        self.get_model_state = f("[method]agent.get-model-state")
        self.set_model_state = f("[method]agent.set-model-state")
        self.events = f("[method]response-stream.events")
        self.respond = f("[method]response-stream.respond")
        self.cancel = f("[method]response-stream.cancel")
        self.event_stream_read = f("[method]event-stream.read")
