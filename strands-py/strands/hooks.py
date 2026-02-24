from __future__ import annotations

import inspect
from collections.abc import Callable
from typing import Any, cast


class HookRegistry:
    """Registry for event callbacks on an Agent."""

    def __init__(self) -> None:
        self._callbacks: dict[type, list[Callable[..., Any]]] = {}

    def add_callback(self, event_type: type, callback: Callable[..., Any]) -> None:
        self._callbacks.setdefault(event_type, []).append(callback)

    def _get_callbacks(self, event: object) -> list[Callable[..., Any]]:
        callbacks = list(self._callbacks.get(cast(type, type(event)), []))
        if getattr(event, "should_reverse_callbacks", False):
            callbacks.reverse()
        return callbacks

    def fire(self, event: object) -> None:
        for cb in self._get_callbacks(event):
            cb(event)

    async def fire_async(self, event: object) -> None:
        for cb in self._get_callbacks(event):
            if inspect.iscoroutinefunction(cb):
                await cb(event)
            else:
                cb(event)


class AfterToolCallEvent:
    """Fired after a tool call completes. Set retry=True to re-invoke."""

    should_reverse_callbacks = True

    def __init__(self) -> None:
        self.tool_use: dict[str, Any] = {}
        self.result: dict[str, Any] = {}
        self.retry: bool = False


class AfterModelCallEvent:
    should_reverse_callbacks = True


class BeforeModelCallEvent:
    pass


class BeforeInvocationEvent:
    pass


class AfterInvocationEvent:
    should_reverse_callbacks = True


class BeforeToolCallEvent:
    pass


class AgentInitializedEvent:
    pass


class MessageAddedEvent:
    pass


class HookProvider:
    """Base class for hook providers."""

    def register_hooks(self, registry: HookRegistry) -> None:
        pass
