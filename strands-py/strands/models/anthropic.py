import json
from dataclasses import fields as dc_fields
from typing import Any

from strands.generated.wit_world.imports.types import AnthropicConfig, ModelParams

_CONFIG_FIELDS = {f.name for f in dc_fields(AnthropicConfig)}
_PARAM_FIELDS = {f.name for f in dc_fields(ModelParams)}
_KNOWN_FIELDS = _CONFIG_FIELDS | _PARAM_FIELDS


class AnthropicModel:
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
