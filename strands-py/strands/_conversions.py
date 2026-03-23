"""Conversions between UniFFI types and upstream Python SDK formats.

Stream events are flat structs with a .kind discriminator and optional typed
fields (.text_delta, .stop, .tool_use, .tool_result, .metadata, .error, .interrupt).
Functions here convert these to the dict format the upstream Python SDK expects.
"""

from __future__ import annotations

import json
import logging
from typing import Any, cast

from strands.hooks import (
    AfterInvocationEvent,
    AfterModelCallEvent,
    AfterToolCallEvent,
    AgentInitializedEvent,
    BeforeInvocationEvent,
    BeforeModelCallEvent,
    BeforeToolCallEvent,
    MessageAddedEvent,
)

log = logging.getLogger(__name__)


def _safe_json_loads(s: str | None, default: Any = None) -> Any:
    """Parse JSON, returning *default* on failure or empty input."""
    if not s:
        return default
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        log.debug("malformed JSON: %s", s[:120] if s else "")
        return default


_LIFECYCLE_EVENT_MAP: dict[str, type] = {
    "initialized": AgentInitializedEvent,
    "before-invocation": BeforeInvocationEvent,
    "after-invocation": AfterInvocationEvent,
    "before-model-call": BeforeModelCallEvent,
    "after-model-call": AfterModelCallEvent,
    "before-tool-call": BeforeToolCallEvent,
    "after-tool-call": AfterToolCallEvent,
    "message-added": MessageAddedEvent,
}


def lifecycle_event_from_wit(lifecycle: Any) -> object | None:
    """Convert a structured WIT LifecycleEvent into a hook event instance, or None.

    The lifecycle object has: event_type (WIT enum), tool_use (optional JSON string),
    result (optional JSON string).
    """
    event_type = lifecycle.event_type
    if event_type is None:
        return None

    # The WIT enum comes through UniFFI as an object with a .value string attribute.
    type_str = event_type.value if hasattr(event_type, "value") else str(event_type)
    cls = _LIFECYCLE_EVENT_MAP.get(type_str)
    if cls is None:
        return None
    event = cls()

    if type_str == "before-tool-call":
        tool_use = _safe_json_loads(lifecycle.tool_use)
        if tool_use and hasattr(event, "tool_use"):
            event.tool_use = tool_use
    elif type_str == "after-tool-call":
        tool_use = _safe_json_loads(lifecycle.tool_use)
        result = _safe_json_loads(lifecycle.tool_result)
        if tool_use and hasattr(event, "tool_use"):
            event.tool_use = tool_use
        if result and hasattr(event, "result"):
            event.result = result

    return event



def stop_reason_to_snake(stop: Any) -> str:
    """Convert a WIT stop reason to the snake_case string the upstream Python SDK uses.

    The WIT stop reason arrives as a UniFFI record with a .value string like "end-turn".
    The upstream Python SDK uses "end_turn".
    """
    reason = stop.reason if stop else None
    if reason and hasattr(reason, "value"):
        return reason.value.replace("-", "_")
    return "end_turn"


def event_to_dict(event: Any) -> dict[str, Any]:
    """Convert a Rust StreamEvent into the dict format the Python SDK expects.

    Returns a plain dict. The "stop" branch returns a partial result dict —
    the caller is responsible for filling in the accumulated text.
    """
    from strands.agent import AgentResult

    if event.kind == "text-delta":
        return {
            "event": {"contentBlockDelta": {"delta": {"text": event.text_delta or ""}}},
        }

    if event.kind == "stop":
        stop_reason = stop_reason_to_snake(event.stop)
        usage = event.stop.usage if event.stop else None
        metrics = event.stop.metrics if event.stop else None
        return {
            "result": AgentResult(
                text="", stop_reason=stop_reason, usage=usage, metrics=metrics,
            ),
        }

    if event.kind == "tool-use":
        tu = event.tool_use
        tool_use_data: dict[str, Any] = (
            {
                "name": tu.name,
                "toolUseId": tu.tool_use_id,
                "input": _safe_json_loads(tu.input, {}),
            }
            if tu
            else {}
        )
        return {
            "event": {
                "contentBlockStart": {
                    "contentBlock": {"type": "tool_use", **tool_use_data},
                },
            },
        }

    if event.kind == "tool-result":
        tr = event.tool_result
        tool_result_data: dict[str, Any] = (
            {
                "toolUseId": tr.tool_use_id,
                "status": tr.status,
                "content": _safe_json_loads(tr.content, []),
            }
            if tr
            else {}
        )
        return {"event": {"toolResult": tool_result_data}}

    if event.kind == "metadata":
        me = event.metadata
        metadata: dict[str, Any] = {}
        if me:
            if me.usage:
                metadata["usage"] = {
                    "inputTokens": me.usage.input_tokens,
                    "outputTokens": me.usage.output_tokens,
                    "totalTokens": me.usage.total_tokens,
                    "cacheReadInputTokens": me.usage.cache_read_input_tokens,
                    "cacheWriteInputTokens": me.usage.cache_write_input_tokens,
                }
            if me.metrics:
                metadata["metrics"] = {"latencyMs": me.metrics.latency_ms}
        return {"event": {"metadata": metadata}}

    if event.kind == "error":
        return {"error": event.error}

    log.warning("unknown stream event kind: %s", event.kind)
    return {}


def convert_message(msg: dict[str, Any]) -> dict[str, Any]:
    """Convert a single message from TS SDK format to Python SDK format."""
    if "content" not in msg:
        return msg
    return {**msg, "content": [_convert_block(b) for b in msg["content"]]}


def _convert_block(block: dict[str, Any]) -> dict[str, Any]:
    """Convert a content block from TS SDK format to Python SDK format."""
    block_type = block.get("type")
    if block_type == "textBlock":
        return {"text": block.get("text", "")}
    if block_type == "toolUseBlock":
        return {
            "toolUse": {
                "name": block.get("name", ""),
                "toolUseId": block.get("toolUseId", ""),
                "input": block.get("input", {}),
            },
        }
    if block_type == "toolResultBlock":
        return {
            "toolResult": {
                "toolUseId": block.get("toolUseId", ""),
                "status": block.get("status", "success"),
                "content": _unwrap_tool_content(block.get("content", [])),
            },
        }
    if "toolResult" in block:
        tr = block["toolResult"]
        tr["content"] = _unwrap_tool_content(tr.get("content", []))
        return block
    return block


def _unwrap_tool_content(content: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Unwrap TS SDK tool result content to Python SDK format."""
    result: list[dict[str, Any]] = []
    for item in content:
        item_type: str | None = item.get("type")
        if item_type == "jsonBlock" or (item_type is None and "json" in item):
            json_val: Any = item.get("json", {})
            if isinstance(json_val, dict) and "$value" in json_val:
                for inner in cast(list[Any], json_val["$value"]):
                    if isinstance(inner, dict):
                        result.append(cast(dict[str, Any], inner))
                    else:
                        result.append({"text": str(inner)})
            else:
                result.append({"json": json_val})
        elif item_type == "textBlock":
            result.append({"text": item.get("text", "")})
        else:
            result.append(item)
    return result


def flatten_pydantic_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Flatten a pydantic JSON schema by resolving all $ref/$defs inline."""
    defs: dict[str, Any] = schema.get("$defs", {})

    def resolve(obj: Any) -> Any:
        if not isinstance(obj, dict):
            return obj
        d = cast(dict[str, Any], obj)
        if "$ref" in d:
            ref_name: str = d["$ref"].rsplit("/", 1)[-1]
            return resolve(defs.get(ref_name, {}))
        return {k: resolve(v) for k, v in d.items() if k != "$defs"}

    resolved: dict[str, Any] = resolve(schema)
    resolved.pop("$defs", None)
    return resolved


def resolve_model(model: Any) -> dict[str, Any] | None:
    """Normalize a model argument into a config dict (or None for default)."""
    if model is None:
        return None
    if isinstance(model, dict):
        return cast(dict[str, Any], model)
    if isinstance(model, str):
        return {"provider": "bedrock", "model_id": model}
    if hasattr(model, "_to_config_dict"):
        config: dict[str, Any] = model._to_config_dict()
        return config
    return None
