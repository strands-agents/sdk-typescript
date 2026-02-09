import { createErrorResult, Tool } from './tool.js'
import type { ToolContext, ToolStreamGenerator } from './tool.js'
import type { ToolSpec } from './types.js'
import type { JSONSchema } from '../types/json.js'
import { TextBlock, ToolResultBlock } from '../types/messages.js'

/**
 * Forward reference for the Agent type to avoid circular imports.
 * AgentTool only uses invoke() and toString() on the result.
 */
interface AgentLike {
  invoke(args: string): Promise<{ toString(): string }>
}

/**
 * Configuration options for creating an AgentTool.
 */
export interface AgentToolConfig {
  /**
   * The unique name of the tool.
   */
  name: string

  /**
   * Human-readable description of the tool's purpose.
   * Helps the model understand when to invoke this agent.
   */
  description: string

  /**
   * The agent instance to wrap as a tool.
   */
  agent: AgentLike

  /**
   * Optional JSON Schema defining the expected input structure.
   * Defaults to a single required string `prompt` property.
   */
  inputSchema?: JSONSchema
}

/**
 * Default input schema for AgentTool: a single required string prompt.
 */
const DEFAULT_INPUT_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      description: 'The prompt or instruction to send to the agent',
    },
  },
  required: ['prompt'],
}

/**
 * A Tool implementation that wraps an Agent instance, enabling one agent to invoke
 * another as part of its tool use loop.
 *
 * AgentTool delegates to the wrapped agent's `invoke()` method and converts the
 * result into a ToolResultBlock. This enables multi-agent patterns where an
 * orchestrator agent can call specialized sub-agents.
 *
 * @example
 * ```typescript
 * const researcher = new Agent({
 *   model: new BedrockModel({ modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0' }),
 *   systemPrompt: 'You are a research specialist.',
 * })
 *
 * const researchTool = new AgentTool({
 *   name: 'researcher',
 *   description: 'Invokes a research agent to find information',
 *   agent: researcher,
 * })
 *
 * const orchestrator = new Agent({
 *   model: new BedrockModel({ modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0' }),
 *   tools: [researchTool],
 * })
 *
 * const result = await orchestrator.invoke('Research recent AI developments')
 * ```
 */
export class AgentTool extends Tool {
  /**
   * The unique name of the tool.
   */
  readonly name: string

  /**
   * Human-readable description of what the tool does.
   */
  readonly description: string

  /**
   * OpenAPI JSON specification for the tool.
   */
  readonly toolSpec: ToolSpec

  /**
   * The wrapped agent instance.
   */
  private readonly _agent: AgentLike

  /**
   * Creates a new AgentTool instance.
   *
   * @param config - Configuration object for the agent tool
   */
  constructor(config: AgentToolConfig) {
    super()
    this.name = config.name
    this.description = config.description
    this._agent = config.agent

    const inputSchema = config.inputSchema ?? DEFAULT_INPUT_SCHEMA

    this.toolSpec = {
      name: config.name,
      description: config.description,
      inputSchema,
    }
  }

  /**
   * Executes the wrapped agent and returns the result as a ToolResultBlock.
   *
   * Extracts a prompt string from the tool input, invokes the wrapped agent,
   * and converts the agent's response into a ToolResultBlock.
   *
   * @param toolContext - Context information including the tool use request
   * @returns Async generator that returns a ToolResultBlock
   */
  // eslint-disable-next-line require-yield
  async *stream(toolContext: ToolContext): ToolStreamGenerator {
    const { toolUse } = toolContext

    try {
      const prompt = this._extractPrompt(toolUse.input)
      const agentResult = await this._agent.invoke(prompt)
      const responseText = agentResult.toString()

      return new ToolResultBlock({
        toolUseId: toolUse.toolUseId,
        status: 'success',
        content: [new TextBlock(responseText)],
      })
    } catch (error) {
      return createErrorResult(error, toolUse.toolUseId)
    }
  }

  /**
   * Extracts a prompt string from the tool input.
   *
   * Supports:
   * - String input: used directly as the prompt
   * - Object with `prompt` field: extracts the prompt string
   * - Other objects: serialized to JSON as the prompt
   *
   * @param input - The raw tool input
   * @returns The extracted prompt string
   */
  private _extractPrompt(input: unknown): string {
    if (typeof input === 'string') {
      return input
    }

    if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
      const obj = input as Record<string, unknown>
      if (typeof obj.prompt === 'string') {
        return obj.prompt
      }
      return JSON.stringify(input)
    }

    return String(input)
  }
}
