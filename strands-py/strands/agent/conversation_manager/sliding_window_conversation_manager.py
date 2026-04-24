from __future__ import annotations

from typing import Any

from strands.hooks import AfterInvocationEvent, HookProvider, HookRegistry


class SlidingWindowConversationManager(HookProvider):
    """Trims conversation history to a sliding window of recent messages.

    Preserves tool-use / tool-result pairs so the message sequence stays valid.
    """

    def __init__(self, window_size: int = 40, should_truncate_results: bool = True, **_kwargs: Any) -> None:
        self.window_size = window_size
        self.should_truncate_results = should_truncate_results

    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(AfterInvocationEvent, self._trim)

    def _trim(self, _event: AfterInvocationEvent) -> None:
        agent = getattr(_event, "agent", None)
        if agent is None:
            return

        messages = agent.messages
        if len(messages) <= self.window_size:
            return

        target = len(messages) - self.window_size
        trim_idx = self._find_safe_trim_point(messages, target)
        if trim_idx > 0:
            agent.messages = messages[trim_idx:]

    @staticmethod
    def _find_safe_trim_point(messages: list[dict[str, Any]], target: int) -> int:
        """Find the earliest index >= *target* where trimming keeps pairs intact."""
        for i in range(target, len(messages)):
            msg = messages[i]
            content = msg.get("content", [])
            # Don't start on a tool result — its matching tool-use would be gone.
            has_tool_result = any(
                (isinstance(b, dict) and ("toolResult" in b or b.get("type") == "toolResultBlock"))
                for b in content
            )
            if has_tool_result:
                continue
            return i
        return target
