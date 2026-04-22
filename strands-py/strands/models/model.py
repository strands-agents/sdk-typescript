from __future__ import annotations

from typing import Any


class Model:
    """Base class for model providers."""

    def _to_config_dict(self) -> dict[str, Any]:
        raise NotImplementedError
