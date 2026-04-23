"""Generic adapter that bridges a Python model provider to the WIT model-provider callback.

Wraps any Python model that has a `stream()` generator (sync or async) and
collects its StreamEvent output, serializing it for the WIT boundary.
"""

import asyncio
import inspect
import json
import logging
import threading
from typing import Any

from strands._wasm_host import ModelProviderBase

logger = logging.getLogger(__name__)


def _run_in_thread(coro: Any) -> Any:
    """Run an async coroutine in a new thread with a fresh event loop.

    This is needed because the adapter's invoke() is called from within
    wasmtime-py's async execution context, which already owns the event loop.
    We cannot use asyncio.run() (loop already running) or await (we're in a
    sync callback). Spawning a dedicated thread with its own loop is the
    only safe option.
    """
    result: list[Any] = [None]
    exc: list[BaseException | None] = [None]

    def _target() -> None:
        try:
            result[0] = asyncio.run(coro)
        except BaseException as e:
            exc[0] = e

    t = threading.Thread(target=_target)
    t.start()
    t.join()
    if exc[0] is not None:
        raise exc[0]
    return result[0]


class HostModelAdapter(ModelProviderBase):
    """Implements the UniFFI ModelProvider foreign trait.

    Wraps a Python model instance (SageMaker, Mistral, Writer, etc.) and
    adapts its async stream() output into the JSON event list the WASM
    guest expects.
    """

    def __init__(self, model: Any) -> None:
        self._model = model

    def invoke(
        self,
        messages: str,
        system_prompt: str | None,
        tool_specs: str | None,
        config: str,
    ) -> list[str]:
        """Called when the WASM guest invokes model-provider.invoke().

        Deserializes the WIT args, calls the Python model's stream(),
        collects all events, and returns them as JSON strings.
        """
        logger.debug("host model invoke: messages_len=%d", len(messages))
        parsed_messages = json.loads(messages)

        parsed_tool_specs = None
        if tool_specs:
            raw_specs = json.loads(tool_specs)
            parsed_tool_specs = []
            for spec in raw_specs:
                input_schema = spec.get("inputSchema", "{}")
                if isinstance(input_schema, str):
                    try:
                        input_schema = json.loads(input_schema)
                    except json.JSONDecodeError:
                        input_schema = {}
                parsed_tool_specs.append({
                    "name": spec["name"],
                    "description": spec["description"],
                    "inputSchema": {"json": input_schema},
                })

        # Call model.stream() — may return a sync generator or async generator.
        gen = self._model.stream(
            parsed_messages, tool_specs=parsed_tool_specs, system_prompt=system_prompt,
        )

        events: list[str] = []
        if inspect.isasyncgen(gen):
            logger.debug("host model: async generator, running in thread")
            collected = _run_in_thread(self._collect_async(gen))
            events = [json.dumps(self._normalize_event(e)) for e in collected]
        else:
            logger.debug("host model: sync generator")
            for event in gen:
                events.append(json.dumps(self._normalize_event(event)))

        logger.debug("host model invoke: collected %d events", len(events))
        return events

    @staticmethod
    async def _collect_async(gen: Any) -> list[dict[str, Any]]:
        """Drain an async generator into a list."""
        events: list[dict[str, Any]] = []
        async for event in gen:
            events.append(event)
        return events

    # Mapping from Python SDK event keys to TS ModelStreamEvent converters.
    # Add new entries here when new event types are introduced.
    _EVENT_MAP: dict[str, Any] = {}

    @classmethod
    def _normalize_event(cls, event: dict[str, Any]) -> dict[str, Any]:
        """Convert a Python StreamEvent dict into the TS ModelStreamEvent JSON format.

        The Python SDK uses keys like messageStart, contentBlockDelta, messageStop.
        The TS SDK uses types like modelMessageStartEvent, modelContentBlockDeltaEvent, etc.
        Unrecognized events are passed through as-is with a debug log.
        """
        for key, converter in cls._EVENT_MAP.items():
            if key in event:
                return converter(event[key])

        logger.debug("unrecognized event keys: %s — passing through", list(event.keys()))
        return event

    @staticmethod
    def _convert_message_start(payload: dict[str, Any]) -> dict[str, Any]:
        return {"type": "modelMessageStartEvent", "role": payload["role"]}

    @staticmethod
    def _convert_content_block_start(payload: dict[str, Any]) -> dict[str, Any]:
        start = payload.get("start", {})
        result: dict[str, Any] = {"type": "modelContentBlockStartEvent"}
        if "toolUse" in start:
            result["start"] = {
                "type": "toolUseStart",
                "name": start["toolUse"]["name"],
                "toolUseId": start["toolUse"]["toolUseId"],
            }
        return result

    @staticmethod
    def _convert_content_block_delta(payload: dict[str, Any]) -> dict[str, Any]:
        delta = payload["delta"]
        if "text" in delta:
            return {"type": "modelContentBlockDeltaEvent", "delta": {"type": "textDelta", "text": delta["text"]}}
        if "toolUse" in delta:
            return {"type": "modelContentBlockDeltaEvent", "delta": {"type": "toolUseInputDelta", "input": delta["toolUse"]["input"]}}
        if "reasoningContent" in delta:
            return {"type": "modelContentBlockDeltaEvent", "delta": {"type": "reasoningContentDelta", "text": delta["reasoningContent"].get("text", "")}}
        return {"type": "modelContentBlockDeltaEvent", "delta": delta}

    @staticmethod
    def _convert_content_block_stop(_payload: dict[str, Any]) -> dict[str, Any]:
        return {"type": "modelContentBlockStopEvent"}

    @staticmethod
    def _convert_message_stop(payload: dict[str, Any]) -> dict[str, Any]:
        return {"type": "modelMessageStopEvent", "stopReason": payload["stopReason"]}

    @staticmethod
    def _convert_metadata(payload: dict[str, Any]) -> dict[str, Any]:
        result: dict[str, Any] = {"type": "modelMetadataEvent"}
        if "usage" in payload:
            result["usage"] = payload["usage"]
        if "metrics" in payload:
            result["metrics"] = payload["metrics"]
        return result


# Register converters — add new event types here.
HostModelAdapter._EVENT_MAP = {
    "messageStart": HostModelAdapter._convert_message_start,
    "contentBlockStart": HostModelAdapter._convert_content_block_start,
    "contentBlockDelta": HostModelAdapter._convert_content_block_delta,
    "contentBlockStop": HostModelAdapter._convert_content_block_stop,
    "messageStop": HostModelAdapter._convert_message_stop,
    "metadata": HostModelAdapter._convert_metadata,
}