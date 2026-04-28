"""Summarizing conversation manager config holder for the WASM bridge.

The actual summarization logic runs inside the TS SDK (WASM guest).
This class is a config container used by the Python Agent to extract
settings and pass them through the WIT contract.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from strands.hooks import HookProvider


class SummarizingConversationManager(HookProvider):
    """Config holder for the summarizing conversation manager.

    When a context window overflow occurs, this manager summarizes the oldest
    messages using a model call and replaces them with a single summary,
    preserving context that would otherwise be lost.

    Args:
        summary_ratio: Ratio of messages to summarize (0.1-0.8). Defaults to 0.3.
        preserve_recent_messages: Minimum recent messages to keep. Defaults to 10.
        summarization_system_prompt: Custom system prompt for summarization.
        summarization_model_config: Model config dict for a separate summarization model.
            Should match the model config format: {"provider": "bedrock", "model_id": "...", ...}
            When None, the agent's primary model is used.
    """

    def __init__(
        self,
        summary_ratio: float = 0.3,
        preserve_recent_messages: int = 10,
        summarization_system_prompt: Optional[str] = None,
        summarization_model_config: Optional[dict[str, Any]] = None,
    ) -> None:
        self.summary_ratio = max(0.1, min(0.8, summary_ratio))
        self.preserve_recent_messages = preserve_recent_messages
        self.summarization_system_prompt = summarization_system_prompt
        self.summarization_model_config = summarization_model_config

    def serialize_model_config(self) -> str | None:
        """Serialize the model config dict into the WIT-compatible JSON format.

        Converts from the Python-friendly format:
            {"provider": "bedrock", "model_id": "us.anthropic.claude-sonnet-4-20250514"}
        to the WIT ModelConfig variant format:
            {"tag": "bedrock", "val": {"modelId": "us.anthropic.claude-sonnet-4-20250514"}}

        The output uses camelCase field names (modelId, apiKey, etc.) to match
        what ``createModel()`` in ``strands-wasm/entry.ts`` expects when parsing
        the JSON string from the WIT ``summarization-model-config`` field.

        Returns:
            JSON string for the WIT contract, or None if no model config is set.
        """
        if self.summarization_model_config is None:
            return None
        config = self.summarization_model_config
        provider = config.get("provider", "bedrock")
        if provider == "bedrock":
            val: dict[str, Any] = {
                "modelId": config.get("model_id", ""),
                "region": config.get("region"),
                "accessKeyId": config.get("access_key_id"),
                "secretAccessKey": config.get("secret_access_key"),
                "sessionToken": config.get("session_token"),
                "additionalConfig": config.get("additional_config"),
            }
        elif provider in ("anthropic", "openai", "gemini"):
            val = {
                "modelId": config.get("model_id"),
                "apiKey": config.get("api_key"),
                "additionalConfig": config.get("additional_config"),
            }
        else:
            raise ValueError(f"Unknown model provider: {provider}")

        return json.dumps({"tag": provider, "val": val})
