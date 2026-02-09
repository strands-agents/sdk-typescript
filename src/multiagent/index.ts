/**
 * Multi-agent orchestration module.
 *
 * Provides multi-agent patterns (Swarm, Graph) for coordinating
 * multiple agents to solve complex tasks.
 */

// Base infrastructure
export { MultiAgentBase, MultiAgentResult, NodeResult, Status } from './base.js'

// Types
export type { MultiAgentInput, MultiAgentInvokeOptions, MultiAgentStreamEvent } from './types.js'

// Streaming events
export {
  MultiAgentHandoffEvent,
  MultiAgentNodeCancelEvent,
  MultiAgentNodeInputEvent,
  MultiAgentNodeInterruptEvent,
  MultiAgentNodeStartEvent,
  MultiAgentNodeStopEvent,
  MultiAgentNodeStreamEvent,
  MultiAgentResultEvent,
} from './streaming-events.js'

// Swarm
export { SharedContext, Swarm, SwarmNode, SwarmResult, SwarmState } from './swarm.js'

// Graph
export { Graph, GraphBuilder, GraphEdge, GraphNode, GraphResult, GraphState, type GraphExecutor } from './graph.js'

// Hook events
export {
  AfterMultiAgentInvocationEvent,
  AfterNodeCallEvent,
  BeforeMultiAgentInvocationEvent,
  BeforeNodeCallEvent,
  MultiAgentInitializedEvent,
} from './hook-events.js'
