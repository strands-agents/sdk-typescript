from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from strands.interrupt import Interrupt


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
        self._interrupts: list[Interrupt] = []

    def interrupt(self, name: str, reason: str = "") -> str:
        """Pause execution with an interrupt. Returns the response when resumed."""
        from strands.interrupt import Interrupt as _Interrupt

        intr = _Interrupt(name=name, reason=reason)
        self._interrupts.append(intr)
        return ""


# Type aliases matching the existing SDK.
ToolChoice = dict[str, Any]
ToolResult = dict[str, Any]
ToolSpec = dict[str, Any]
ToolUse = dict[str, Any]
