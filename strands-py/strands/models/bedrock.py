import json
from typing import Any

from strands.models.model import Model

_CONFIG_FIELDS = {"model_id", "region", "access_key_id", "secret_access_key", "session_token"}
_PARAM_FIELDS = {"max_tokens", "temperature", "top_p"}
_KNOWN_FIELDS = _CONFIG_FIELDS | _PARAM_FIELDS

# Fields that are not JSON-serializable and must be handled specially.
_NON_SERIALIZABLE = {"boto_session"}


class BedrockModel(Model):
    """Config wrapper for Bedrock models.

    Known fields (model_id, region, max_tokens, temperature, top_p) are
    passed through the typed WIT contract. All other kwargs are forwarded
    as JSON via additional_config to the TS SDK's BedrockModel constructor.
    """

    def __init__(
        self, model_id: str = "us.anthropic.claude-sonnet-4-20250514-v1:0", **kwargs: Any,
    ) -> None:
        if "region_name" in kwargs:
            kwargs["region"] = kwargs.pop("region_name")

        boto_session = kwargs.pop("boto_session", None)
        if boto_session is not None:
            if "region" not in kwargs:
                region = getattr(boto_session, "region_name", None)
                if region:
                    kwargs["region"] = region
            get_creds = getattr(boto_session, "get_credentials", None)
            raw_creds = get_creds() if get_creds else None
            if raw_creds is not None:
                freeze = getattr(raw_creds, "get_frozen_credentials", None)
                frozen = freeze() if freeze else raw_creds
                ak = getattr(frozen, "access_key", None)
                sk = getattr(frozen, "secret_key", None)
                tk = getattr(frozen, "token", None)
                if "access_key_id" not in kwargs and ak:
                    kwargs["access_key_id"] = ak
                if "secret_access_key" not in kwargs and sk:
                    kwargs["secret_access_key"] = sk
                if "session_token" not in kwargs and tk:
                    kwargs["session_token"] = tk

        self._config: dict[str, Any] = {"provider": "bedrock", "model_id": model_id}
        extra: dict[str, Any] = {}

        for k, v in kwargs.items():
            if v is None or k in _NON_SERIALIZABLE:
                continue
            if k in _KNOWN_FIELDS:
                self._config[k] = v
            else:
                extra[k] = v

        if extra:
            self._config["additional_config"] = json.dumps(extra)

    def _to_config_dict(self) -> dict[str, Any]:
        return self._config
