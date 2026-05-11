from __future__ import annotations

from typing import Any


class ModelRetryStrategy:
    """Configurable retry strategy for model invocations.

    Controls how many times the agent retries on transient model errors
    (rate limiting, context overflow, etc.).
    """

    def __init__(
        self,
        *,
        max_attempts: int = 3,
        backoff_factor: float = 1.0,
        **_kwargs: Any,
    ) -> None:
        self.max_attempts = max_attempts
        self.backoff_factor = backoff_factor
