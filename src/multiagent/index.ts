/**
 * Multi-agent orchestration module.
 */

export { MultiAgentState, NodeState, Status, NodeResult, MultiAgentResult } from './state.js'
export type { NodeResultUpdate, ResultStatus } from './state.js'

export { Node, AgentNode, MultiAgentNode } from './nodes.js'
export type { NodeConfig, AgentNodeOptions, MultiAgentNodeOptions, NodeDefinition, NodeType } from './nodes.js'

export type { MultiAgentBase } from './base.js'

export {
  MultiAgentInitializedEvent,
  BeforeMultiAgentInvocationEvent,
  AfterMultiAgentInvocationEvent,
  BeforeNodeCallEvent,
  AfterNodeCallEvent,
  NodeStreamUpdateEvent,
  NodeResultEvent,
  MultiAgentHandoffEvent,
  MultiAgentResultEvent,
} from './events.js'
export type { MultiAgentStreamEvent } from './events.js'

export { Edge } from './edge.js'
export type { EdgeHandler, EdgeDefinition } from './edge.js'
