/**
 * LLM-based steering handler that uses an LLM to provide contextual guidance.
 */

import dedent from 'dedent'
import { z } from 'zod'
import { Agent } from '../../../agent/agent.js'
import { takeSnapshot, loadSnapshot } from '../../../agent/snapshot.js'
import type { Model } from '../../../models/model.js'
import type { SystemPrompt, ContentBlock } from '../../../types/messages.js'
import { TextBlock, CachePointBlock } from '../../../types/messages.js'
import type { LocalAgent } from '../../../types/agent.js'
import type { ToolUse } from '../../../tools/types.js'
import type { ToolSteeringAction } from '../actions.js'
import type { SteeringContextData, SteeringProvider } from '../providers/provider.js'
import { ToolLedgerSteeringProvider } from '../providers/ledgers.js'
import { SteeringHandler } from './handler.js'

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Builds the evaluation prompt sent to the steering LLM.
 * Return a string for simple prompts, or ContentBlock[] to use cache points.
 */
type PromptBuilder = (context: SteeringContextData[], toolUse?: ToolUse) => string | ContentBlock[]

/**
 * Default prompt builder. Returns content blocks with a cache point
 * between static instructions and dynamic context/event data.
 */
function defaultPromptBuilder(context: SteeringContextData[], toolUse?: ToolUse): ContentBlock[] {
  const contextStr = context.length > 0 ? JSON.stringify(context, null, 2) : 'No context available'

  let eventDescription: string
  if (toolUse) {
    eventDescription = `Tool: ${toolUse.name}\nArguments: ${JSON.stringify(toolUse.input, null, 2)}`
  } else {
    eventDescription = 'General evaluation'
  }

  const hasLedger = context.some((c) => c.type === 'toolLedger')

  const ledgerExplanation = hasLedger
    ? dedent`

      The context includes a ledger with tool_calls. Each entry has a "status" field:
      - "pending": the tool is currently being evaluated by you and has NOT started executing yet
      - "success": the tool completed successfully in a previous turn
      - "error": the tool failed or was cancelled in a previous turn
    `
    : ''

  const instructions = dedent`
    You are a steering agent that evaluates actions another agent is attempting.
    Decide whether the action should proceed, be guided with feedback, or be interrupted for human input.

    Rules:
    - Base decisions ONLY on the provided context data
    - Do not use external knowledge about tools or domains
    - Focus on patterns: repeated failures, inappropriate timing, excessive retries
    ${ledgerExplanation}
  `

  return [
    new TextBlock(instructions),
    new CachePointBlock({ cacheType: 'default' }),
    new TextBlock(`Context:\n${contextStr}\n\nEvent:\n${eventDescription}`),
  ]
}

// ---------------------------------------------------------------------------
// LLM steering handler
// ---------------------------------------------------------------------------

/**
 * Configuration for the LLMSteeringHandler.
 */
export interface LLMSteeringHandlerConfig {
  /**
   * Model for steering evaluation.
   */
  model: Model

  /**
   * Optional system prompt for the steering LLM.
   */
  systemPrompt?: SystemPrompt

  /**
   * Custom prompt builder for evaluation prompts.
   * Defaults to defaultPromptBuilder.
   */
  promptBuilder?: PromptBuilder

  /**
   * Context providers for populating steering context.
   * Defaults to [new LedgerProvider()] if undefined. Pass an empty array to disable.
   */
  providers?: SteeringProvider[]
}

/**
 * Steering handler that uses an LLM to provide contextual guidance.
 *
 * Uses natural language prompts to evaluate tool calls and provide
 * contextual steering guidance to help agents navigate complex workflows.
 *
 * @example
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { LLMSteeringHandler } from '@strands-agents/sdk/vended-plugins/steering'
 * import { BedrockModel } from '@strands-agents/sdk/models/bedrock'
 *
 * const handler = new LLMSteeringHandler({
 *   model: new BedrockModel(),
 *   systemPrompt: `You ensure emails maintain a cheerful, positive tone.
 *     Review email content and suggest more cheerful phrasing if needed.`,
 * })
 *
 * const agent = new Agent({
 *   tools: [sendEmail],
 *   plugins: [handler],
 * })
 * ```
 */
export class LLMSteeringHandler extends SteeringHandler {
  private readonly _promptBuilder: PromptBuilder
  private readonly _agent: Agent

  constructor(config: LLMSteeringHandlerConfig) {
    const providers = config.providers === undefined ? [new ToolLedgerSteeringProvider()] : config.providers
    super(providers)

    this._promptBuilder = config.promptBuilder ?? defaultPromptBuilder
    this._agent = new Agent({
      model: config.model,
      ...(config.systemPrompt !== undefined && { systemPrompt: config.systemPrompt }),
      structuredOutputSchema: z.object({
        type: z
          .enum(['proceed', 'guide', 'interrupt'])
          .describe(
            "Steering decision: 'proceed' to continue, 'guide' to provide feedback, 'interrupt' for human input"
          ),
        reason: z.string().describe('Clear explanation of the steering decision and any guidance provided'),
      }),
      printer: false,
    })
  }

  /**
   * Evaluate a tool call using the steering LLM.
   *
   * @param _agent - The agent instance
   * @param toolUse - The tool use being evaluated
   * @returns Steering action for the tool call
   */
  override async steerBeforeTool(_agent: LocalAgent, toolUse: ToolUse): Promise<ToolSteeringAction> {
    const context = this.getSteeringContext()
    const prompt = this._promptBuilder(context, toolUse)

    return this._invoke(prompt)
  }

  /**
   * Invoke the steering agent and return the validated decision.
   *
   * @param prompt - The evaluation prompt
   * @returns The validated steering action
   */
  private async _invoke(prompt: string | ContentBlock[]): Promise<ToolSteeringAction> {
    const snapshot = takeSnapshot(this._agent, { include: ['messages', 'state'] })
    try {
      const result = await this._agent.invoke(prompt)
      return result.structuredOutput as ToolSteeringAction
    } finally {
      loadSnapshot(this._agent, snapshot)
    }
  }
}
