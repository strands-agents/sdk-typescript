# Multi-Agents - Swarm

Handoff-based orchestration where agents dynamically route to each other based on the conversation. The model decides which agent to hand off to based on agent descriptions.

Docs:
- [Multi-Agent Patterns](https://strandsagents.com/docs/user-guide/concepts/multi-agent/multi-agent-patterns/)
- [Swarm](https://strandsagents.com/docs/user-guide/concepts/multi-agent/swarm/)

Templates: [multi-agents-swarm.ts](../templates/multi-agents-swarm.ts)

---

## Handoffs

- Basic handoff: agent A hands off to agent B, verify B receives context
- Multi-hop: A -> B -> C, verify the chain completes
- Automatic agent selection: the model picks which agent to hand off to based on descriptions
- Handoff with context: verify the handoff message includes relevant context from the previous agent

Watch for: Does the model correctly select the right agent based on descriptions? Is context preserved across handoffs?

## Limits and edge cases

- Step limits: set a low `maxSteps`, verify execution stops
- Circular handoff: A -> B -> A, verify step limits prevent infinite loops
- Swarm with a single agent (edge case)
- Swarm with many agents (5+), verify the model can still select correctly

Watch for: Does the step limit prevent runaway loops? With many agents, does selection degrade or get confused?

## Events

- `MultiAgentHandoffEvent`: listen for handoff events, verify source/target

Watch for: Are handoff events emitted with correct metadata?
