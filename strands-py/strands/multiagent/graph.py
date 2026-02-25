"""Directed Graph Multi-Agent Pattern Implementation.

Provides GraphBuilder for constructing agent graphs and Graph for executing them.
"""

from __future__ import annotations

import asyncio
import copy
import logging
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any

from strands.hooks import BeforeNodeCallEvent, HookProvider, HookRegistry
from strands.interrupt import Interrupt
from strands.multiagent.base import MultiAgentBase, MultiAgentResult, NodeResult, Status

logger = logging.getLogger(__name__)

_DEFAULT_GRAPH_ID = "default_graph"


@dataclass
class GraphState:
    """State accessible by edge conditions during graph execution."""

    results: dict[str, NodeResult] = field(default_factory=dict)
    execution_order: list[GraphNode] = field(default_factory=list)
    execution_count: int = 0

    def get(self) -> dict[str, Any]:
        return {"results": self.results, "execution_count": self.execution_count}


@dataclass
class GraphResult(MultiAgentResult):
    """Result from graph execution — extends MultiAgentResult with graph-specific details."""

    total_nodes: int = 0
    completed_nodes: int = 0
    failed_nodes: int = 0
    interrupted_nodes: int = 0
    execution_order: list[GraphNode] = field(default_factory=list)
    edges: list[tuple[GraphNode, GraphNode]] = field(default_factory=list)
    entry_points: list[GraphNode] = field(default_factory=list)


@dataclass
class GraphEdge:
    """Represents an edge in the graph with an optional condition."""

    from_node: GraphNode
    to_node: GraphNode
    condition: Callable[[GraphState], bool] | None = None

    def __hash__(self) -> int:
        return hash((self.from_node.node_id, self.to_node.node_id))

    def should_traverse(self, state: GraphState) -> bool:
        if self.condition is None:
            return True
        return self.condition(state)


@dataclass
class GraphNode:
    """Represents a node in the graph."""

    node_id: str
    executor: Any = None
    dependencies: set[GraphNode] = field(default_factory=set)
    execution_status: Status = Status.PENDING
    result: NodeResult | None = None

    def __hash__(self) -> int:
        return hash(self.node_id)

    def __eq__(self, other: Any) -> bool:
        if not isinstance(other, GraphNode):
            return False
        return self.node_id == other.node_id

    def reset_executor_state(self) -> None:
        if hasattr(self.executor, "messages"):
            self.executor.messages = copy.deepcopy(getattr(self, "_initial_messages", []))
        self.execution_status = Status.PENDING
        self.result = None


class GraphBuilder:
    """Builder pattern for constructing graphs."""

    def __init__(self) -> None:
        self.nodes: dict[str, GraphNode] = {}
        self.edges: set[GraphEdge] = set()
        self.entry_points: set[GraphNode] = set()

        self._max_node_executions: int | None = None
        self._execution_timeout: float | None = None
        self._node_timeout: float | None = None
        self._reset_on_revisit: bool = False
        self._id: str = _DEFAULT_GRAPH_ID
        self._session_manager: Any = None
        self._hooks: list[HookProvider] | None = None

    def add_node(self, executor: Any, node_id: str | None = None) -> GraphNode:
        """Add an Agent or MultiAgentBase instance as a node."""
        if node_id is None:
            node_id = getattr(executor, "id", None) or getattr(executor, "name", None) or f"node_{len(self.nodes)}"

        if node_id in self.nodes:
            raise ValueError(f"Node '{node_id}' already exists")

        node = GraphNode(node_id=node_id, executor=executor)
        self.nodes[node_id] = node
        return node

    def add_edge(
        self,
        from_node: str | GraphNode,
        to_node: str | GraphNode,
        condition: Callable[[GraphState], bool] | None = None,
    ) -> GraphEdge:
        """Add an edge between two nodes with optional condition."""

        def resolve(node: str | GraphNode, label: str) -> GraphNode:
            if isinstance(node, str):
                if node not in self.nodes:
                    raise ValueError(f"{label} node '{node}' not found")
                return self.nodes[node]
            return node

        src = resolve(from_node, "Source")
        dst = resolve(to_node, "Target")
        edge = GraphEdge(from_node=src, to_node=dst, condition=condition)
        self.edges.add(edge)
        dst.dependencies.add(src)
        return edge

    def set_entry_point(self, node_id: str) -> GraphBuilder:
        if node_id not in self.nodes:
            raise ValueError(f"Node '{node_id}' not found")
        self.entry_points.add(self.nodes[node_id])
        return self

    def reset_on_revisit(self, enabled: bool = True) -> GraphBuilder:
        self._reset_on_revisit = enabled
        return self

    def set_max_node_executions(self, max_executions: int) -> GraphBuilder:
        self._max_node_executions = max_executions
        return self

    def set_execution_timeout(self, timeout: float) -> GraphBuilder:
        self._execution_timeout = timeout
        return self

    def set_node_timeout(self, timeout: float) -> GraphBuilder:
        self._node_timeout = timeout
        return self

    def set_graph_id(self, graph_id: str) -> GraphBuilder:
        self._id = graph_id
        return self

    def set_session_manager(self, session_manager: Any) -> GraphBuilder:
        self._session_manager = session_manager
        return self

    def set_hook_providers(self, hooks: list[HookProvider]) -> GraphBuilder:
        self._hooks = hooks
        return self

    def build(self) -> Graph:
        if not self.nodes:
            raise ValueError("Graph must contain at least one node")

        if not self.entry_points:
            self.entry_points = {node for node in self.nodes.values() if not node.dependencies}
            if not self.entry_points:
                raise ValueError("No entry points found — all nodes have dependencies")

        return Graph(
            nodes=self.nodes.copy(),
            edges=self.edges.copy(),
            entry_points=self.entry_points.copy(),
            max_node_executions=self._max_node_executions,
            execution_timeout=self._execution_timeout,
            node_timeout=self._node_timeout,
            reset_on_revisit=self._reset_on_revisit,
            session_manager=self._session_manager,
            hooks=self._hooks,
            id=self._id,
        )


class Graph(MultiAgentBase):
    """Directed Graph multi-agent orchestration."""

    def __init__(
        self,
        nodes: dict[str, GraphNode],
        edges: set[GraphEdge],
        entry_points: set[GraphNode],
        max_node_executions: int | None = None,
        execution_timeout: float | None = None,
        node_timeout: float | None = None,
        reset_on_revisit: bool = False,
        session_manager: Any = None,
        hooks: list[HookProvider] | None = None,
        id: str = _DEFAULT_GRAPH_ID,
        **_kwargs: Any,
    ) -> None:
        self.id = id
        self._nodes = nodes
        self._edges = edges
        self._entry_points = entry_points
        self._max_node_executions = max_node_executions
        self._execution_timeout = execution_timeout
        self._node_timeout = node_timeout
        self._reset_on_revisit = reset_on_revisit
        self._session_manager = session_manager
        self._hook_registry = HookRegistry()
        self.state = GraphState()

        if hooks:
            for provider in hooks:
                provider.register_hooks(self._hook_registry)

    async def invoke_async(
        self, task: Any, invocation_state: dict[str, Any] | None = None, **kwargs: Any,
    ) -> GraphResult:
        invocation_state = invocation_state or {}
        start = time.monotonic()

        result = GraphResult(
            status=Status.EXECUTING,
            total_nodes=len(self._nodes),
        )
        self.state = GraphState()

        queue: list[GraphNode] = list(self._entry_points)
        visited: set[str] = set()
        execution_count = 0
        task_input = task

        while queue:
            if self._max_node_executions and execution_count >= self._max_node_executions:
                break
            if self._execution_timeout and (time.monotonic() - start) > self._execution_timeout:
                break

            node = queue.pop(0)
            nid = node.node_id

            if self._reset_on_revisit and nid in visited:
                node.reset_executor_state()

            visited.add(nid)

            # Fire BeforeNodeCallEvent
            event = BeforeNodeCallEvent(node_id=nid)
            self._hook_registry.fire(event)
            if event.cancel_node:
                node_result = NodeResult(
                    result=Exception(str(event.cancel_node)),
                    status=Status.FAILED,
                )
                result.results[nid] = node_result
                result.failed_nodes += 1
                self.state.results[nid] = node_result
                result.execution_order.append(node)
                self.state.execution_order.append(node)
                execution_count += 1
                continue

            # Determine input for this node
            node_input = task_input
            deps_with_results = [
                d.node_id for d in node.dependencies
                if d.node_id in result.results and result.results[d.node_id].status == Status.COMPLETED
            ]
            if deps_with_results:
                prev = result.results[deps_with_results[-1]]
                if hasattr(prev.result, "text"):
                    node_input = prev.result.text

            # Execute node
            t0 = time.monotonic()
            try:
                executor = node.executor
                if isinstance(executor, MultiAgentBase):
                    exec_result = await executor.invoke_async(node_input, invocation_state)
                    node_result = NodeResult(
                        result=exec_result,
                        status=Status.COMPLETED,
                        execution_time=int((time.monotonic() - t0) * 1000),
                        execution_count=1,
                        accumulated_usage=exec_result.accumulated_usage,
                        accumulated_metrics=exec_result.accumulated_metrics,
                    )
                elif hasattr(executor, "invoke_async"):
                    agent_result = await executor.invoke_async(str(node_input))
                    node_result = NodeResult(
                        result=agent_result,
                        status=Status.COMPLETED,
                        execution_time=int((time.monotonic() - t0) * 1000),
                        execution_count=1,
                    )
                    if hasattr(agent_result, "usage") and agent_result.usage:
                        u = agent_result.usage
                        node_result.accumulated_usage = {
                            "inputTokens": getattr(u, "input_tokens", 0),
                            "outputTokens": getattr(u, "output_tokens", 0),
                            "totalTokens": getattr(u, "total_tokens", 0),
                        }
                else:
                    agent_result = executor(str(node_input))
                    node_result = NodeResult(
                        result=agent_result,
                        status=Status.COMPLETED,
                        execution_time=int((time.monotonic() - t0) * 1000),
                        execution_count=1,
                    )
            except Exception as exc:
                node_result = NodeResult(
                    result=exc,
                    status=Status.FAILED,
                    execution_time=int((time.monotonic() - t0) * 1000),
                )

            result.results[nid] = node_result
            self.state.results[nid] = node_result
            result.execution_order.append(node)
            self.state.execution_order.append(node)
            execution_count += 1
            self.state.execution_count = execution_count

            if node_result.status == Status.COMPLETED:
                result.completed_nodes += 1
            else:
                result.failed_nodes += 1

            # Accumulate usage/metrics
            for k in ("inputTokens", "outputTokens", "totalTokens"):
                result.accumulated_usage[k] = result.accumulated_usage.get(k, 0) + node_result.accumulated_usage.get(k, 0)
            result.accumulated_metrics["latencyMs"] = result.accumulated_metrics.get("latencyMs", 0) + node_result.accumulated_metrics.get("latencyMs", 0)

            # Find next nodes via edges
            for edge in self._edges:
                if edge.from_node.node_id == nid:
                    if edge.should_traverse(self.state):
                        if edge.to_node not in queue:
                            queue.append(edge.to_node)

        result.execution_count = execution_count
        result.execution_time = int((time.monotonic() - start) * 1000)

        if result.failed_nodes > 0:
            result.status = Status.FAILED
        else:
            result.status = Status.COMPLETED

        return result

    async def stream_async(
        self, task: Any, invocation_state: dict[str, Any] | None = None, **kwargs: Any,
    ) -> AsyncIterator[dict[str, Any]]:
        invocation_state = invocation_state or {}
        start = time.monotonic()

        queue: list[GraphNode] = list(self._entry_points)
        visited: set[str] = set()
        results: dict[str, NodeResult] = {}
        execution_order: list[GraphNode] = []
        execution_count = 0
        task_input = task

        while queue:
            if self._max_node_executions and execution_count >= self._max_node_executions:
                break

            node = queue.pop(0)
            nid = node.node_id

            if self._reset_on_revisit and nid in visited:
                node.reset_executor_state()

            visited.add(nid)
            yield {"type": "multiagent_node_start", "node_id": nid}

            # Determine input
            node_input = task_input
            deps_with_results = [
                d.node_id for d in node.dependencies
                if d.node_id in results and results[d.node_id].status == Status.COMPLETED
            ]
            if deps_with_results:
                prev = results[deps_with_results[-1]]
                if hasattr(prev.result, "text"):
                    node_input = prev.result.text

            # Execute
            t0 = time.monotonic()
            try:
                executor = node.executor
                if hasattr(executor, "stream_async") and not isinstance(executor, MultiAgentBase):
                    async for event in executor.stream_async(str(node_input)):
                        yield {"type": "multiagent_node_stream", "node_id": nid, "event": event}
                    # After streaming, get the result from messages
                    agent_result = None
                    if hasattr(executor, "invoke_async"):
                        # For stream, we don't have a direct result, so we create a minimal one
                        node_result = NodeResult(
                            result=agent_result,
                            status=Status.COMPLETED,
                            execution_time=int((time.monotonic() - t0) * 1000),
                            execution_count=1,
                        )
                    else:
                        node_result = NodeResult(status=Status.COMPLETED, execution_count=1)
                elif isinstance(executor, MultiAgentBase):
                    exec_result = await executor.invoke_async(node_input, invocation_state)
                    node_result = NodeResult(result=exec_result, status=Status.COMPLETED, execution_count=1)
                elif hasattr(executor, "invoke_async"):
                    agent_result = await executor.invoke_async(str(node_input))
                    node_result = NodeResult(
                        result=agent_result,
                        status=Status.COMPLETED,
                        execution_time=int((time.monotonic() - t0) * 1000),
                        execution_count=1,
                    )
                else:
                    agent_result = executor(str(node_input))
                    node_result = NodeResult(
                        result=agent_result,
                        status=Status.COMPLETED,
                        execution_time=int((time.monotonic() - t0) * 1000),
                        execution_count=1,
                    )
            except Exception as exc:
                node_result = NodeResult(result=exc, status=Status.FAILED)

            results[nid] = node_result
            execution_order.append(node)
            execution_count += 1

            yield {"type": "multiagent_node_stop", "node_id": nid}

            # Follow edges
            next_nodes: list[str] = []
            for edge in self._edges:
                if edge.from_node.node_id == nid:
                    gs = GraphState(results=results, execution_order=execution_order, execution_count=execution_count)
                    if edge.should_traverse(gs):
                        if edge.to_node not in queue:
                            queue.append(edge.to_node)
                            next_nodes.append(edge.to_node.node_id)

            if next_nodes:
                yield {"type": "multiagent_handoff", "from_node_ids": [nid], "to_node_ids": next_nodes}

        # Final result
        completed = sum(1 for r in results.values() if r.status == Status.COMPLETED)
        failed = sum(1 for r in results.values() if r.status == Status.FAILED)
        overall_status = Status.FAILED if failed > 0 else Status.COMPLETED

        final_result = GraphResult(
            status=overall_status,
            results=results,
            total_nodes=len(self._nodes),
            completed_nodes=completed,
            failed_nodes=failed,
            execution_order=execution_order,
            execution_count=execution_count,
            execution_time=int((time.monotonic() - start) * 1000),
        )
        yield {"type": "multiagent_result", "result": final_result}

    def serialize_state(self) -> dict[str, Any]:
        return {"id": self.id, "state": self.state.get()}

    def deserialize_state(self, payload: dict[str, Any]) -> None:
        pass
