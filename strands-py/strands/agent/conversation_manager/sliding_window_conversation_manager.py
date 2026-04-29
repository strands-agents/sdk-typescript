"""Sliding window conversation manager config holder for the WASM bridge.

The actual sliding window logic runs inside the TS SDK (WASM guest).
This class is a config container used by the Python Agent to extract
settings and pass them through the WIT contract.
"""

from __future__ import annotations

from typing import Any

from strands.hooks import HookProvider


class SlidingWindowConversationManager(HookProvider):
    """Config holder for the sliding window conversation manager.

    Trims conversation history to a sliding window of recent messages,
    preserving tool-use / tool-result pairs so the message sequence stays valid.

    Args:
        window_size: Maximum number of messages to keep. Defaults to 40.
        should_truncate_results: Whether to truncate tool results on context overflow. Defaults to True.
    """

    def __init__(self, window_size: int = 40, should_truncate_results: bool = True, **_kwargs: Any) -> None:
        self.window_size = window_size
        self.should_truncate_results = should_truncate_results
