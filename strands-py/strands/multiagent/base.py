"""Multi-Agent Base Class.

Provides minimal foundation for multi-agent patterns (Swarm, Graph).
"""

from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Union

from strands.interrupt import Interrupt

logger = logging.getLogger(__name__)


class Status(Enum):
    """Execution status for both graphs and nodes."""

    PENDING = "pending"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"
    INTERRUPTED = "interrupted"


@dataclass
class NodeResult:
    """Unified result from node execution."""

    result: Any = None
    execution_time: int = 0
    status: Status = Status.PENDING
    accumulated_usage: dict[str, Any] = field(
        default_factory=lambda: {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}
    )
    accumulated_metrics: dict[str, Any] = field(default_factory=lambda: {"latencyMs": 0})
    execution_count: int = 0
    interrupts: list[Interrupt] = field(default_factory=list)

    def get_agent_results(self) -> list[Any]:
        if isinstance(self.result, Exception):
            return []
        from strands.agent import AgentResult

        if isinstance(self.result, AgentResult):
            return [self.result]
        if isinstance(self.result, MultiAgentResult):
            flattened: list[Any] = []
            for nested in self.result.results.values():
                flattened.extend(nested.get_agent_results())
            return flattened
        return []

    def to_dict(self) -> dict[str, Any]:
        if isinstance(self.result, Exception):
            result_data: dict[str, Any] = {"type": "exception", "message": str(self.result)}
        else:
            result_data = {"type": "node_result"}
        return {
            "result": result_data,
            "execution_time": self.execution_time,
            "status": self.status.value,
            "accumulated_usage": self.accumulated_usage,
            "accumulated_metrics": self.accumulated_metrics,
            "execution_count": self.execution_count,
            "interrupts": [i.to_dict() for i in self.interrupts],
        }


@dataclass
class MultiAgentResult:
    """Result from multi-agent execution with accumulated metrics."""

    status: Status = Status.PENDING
    results: dict[str, NodeResult] = field(default_factory=dict)
    accumulated_usage: dict[str, Any] = field(
        default_factory=lambda: {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}
    )
    accumulated_metrics: dict[str, Any] = field(default_factory=lambda: {"latencyMs": 0})
    execution_count: int = 0
    execution_time: int = 0
    interrupts: list[Interrupt] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "multiagent_result",
            "status": self.status.value,
            "results": {k: v.to_dict() for k, v in self.results.items()},
            "accumulated_usage": self.accumulated_usage,
            "accumulated_metrics": self.accumulated_metrics,
            "execution_count": self.execution_count,
            "execution_time": self.execution_time,
            "interrupts": [i.to_dict() for i in self.interrupts],
        }


class MultiAgentBase(ABC):
    """Base class for multi-agent helpers."""

    id: str

    @abstractmethod
    async def invoke_async(
        self, task: Any, invocation_state: dict[str, Any] | None = None, **kwargs: Any,
    ) -> MultiAgentResult:
        raise NotImplementedError

    async def stream_async(
        self, task: Any, invocation_state: dict[str, Any] | None = None, **kwargs: Any,
    ) -> AsyncIterator[dict[str, Any]]:
        result = await self.invoke_async(task, invocation_state, **kwargs)
        yield {"result": result}

    def __call__(self, task: Any, invocation_state: dict[str, Any] | None = None, **kwargs: Any) -> MultiAgentResult:
        return asyncio.run(self.invoke_async(task, invocation_state, **kwargs))

    def serialize_state(self) -> dict[str, Any]:
        raise NotImplementedError

    def deserialize_state(self, payload: dict[str, Any]) -> None:
        raise NotImplementedError
