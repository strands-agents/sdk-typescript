from __future__ import annotations

from typing import Any


class ToolContext:
    """Placeholder -- ToolContext is not yet bridged across the WASM boundary."""

    def __init__(
        self,
        tool_use: dict[str, Any] | None = None,
        agent: Any = None,
        invocation_state: dict[str, Any] | None = None,
    ) -> None:
        self.tool_use: dict[str, Any] = tool_use or {}
        self.agent = agent
        self.invocation_state: dict[str, Any] = invocation_state or {}


# Type aliases matching the existing SDK.
ToolResult = dict[str, Any]
ToolSpec = dict[str, Any]
