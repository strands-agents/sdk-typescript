import type { Node } from './nodes.js'
import type { MultiAgentState } from './state.js'

/**
 * Evaluates whether an edge should be traversed based on the current execution state.
 */
export type EdgeHandler = (state: MultiAgentState) => boolean | Promise<boolean>

/**
 * Directed edge between two nodes.
 */
export class Edge {
  readonly source: Node
  readonly target: Node
  readonly handler: EdgeHandler

  constructor(data: { source: Node; target: Node; handler?: EdgeHandler }) {
    this.source = data.source
    this.target = data.target
    this.handler = data.handler ?? ((): boolean => true)
  }
}

/**
 * An edge definition accepted by orchestration constructors.
 */
export interface EdgeDefinition {
  source: string
  target: string
  handler?: EdgeHandler
}
