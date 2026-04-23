"""Amazon SageMaker model provider (host-side).

This model runs on the Python/host side and is invoked by the WASM guest
via the model-provider WIT import.
"""

import json
import logging
import os
from collections.abc import Generator
from dataclasses import dataclass
from typing import Any, TypedDict

import boto3
from botocore.config import Config as BotocoreConfig

from ..types.content import Messages
from ..types.tools import ToolSpec
from ._validation import validate_config_keys

logger = logging.getLogger(__name__)


@dataclass
class UsageMetadata:
    """Usage metadata from the model response."""

    total_tokens: int = 0
    completion_tokens: int = 0
    prompt_tokens: int = 0

    _KNOWN_KEYS = {"total_tokens", "completion_tokens", "prompt_tokens"}

    def __init__(self, **kwargs: Any) -> None:
        self.total_tokens = kwargs.get("total_tokens", 0)
        self.completion_tokens = kwargs.get("completion_tokens", 0)
        self.prompt_tokens = kwargs.get("prompt_tokens", 0)
        unknown = set(kwargs) - self._KNOWN_KEYS
        if unknown:
            logger.debug("UsageMetadata: ignoring unknown fields: %s", unknown)


@dataclass
class FunctionCall:
    """Function call returned by the model."""

    name: str | dict[Any, Any]
    arguments: str | dict[Any, Any]

    def __init__(self, **kwargs: Any) -> None:
        self.name = kwargs.get("name", "")
        self.arguments = kwargs.get("arguments", "")


@dataclass
class ToolCall:
    """Tool call returned by the model."""

    id: str
    type: str
    function: FunctionCall

    def __init__(self, **kwargs: Any) -> None:
        self.id = str(kwargs.get("id", ""))
        self.type = "function"
        self.function = FunctionCall(**kwargs.get("function", {"name": "", "arguments": ""}))


class SageMakerAIModel:
    """Amazon SageMaker model provider implementation (host-side).

    This model provider runs entirely in Python. The WASM guest delegates
    inference to it via the model-provider WIT import.
    """

    class SageMakerAIPayloadSchema(TypedDict, total=False):
        """Payload schema for the Amazon SageMaker AI model."""

        max_tokens: int
        stream: bool
        temperature: float | None
        top_p: float | None
        top_k: int | None
        stop: list[str] | None
        additional_args: dict[str, Any] | None

    class SageMakerAIEndpointConfig(TypedDict, total=False):
        """Configuration options for SageMaker endpoints."""

        endpoint_name: str
        region_name: str
        inference_component_name: str | None
        target_model: str | None
        target_variant: str | None
        additional_args: dict[str, Any] | None

    def __init__(
        self,
        endpoint_config: SageMakerAIEndpointConfig,
        payload_config: SageMakerAIPayloadSchema,
        boto_session: boto3.Session | None = None,
        boto_client_config: BotocoreConfig | None = None,
    ) -> None:
        validate_config_keys(endpoint_config, self.SageMakerAIEndpointConfig)
        validate_config_keys(payload_config, self.SageMakerAIPayloadSchema)
        payload_config.setdefault("stream", True)
        self.endpoint_config = self.SageMakerAIEndpointConfig(**endpoint_config)
        self.payload_config = self.SageMakerAIPayloadSchema(**payload_config)

        region = self.endpoint_config.get("region_name") or os.getenv("AWS_REGION") or "us-west-2"
        session = boto_session or boto3.Session(region_name=str(region))

        if boto_client_config:
            existing_ua = getattr(boto_client_config, "user_agent_extra", None)
            new_ua = f"{existing_ua} strands-agents" if existing_ua else "strands-agents"
            client_config = boto_client_config.merge(BotocoreConfig(user_agent_extra=new_ua))
        else:
            client_config = BotocoreConfig(user_agent_extra="strands-agents")

        self.client = session.client(service_name="sagemaker-runtime", config=client_config)

    def get_config(self) -> "SageMakerAIModel.SageMakerAIEndpointConfig":
        return self.endpoint_config

    # ── Message formatting (inlined from upstream OpenAI base) ──

    @staticmethod
    def _format_content_block(content: dict[str, Any]) -> dict[str, Any]:
        """Format a content block for OpenAI-compatible chat format."""
        if "text" in content:
            return {"type": "text", "text": content["text"]}
        if "image" in content:
            import base64

            img = content["image"]
            b64 = base64.b64encode(img["source"]["bytes"]).decode("utf-8")
            fmt = img.get("format", "jpeg")
            return {"type": "image_url", "image_url": {"detail": "auto", "url": f"data:image/{fmt};base64,{b64}"}}
        return {"type": "text", "text": str(content)}

    @staticmethod
    def _format_tool_call(tool_use: dict[str, Any]) -> dict[str, Any]:
        return {
            "function": {"arguments": json.dumps(tool_use["input"]), "name": tool_use["name"]},
            "id": tool_use["toolUseId"],
            "type": "function",
        }

    @staticmethod
    def _format_tool_message(tool_result: dict[str, Any]) -> dict[str, Any]:
        parts: list[str] = []
        for c in tool_result.get("content", []):
            if "json" in c:
                parts.append(json.dumps(c["json"]))
            elif "text" in c:
                parts.append(c["text"])
            else:
                parts.append(str(c))
        return {"role": "tool", "tool_call_id": tool_result["toolUseId"], "content": " ".join(parts)}

    @classmethod
    def format_request_messages(
        cls, messages: Messages, system_prompt: str | None = None,
    ) -> list[dict[str, Any]]:
        formatted: list[dict[str, Any]] = []
        if system_prompt:
            formatted.append({"role": "system", "content": system_prompt})

        for message in messages:
            contents = message.get("content", [])
            text_parts: list[dict[str, Any]] = []
            tool_calls: list[dict[str, Any]] = []
            tool_msgs: list[dict[str, Any]] = []

            for c in contents:
                if "toolUse" in c:
                    tool_calls.append(cls._format_tool_call(c["toolUse"]))
                elif "toolResult" in c:
                    tool_msgs.append(cls._format_tool_message(c["toolResult"]))
                elif "reasoningContent" not in c:
                    text_parts.append(cls._format_content_block(c))

            msg: dict[str, Any] = {"role": message["role"]}
            if text_parts:
                msg["content"] = text_parts
            if tool_calls:
                msg["tool_calls"] = tool_calls
            if text_parts or tool_calls:
                formatted.append(msg)
            formatted.extend(tool_msgs)

        return formatted

    # ── Chunk formatting (inlined from upstream OpenAI base) ──

    @staticmethod
    def format_chunk(event: dict[str, Any]) -> dict[str, Any]:
        match event["chunk_type"]:
            case "message_start":
                return {"messageStart": {"role": "assistant"}}
            case "content_start":
                if event.get("data_type") == "tool":
                    tc = event["data"]
                    return {"contentBlockStart": {"start": {"toolUse": {"name": tc.function.name, "toolUseId": tc.id}}}}
                return {"contentBlockStart": {"start": {}}}
            case "content_delta":
                if event.get("data_type") == "tool":
                    tc = event["data"]
                    return {"contentBlockDelta": {"delta": {"toolUse": {"input": tc.function.arguments or ""}}}}
                if event.get("data_type") == "reasoning_content":
                    return {"contentBlockDelta": {"delta": {"reasoningContent": {"text": event["data"]}}}}
                return {"contentBlockDelta": {"delta": {"text": event["data"]}}}
            case "content_stop":
                return {"contentBlockStop": {}}
            case "message_stop":
                match event["data"]:
                    case "tool_calls":
                        return {"messageStop": {"stopReason": "tool_use"}}
                    case "length":
                        return {"messageStop": {"stopReason": "max_tokens"}}
                    case _:
                        return {"messageStop": {"stopReason": "end_turn"}}
            case "metadata":
                usage = event["data"]
                return {
                    "metadata": {
                        "usage": {
                            "inputTokens": usage.prompt_tokens,
                            "outputTokens": usage.completion_tokens,
                            "totalTokens": usage.total_tokens,
                        },
                        "metrics": {"latencyMs": 0},
                    },
                }
            case _:
                raise RuntimeError(f"chunk_type=<{event['chunk_type']}> | unknown type")

    # ── Request formatting ──

    def format_request(
        self,
        messages: Messages,
        tool_specs: list[ToolSpec] | None = None,
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        formatted_messages = self.format_request_messages(messages, system_prompt)

        payload: dict[str, Any] = {
            "messages": formatted_messages,
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": ts["name"],
                        "description": ts["description"],
                        "parameters": ts.get("inputSchema", {}).get("json", ts.get("inputSchema", {})),
                    },
                }
                for ts in (tool_specs or [])
            ],
            **{k: v for k, v in self.payload_config.items() if k not in ["additional_args"]},
        }

        extra = self.payload_config.get("additional_args")
        if extra:
            payload.update(extra)

        if not payload["tools"]:
            payload.pop("tools")
            payload.pop("tool_choice", None)
        else:
            payload["tool_choice"] = "auto"

        # Assistant messages: if tool_calls present, drop content
        for msg in payload["messages"]:
            if msg.get("role") == "assistant" and msg.get("tool_calls"):
                msg.pop("content", None)

        request: dict[str, Any] = {
            "EndpointName": self.endpoint_config["endpoint_name"],
            "Body": json.dumps(payload),
            "ContentType": "application/json",
            "Accept": "application/json",
        }

        inf_comp = self.endpoint_config.get("inference_component_name")
        if inf_comp:
            request["InferenceComponentName"] = inf_comp
        target_model = self.endpoint_config.get("target_model")
        if target_model:
            request["TargetModel"] = target_model
        target_variant = self.endpoint_config.get("target_variant")
        if target_variant:
            request["TargetVariant"] = target_variant
        ep_extra = self.endpoint_config.get("additional_args")
        if ep_extra:
            request.update(ep_extra)

        return request

    # ── Streaming ──

    def stream(
        self,
        messages: Messages,
        tool_specs: list[ToolSpec] | None = None,
        system_prompt: str | None = None,
        **kwargs: Any,
    ) -> Any:
        """Stream conversation with the SageMaker model (synchronous generator)."""
        request = self.format_request(messages, tool_specs, system_prompt)

        if self.payload_config.get("stream", True):
            response = self.client.invoke_endpoint_with_response_stream(**request)
            yield self.format_chunk({"chunk_type": "message_start"})

            finish_reason = ""
            partial_content = ""
            tool_calls: dict[int, list[Any]] = {}
            text_started = False

            for event in response["Body"]:
                chunk = event["PayloadPart"]["Bytes"].decode("utf-8")
                partial_content += chunk[6:] if chunk.startswith("data: ") else chunk
                try:
                    content = json.loads(partial_content)
                    partial_content = ""
                    choice = content["choices"][0]

                    if choice["delta"].get("content"):
                        if not text_started:
                            yield self.format_chunk({"chunk_type": "content_start", "data_type": "text"})
                            text_started = True
                        yield self.format_chunk({"chunk_type": "content_delta", "data_type": "text", "data": choice["delta"]["content"]})

                    for tc in choice["delta"].get("tool_calls", []):
                        tool_calls.setdefault(tc["index"], []).append(tc)

                    if choice["finish_reason"] is not None:
                        finish_reason = choice["finish_reason"]
                        break
                except json.JSONDecodeError:
                    continue

            if text_started:
                yield self.format_chunk({"chunk_type": "content_stop", "data_type": "text"})

            for tool_deltas in tool_calls.values():
                if not tool_deltas[0]["function"].get("name"):
                    raise Exception("The model did not provide a tool name.")
                yield self.format_chunk({"chunk_type": "content_start", "data_type": "tool", "data": ToolCall(**tool_deltas[0])})
                for td in tool_deltas:
                    yield self.format_chunk({"chunk_type": "content_delta", "data_type": "tool", "data": ToolCall(**td)})
                yield self.format_chunk({"chunk_type": "content_stop", "data_type": "tool"})

            if not text_started and not tool_calls:
                yield self.format_chunk({"chunk_type": "content_start", "data_type": "text"})
                yield self.format_chunk({"chunk_type": "content_stop", "data_type": "text"})

            yield self.format_chunk({"chunk_type": "message_stop", "data": finish_reason})
        else:
            # Non-streaming path
            response = self.client.invoke_endpoint(**request)
            body = json.loads(response["Body"].read().decode("utf-8"))
            message = body["choices"][0]["message"]
            stop_reason = body["choices"][0]["finish_reason"]

            yield self.format_chunk({"chunk_type": "message_start"})

            if message.get("content", ""):
                yield self.format_chunk({"chunk_type": "content_start", "data_type": "text"})
                yield self.format_chunk({"chunk_type": "content_delta", "data_type": "text", "data": message["content"]})
                yield self.format_chunk({"chunk_type": "content_stop", "data_type": "text"})

            if message.get("tool_calls") or stop_reason == "tool_calls":
                tcs = message["tool_calls"]
                if not isinstance(tcs, list):
                    tcs = [tcs]
                for tc in tcs:
                    if not isinstance(tc["function"]["arguments"], str):
                        tc["function"]["arguments"] = json.dumps(tc["function"]["arguments"])
                    yield self.format_chunk({"chunk_type": "content_start", "data_type": "tool", "data": ToolCall(**tc)})
                    yield self.format_chunk({"chunk_type": "content_delta", "data_type": "tool", "data": ToolCall(**tc)})
                    yield self.format_chunk({"chunk_type": "content_stop", "data_type": "tool"})
                stop_reason = "tool_calls"

            yield self.format_chunk({"chunk_type": "message_stop", "data": stop_reason})

            if body.get("usage"):
                yield self.format_chunk({"chunk_type": "metadata", "data": UsageMetadata(**body["usage"])})