from typing import Any


class NullConversationManager:
    """Stub for null conversation manager."""


class SlidingWindowConversationManager:
    """Stub for sliding window conversation manager."""

    def __init__(self, **_kwargs: Any) -> None:
        pass


__all__ = ["NullConversationManager", "SlidingWindowConversationManager"]
