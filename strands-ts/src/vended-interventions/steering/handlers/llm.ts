/**
 * LLM-based steering handler that uses an LLM to provide contextual guidance.
 */

import dedent from 'dedent'
import { z } from 'zod'
import { Agent } from '../../../agent/agent.js'
import type { Confirm, Guide, Proceed } from '../../../interventions/actions.js'
import type { Model } from '../../../models/model.js'
import type { ContentBlock, SystemPrompt } from '../../../types/messages.js'
import { CachePointBlock, TextBlock } from '../../../types/messages.js'
import type { LocalAgent } from '../../../types/agent.js'
import type { ToolUse } from '../../../tools/types.js'
import type { SteeringContextData, SteeringContextProvider } from '../providers/context-provider.js'
import { ToolLedgerProvider } from '../providers/tool-ledger.js'
import { SteeringHandler, type ToolSteeringAction } from './handler.js'

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Builds the evaluation prompt sent to the steering LLM.
 * Return a string for simple prompts, or ContentBlock[] to use cache points.
 */
export type PromptBuilder = (context: SteeringContextData[], toolUse?: ToolUse) => string | ContentBlock[]

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
  /** Model for steering evaluation. */
  model: Model

  /** Optional system prompt for the steering LLM. */
  systemPrompt?: SystemPrompt

  /** Custom prompt builder for evaluation prompts. Defaults to defaultPromptBuilder. */
  promptBuilder?: PromptBuilder

  /**
   * Context providers for populating steering context.
   * Defaults to [new ToolLedgerProvider()] if undefined. Pass an empty array to disable.
   */
  contextProviders?: SteeringContextProvider[]

  /**
   * Identifier for this handler instance. Defaults to `'strands:steering'`.
   * Override when attaching multiple steering handlers to the same agent.
   */
  name?: string
}

/** Schema returned by the steering LLM. */
const STEERING_DECISION = z.object({
  type: z
    .enum(['proceed', 'guide', 'interrupt'])
    .describe("Steering decision: 'proceed' to continue, 'guide' to provide feedback, 'interrupt' for human input"),
  reason: z.string().describe('Clear explanation of the steering decision and any guidance provided'),
})

type SteeringDecision = z.infer<typeof STEERING_DECISION>

/**
 * Steering handler that uses an LLM to provide contextual guidance.
 *
 * Uses natural language prompts to evaluate tool calls and produce an
 * intervention action. `interrupt` decisions become a {@link Confirm} so the
 * agent pauses for human approval via the interrupt system.
 *
 * Only `steerBeforeTool` is implemented — model-output steering is not
 * delegated to the LLM. Subclass and override {@link steerAfterModel} to
 * add LLM-driven evaluation of model responses.
 *
 * @example
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { LLMSteeringHandler } from '@strands-agents/sdk/vended-interventions/steering'
 * import { BedrockModel } from '@strands-agents/sdk/models/bedrock'
 *
 * const handler = new LLMSteeringHandler({
 *   model: new BedrockModel(),
 *   systemPrompt: `You ensure emails maintain a cheerful, positive tone.`,
 * })
 *
 * const agent = new Agent({ tools: [sendEmail], interventions: [handler] })
 * ```
 */
export class LLMSteeringHandler extends SteeringHandler {
  private readonly _promptBuilder: PromptBuilder
  private readonly _model: Model
  private readonly _systemPrompt?: SystemPrompt

  constructor(config: LLMSteeringHandlerConfig) {
    const contextProviders =
      config.contextProviders === undefined ? [new ToolLedgerProvider()] : config.contextProviders
    super({ contextProviders, ...(config.name !== undefined && { name: config.name }) })

    this._promptBuilder = config.promptBuilder ?? defaultPromptBuilder
    this._model = config.model
    if (config.systemPrompt !== undefined) {
      this._systemPrompt = config.systemPrompt
    }
  }

  override async steerBeforeTool(_agent: LocalAgent, toolUse: ToolUse): Promise<ToolSteeringAction> {
    const context = this.getSteeringContext()
    const prompt = this._promptBuilder(context, toolUse)
    const decision = await this._invoke(prompt)

    switch (decision.type) {
      case 'proceed':
        return { type: 'proceed', reason: decision.reason } satisfies Proceed
      case 'guide':
        return { type: 'guide', feedback: decision.reason } satisfies Guide
      case 'interrupt':
        return { type: 'confirm', prompt: decision.reason } satisfies Confirm
    }
  }

  // Constructs a fresh inner agent per call so the handler has no shared
  // mutable state between invocations — this keeps it safe to attach to
  // multiple parent agents (whose tool calls may evaluate concurrently).
  private async _invoke(prompt: string | ContentBlock[]): Promise<SteeringDecision> {
    const inner = new Agent({
      model: this._model,
      ...(this._systemPrompt !== undefined && { systemPrompt: this._systemPrompt }),
      structuredOutputSchema: STEERING_DECISION,
      printer: false,
    })
    const result = await inner.invoke(prompt)
    return STEERING_DECISION.parse(result.structuredOutput)
  }
}
