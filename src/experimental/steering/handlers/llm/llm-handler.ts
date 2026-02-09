/**
 * LLM-based steering handler that uses an LLM to provide contextual guidance.
 *
 * @experimental This API is experimental and may change in future releases.
 */

import { z } from 'zod'
import type { AgentData } from '../../../../types/agent.js'
import type { Model } from '../../../../models/model.js'
import type { SteeringContextProvider } from '../../core/context.js'
import type { ToolSteeringAction } from '../../core/action.js'
import type { SteeringToolUse } from '../../core/handler.js'
import { Proceed, Guide, Interrupt } from '../../core/action.js'
import { SteeringHandler } from '../../core/handler.js'
import { LedgerProvider } from '../../context-providers/ledger-provider.js'
import { DefaultPromptMapper, type LLMPromptMapper } from './mappers.js'

/**
 * Zod schema for LLM steering decisions.
 */
const llmSteeringSchema = z
  .object({
    decision: z
      .enum(['proceed', 'guide', 'interrupt'])
      .describe("Steering decision: 'proceed' to continue, 'guide' to provide feedback, 'interrupt' for human input"),
    reason: z.string().describe('Clear explanation of the steering decision and any guidance provided'),
  })
  .describe('LLMSteering')

type LLMSteeringResult = z.infer<typeof llmSteeringSchema>

/**
 * Configuration for LLMSteeringHandler.
 *
 * @experimental This API is experimental and may change in future releases.
 */
export interface LLMSteeringHandlerConfig {
  /**
   * System prompt defining steering guidance rules.
   */
  systemPrompt: string

  /**
   * Model to use for steering evaluation. Required.
   * Choose a fast/cheap model suitable for evaluation tasks.
   */
  model: Model

  /**
   * Custom prompt mapper for evaluation prompts.
   * Defaults to DefaultPromptMapper.
   */
  promptMapper?: LLMPromptMapper | undefined

  /**
   * Context providers for populating steering context.
   * Defaults to [LedgerProvider()] if undefined.
   * Pass an empty array to disable context providers.
   */
  contextProviders?: SteeringContextProvider[] | undefined
}

/**
 * Steering handler that uses an LLM to provide contextual guidance.
 *
 * Uses natural language prompts to evaluate tool calls and provide
 * contextual steering guidance to help agents navigate complex workflows.
 * Creates an isolated agent instance for steering evaluation (no shared
 * conversation state with the main agent).
 *
 * @experimental This API is experimental and may change in future releases.
 */
export class LLMSteeringHandler extends SteeringHandler {
  private readonly _systemPrompt: string
  private readonly _model: Model
  private readonly _promptMapper: LLMPromptMapper

  constructor(config: LLMSteeringHandlerConfig) {
    const providers: SteeringContextProvider[] = config.contextProviders ?? [new LedgerProvider()]
    super({ contextProviders: providers })
    this._systemPrompt = config.systemPrompt
    this._model = config.model
    this._promptMapper = config.promptMapper ?? new DefaultPromptMapper()
  }

  /**
   * Evaluates a tool call using an LLM and returns a steering action.
   *
   * Creates an isolated agent with structured output to evaluate the tool call.
   * The steering agent has no shared conversation state with the main agent.
   *
   * @param params - Parameters for the steering evaluation
   * @returns Steering action based on LLM evaluation
   */
  protected override async steerBeforeTool(params: {
    agent: AgentData
    toolUse: SteeringToolUse
  }): Promise<ToolSteeringAction> {
    // Generate steering prompt
    const prompt = this._promptMapper.createSteeringPrompt(this.steeringContext, {
      name: params.toolUse.name,
      input: params.toolUse.input,
    })

    // Dynamically import Agent to avoid circular dependencies at module load time
    const { Agent } = await import('../../../../agent/agent.js')

    // Create isolated agent for steering evaluation (no shared conversation state)
    const steeringAgent = new Agent({
      systemPrompt: this._systemPrompt,
      model: this._model,
    })

    // Get LLM decision via structured output
    const result = await steeringAgent.invoke(prompt, { structuredOutput: llmSteeringSchema })
    const llmResult = result.structuredOutput as LLMSteeringResult

    // Convert LLM decision to steering action
    switch (llmResult.decision) {
      case 'proceed':
        return new Proceed({ reason: llmResult.reason })
      case 'guide':
        return new Guide({ reason: llmResult.reason })
      case 'interrupt':
        return new Interrupt({ reason: llmResult.reason })
      default:
        return new Proceed({ reason: 'Unknown LLM decision, defaulting to proceed' })
    }
  }
}
