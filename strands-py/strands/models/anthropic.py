import json
from typing import Any

from strands.models.model import Model

_CONFIG_FIELDS = {"model_id", "api_key"}
_PARAM_FIELDS = {"max_tokens", "temperature", "top_p"}
_KNOWN_FIELDS = _CONFIG_FIELDS | _PARAM_FIELDS


class AnthropicModel(Model):
    """Config wrapper for Anthropic models.

    Known fields (model_id, api_key, max_tokens, temperature, top_p) are
    passed through the typed WIT contract. All other kwargs are forwarded
    as JSON via additional_config to the TS SDK's AnthropicModel constructor.
    """

    def __init__(
        self, model_id: str | None = None, api_key: str | None = None, **kwargs: Any,
    ) -> None:
        self._config: dict[str, Any] = {"provider": "anthropic"}
        if model_id:
            self._config["model_id"] = model_id
        if api_key:
            self._config["api_key"] = api_key

        extra: dict[str, Any] = {}
        for k, v in kwargs.items():
            if v is None:
                continue
            if k in _KNOWN_FIELDS:
                self._config[k] = v
            else:
                extra[k] = v

        if extra:
            self._config["additional_config"] = json.dumps(extra)

    def _to_config_dict(self) -> dict[str, Any]:
        return self._config
