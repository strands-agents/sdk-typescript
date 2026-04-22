"""Swarm Multi-Agent Pattern Implementation.

Collaborative agent orchestration where agents work together as a team.
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from strands.hooks import BeforeNodeCallEvent, HookProvider, HookRegistry
from strands.multiagent.base import MultiAgentBase, MultiAgentResult, NodeResult, Status

logger = logging.getLogger(__name__)

_DEFAULT_SWARM_ID = "default_swarm"


@dataclass
class SwarmResult(MultiAgentResult):
    """Result from swarm execution."""

    node_history: list[Any] = field(default_factory=list)


class Swarm(MultiAgentBase):
    """Swarm multi-agent orchestration — agents collaborate on a shared task."""

    def __init__(
        self,
        agents: list[Any],
        hooks: list[HookProvider] | None = None,
        session_manager: Any = None,
        id: str = _DEFAULT_SWARM_ID,
        **_kwargs: Any,
    ) -> None:
        self.id = id
        self._agents = agents
        self._session_manager = session_manager
        self._hook_registry = HookRegistry()

        if hooks:
            for provider in hooks:
                provider.register_hooks(self._hook_registry)

    async def invoke_async(
        self, task: Any, invocation_state: dict[str, Any] | None = None, **kwargs: Any,
    ) -> SwarmResult:
        invocation_state = invocation_state or {}
        start = time.monotonic()

        result = SwarmResult(status=Status.EXECUTING)
        current_input = task

        for agent in self._agents:
            nid = getattr(agent, "name", None) or getattr(agent, "agent_id", None) or str(id(agent))

            event = BeforeNodeCallEvent(node_id=nid)
            self._hook_registry.fire(event)
            if event.cancel_node:
                node_result = NodeResult(result=Exception(str(event.cancel_node)), status=Status.FAILED)
                result.results[nid] = node_result
                continue

            t0 = time.monotonic()
            try:
                if hasattr(agent, "invoke_async"):
                    agent_result = await agent.invoke_async(str(current_input))
                else:
                    agent_result = agent(str(current_input))

                node_result = NodeResult(
                    result=agent_result,
                    status=Status.COMPLETED,
                    execution_time=int((time.monotonic() - t0) * 1000),
                    execution_count=1,
                )
                if hasattr(agent_result, "text"):
                    current_input = agent_result.text
            except Exception as exc:
                node_result = NodeResult(result=exc, status=Status.FAILED)

            result.results[nid] = node_result
            result.node_history.append(type("_Node", (), {"node_id": nid})())

        failed = sum(1 for r in result.results.values() if r.status == Status.FAILED)

        result.status = Status.FAILED if failed > 0 else Status.COMPLETED
        result.execution_count = len(result.results)
        result.execution_time = int((time.monotonic() - start) * 1000)
        return result

    async def stream_async(
        self, task: Any, invocation_state: dict[str, Any] | None = None, **kwargs: Any,
    ) -> AsyncIterator[dict[str, Any]]:
        result = await self.invoke_async(task, invocation_state, **kwargs)
        yield {"result": result}
