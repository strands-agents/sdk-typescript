# Multi-Agents - Graph

DAG-based orchestration where agents run as nodes in a directed graph. Supports linear chains, fan-out/fan-in parallelism, conditional edges, and nested multi-agent patterns.

Docs:
- [Multi-Agent Patterns](https://strandsagents.com/docs/user-guide/concepts/multi-agent/multi-agent-patterns/)
- [Graph](https://strandsagents.com/docs/user-guide/concepts/multi-agent/graph/)
- [Agents as Tools](https://strandsagents.com/docs/user-guide/concepts/multi-agent/agents-as-tools/)

Templates: [multi-agents-graph.ts](../templates/multi-agents-graph.ts)

---

## Graph topologies

- Linear graph: A -> B -> C, verify nodes execute in order
- Fan-out: A -> [B, C] (parallel), verify both run concurrently
- Fan-in: [B, C] -> D, verify D runs after both complete
- Diamond: A -> [B, C] -> D
- Single-node graph (edge case)
- Graph with no edges (disconnected nodes)

Watch for: Does parallel execution actually run nodes concurrently (not sequentially)?

## Nodes and edges

- `AgentNode`: wrap an Agent as a node
- `MultiAgentNode`: nest a Graph or Swarm inside a node
- Edge handlers: add a conditional edge that routes based on the previous node's output

Watch for: Are edge handlers called with the correct context (previous node's output)?

## State and streaming

- `MultiAgentState`:
  - `state.app` for shared application state across nodes
  - `state.results` for inspecting node results
  - `state.status` for checking node status
- Streaming events: listen for `BeforeNodeCallEvent` and `AfterNodeCallEvent`
- Step limits: set a low `maxSteps`, verify execution stops

Watch for: Does `state.app` persist across nodes (set in A, read in B)? Do streaming events fire in the right order? Is the step limit enforced correctly?

## Error handling

- Make a node's agent throw, verify the error surfaces correctly

Watch for: When a node fails, does the error identify which node failed?
