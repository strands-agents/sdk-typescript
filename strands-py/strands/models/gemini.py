import json
from typing import Any

from strands.models.model import Model


class GeminiModel(Model):
    """Config wrapper for Gemini models."""

    _KNOWN_FIELDS = {"model_id", "api_key", "max_tokens", "temperature", "top_p"}

    def __init__(
        self,
        model_id: str | None = None,
        api_key: str | None = None,
        **kwargs: Any,
    ) -> None:
        self._config: dict[str, Any] = {"provider": "gemini"}
        if model_id:
            self._config["model_id"] = model_id
        if api_key:
            self._config["api_key"] = api_key

        extra: dict[str, Any] = {}
        for k, v in kwargs.items():
            if v is None:
                continue
            if k in self._KNOWN_FIELDS:
                self._config[k] = v
            else:
                extra[k] = v

        if extra:
            self._config["additional_config"] = json.dumps(extra)

    def _to_config_dict(self) -> dict[str, Any]:
        return self._config
