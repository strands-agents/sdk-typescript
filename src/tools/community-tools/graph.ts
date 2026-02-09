import { Agent } from '../../agent/agent.js'
import { FunctionTool } from '../function-tool.js'
import { GraphBuilder } from '../../multiagent/graph.js'
import type { JSONValue } from '../../types/json.js'
import type { Model } from '../../models/model.js'
import type { Tool, ToolContext } from '../tool.js'
import { createModelFromConfig, getParentModel, getParentTools, resolveParentTools } from './multiagent-utils.js'

interface GraphNodeDefinition {
  id: string
  role: string
  system_prompt: string
  model_provider?: string
  model_settings?: Record<string, unknown>
  tools?: string[]
}

interface GraphEdgeDefinition {
  from: string
  to: string
}

interface GraphTopology {
  nodes: GraphNodeDefinition[]
  edges?: GraphEdgeDefinition[]
  entry_points?: string[]
}

interface LastExecutionData {
  task: string
  status: string
  completed_nodes: number
  failed_nodes: number
  execution_time: number
  timestamp: number
}

interface GraphMetadata {
  graph_id: string
  created_at: number
  node_count: number
  edge_count: number
  entry_points: string[]
  topology: GraphTopology
  last_execution: LastExecutionData | null
}

interface StoredGraph {
  graph: {
    invoke: (task: string) => Promise<unknown>
    stream: (task: string) => AsyncGenerator<unknown, unknown, unknown>
  }
  metadata: GraphMetadata
}

interface GraphExecutionResult {
  status: { value?: string } | string
  completedNodes: number
  failedNodes: number
  results: Record<string, { getAgentResults: () => Array<{ toString: () => string }> }>
}

interface ManagerResult {
  status: 'success' | 'error'
  message: string
  data?: unknown
}

interface CreateGraphArgs {
  graphId: string
  topology: GraphTopology
  parentAgent: unknown
  modelProvider?: string
  modelSettings?: Record<string, unknown>
  tools?: string[]
}

interface GraphInput {
  action?: string
  graph_id?: string
  topology?: GraphTopology
  task?: string
  model_provider?: string
  model_settings?: Record<string, unknown>
  tools?: string[]
}

function errorResult(text: string): JSONValue {
  return { status: 'error', content: [{ text }] }
}

function successResult(text: string): JSONValue {
  return { status: 'success', content: [{ text }] }
}

function coerceError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function deriveEntryPoints(topology: GraphTopology): string[] {
  const explicit = topology.entry_points
  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit
  }

  const incoming = new Set((topology.edges ?? []).map((edge) => edge.to))
  return topology.nodes.map((node) => node.id).filter((id) => !incoming.has(id))
}

export async function createAgentWithModel(args: {
  systemPrompt: string
  modelProvider?: string
  modelSettings?: Record<string, unknown>
  tools?: string[]
  parentAgent?: unknown
}): Promise<Agent> {
  const fallbackModel = getParentModel(args.parentAgent)
  const model = await createModelFromConfig(args.modelProvider, args.modelSettings, fallbackModel)
  const configuredTools =
    args.tools != null ? resolveParentTools(args.parentAgent, args.tools) : getParentTools(args.parentAgent)

  const config: {
    systemPrompt: string
    tools: Tool[]
    model?: Model
  } = {
    systemPrompt: args.systemPrompt,
    tools: configuredTools,
  }

  if (model != null) {
    config.model = model
  }

  return new Agent(config)
}

export class GraphManager {
  private readonly graphs: Map<string, StoredGraph> = new Map()

  async createGraph(args: CreateGraphArgs): Promise<ManagerResult> {
    if (this.graphs.has(args.graphId)) {
      return { status: 'error', message: `Graph ${args.graphId} already exists` }
    }

    if (args.topology.nodes.length === 0) {
      return { status: 'error', message: 'Graph topology must contain at least one node' }
    }

    try {
      const builder = new GraphBuilder()
      for (const node of args.topology.nodes) {
        const effectiveModelProvider = node.model_provider ?? args.modelProvider
        const effectiveModelSettings = node.model_settings ?? args.modelSettings
        const effectiveTools = node.tools ?? args.tools

        const nodeAgent = await createAgentWithModel({
          systemPrompt: node.system_prompt,
          ...(effectiveModelProvider != null ? { modelProvider: effectiveModelProvider } : {}),
          ...(effectiveModelSettings != null ? { modelSettings: effectiveModelSettings } : {}),
          ...(effectiveTools != null ? { tools: effectiveTools } : {}),
          parentAgent: args.parentAgent,
        })

        builder.addNode(nodeAgent, node.id)
      }

      for (const edge of args.topology.edges ?? []) {
        builder.addEdge(edge.from, edge.to)
      }

      const entryPoints = deriveEntryPoints(args.topology)
      for (const entryPoint of entryPoints) {
        builder.setEntryPoint(entryPoint)
      }

      const graph = builder.build()
      this.graphs.set(args.graphId, {
        graph,
        metadata: {
          graph_id: args.graphId,
          created_at: Date.now(),
          node_count: args.topology.nodes.length,
          edge_count: (args.topology.edges ?? []).length,
          entry_points: entryPoints,
          topology: {
            ...args.topology,
            entry_points: entryPoints,
          },
          last_execution: null,
        },
      })

      return {
        status: 'success',
        message: `Graph ${args.graphId} created successfully with ${args.topology.nodes.length} nodes`,
      }
    } catch (error) {
      return {
        status: 'error',
        message: `Error creating graph: ${coerceError(error)}`,
      }
    }
  }

  async executeGraph(graphId: string, task: string): Promise<ManagerResult> {
    const stream = this.executeGraphStream(graphId, task)
    let next = await stream.next()
    while (!next.done) {
      next = await stream.next()
    }
    return next.value
  }

  async *executeGraphStream(graphId: string, task: string): AsyncGenerator<JSONValue, ManagerResult, never> {
    const stored = this.graphs.get(graphId)
    if (stored == null) {
      return { status: 'error', message: `Graph ${graphId} not found` }
    }

    try {
      const startedAt = Date.now()
      const stream = stored.graph.stream(task) as AsyncGenerator<unknown, GraphExecutionResult, unknown>
      let next = await stream.next()
      while (!next.done) {
        yield next.value as unknown as JSONValue
        next = await stream.next()
      }
      const result = next.value as GraphExecutionResult
      const executionTime = Date.now() - startedAt
      const statusValue =
        typeof result.status === 'string' ? result.status : (result.status.value ?? String(result.status))

      const resultLines: string[] = []
      for (const [nodeId, nodeResult] of Object.entries(result.results)) {
        const agentResults = nodeResult.getAgentResults()
        for (const agentResult of agentResults) {
          resultLines.push(`Node ${nodeId}: ${agentResult.toString()}`)
        }
      }

      stored.metadata.last_execution = {
        task,
        status: statusValue,
        completed_nodes: result.completedNodes,
        failed_nodes: result.failedNodes,
        execution_time: executionTime,
        timestamp: Date.now(),
      }

      return {
        status: 'success',
        message: `Graph ${graphId} executed successfully`,
        data: {
          execution_time: executionTime,
          completed_nodes: result.completedNodes,
          failed_nodes: result.failedNodes,
          results: resultLines,
        },
      }
    } catch (error) {
      return {
        status: 'error',
        message: `Error executing graph: ${coerceError(error)}`,
      }
    }
  }

  getGraphStatus(graphId: string): ManagerResult {
    const stored = this.graphs.get(graphId)
    if (stored == null) {
      return { status: 'error', message: `Graph ${graphId} not found` }
    }

    const metadata = stored.metadata
    const nodes = metadata.topology.nodes.map((node) => ({
      id: node.id,
      role: node.role,
      model_provider: node.model_provider ?? 'default',
      tools_count: node.tools?.length ?? 'default',
      dependencies: (metadata.topology.edges ?? []).filter((edge) => edge.to === node.id).map((edge) => edge.from),
    }))

    return {
      status: 'success',
      message: `Graph ${graphId} status retrieved`,
      data: {
        graph_id: graphId,
        total_nodes: metadata.node_count,
        entry_points: metadata.entry_points.map((nodeId) => ({ node_id: nodeId })),
        execution_status: 'ready',
        last_execution: metadata.last_execution,
        nodes,
      },
    }
  }

  listGraphs(): ManagerResult {
    const data = Array.from(this.graphs.values()).map((stored) => ({
      graph_id: stored.metadata.graph_id,
      node_count: stored.metadata.node_count,
      edge_count: stored.metadata.edge_count,
      entry_points: stored.metadata.entry_points.length,
      created_at: stored.metadata.created_at,
      last_executed: stored.metadata.last_execution?.timestamp ?? null,
    }))

    return {
      status: 'success',
      message: `Listed ${data.length} graphs`,
      data,
    }
  }

  deleteGraph(graphId: string): ManagerResult {
    if (!this.graphs.has(graphId)) {
      return { status: 'error', message: `Graph ${graphId} not found` }
    }

    this.graphs.delete(graphId)
    return { status: 'success', message: `Graph ${graphId} deleted successfully` }
  }

  reset(): void {
    this.graphs.clear()
  }
}

const manager = new GraphManager()

export function resetGraphManagerForTests(): void {
  manager.reset()
}

async function* runGraph(input: GraphInput, toolContext: ToolContext): AsyncGenerator<JSONValue, JSONValue, never> {
  const action = typeof input.action === 'string' ? input.action : ''
  const graphId = input.graph_id
  const topology = input.topology
  const task = input.task

  if (action === 'create') {
    if (graphId == null || topology == null) {
      return errorResult('graph_id and topology are required for create action')
    }

    const result = await manager.createGraph({
      graphId,
      topology,
      parentAgent: toolContext.agent,
      ...(input.model_provider != null ? { modelProvider: input.model_provider } : {}),
      ...(input.model_settings != null ? { modelSettings: input.model_settings } : {}),
      ...(input.tools != null ? { tools: input.tools } : {}),
    })

    if (result.status === 'error') {
      return errorResult(`❌ Error: ${result.message}`)
    }

    return successResult(result.message)
  }

  if (action === 'execute') {
    if (graphId == null || task == null) {
      return errorResult('graph_id and task are required for execute action')
    }

    const stream = manager.executeGraphStream(graphId, task)
    let next = await stream.next()
    while (!next.done) {
      yield next.value
      next = await stream.next()
    }
    const result = next.value
    if (result.status === 'error') {
      return errorResult(`❌ Error: ${result.message}`)
    }

    return successResult(result.message)
  }

  if (action === 'status') {
    if (graphId == null) {
      return errorResult('graph_id is required for status action')
    }

    const result = manager.getGraphStatus(graphId)
    if (result.status === 'error') {
      return errorResult(`❌ Error: ${result.message}`)
    }

    return successResult(result.message)
  }

  if (action === 'list') {
    const result = manager.listGraphs()
    return successResult(result.message)
  }

  if (action === 'delete') {
    if (graphId == null) {
      return errorResult('graph_id is required for delete action')
    }

    const result = manager.deleteGraph(graphId)
    if (result.status === 'error') {
      return errorResult(`❌ Error: ${result.message}`)
    }

    return successResult(result.message)
  }

  return errorResult(`Unknown action: ${action}. Valid actions: create, execute, status, list, delete`)
}

export const graph = new FunctionTool({
  name: 'graph',
  description: 'Create and manage multi-agent graphs using the Strands SDK Graph implementation',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'execute', 'status', 'list', 'delete'],
        description: 'Action to perform',
      },
      graph_id: { type: 'string', description: 'Unique graph identifier' },
      topology: {
        type: 'object',
        description: 'Graph topology definition',
      },
      task: { type: 'string', description: 'Task to execute through the graph' },
      model_provider: { type: 'string', description: 'Default model provider for graph nodes' },
      model_settings: { type: 'object', description: 'Default model settings for graph nodes' },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Default tool names for graph nodes',
      },
    },
    required: ['action'],
  },
  callback: (input: unknown, toolContext: ToolContext): AsyncGenerator<JSONValue, JSONValue, never> =>
    runGraph((input ?? {}) as GraphInput, toolContext),
})
