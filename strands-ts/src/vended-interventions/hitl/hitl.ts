import { InterventionHandler } from '../../interventions/handler.js'
import { confirm, proceed } from '../../interventions/actions.js'
import type { InterventionAction } from '../../interventions/actions.js'
import type { BeforeToolCallEvent } from '../../hooks/events.js'
import type { JSONValue } from '../../types/json.js'

const TRUST_RESPONSES = new Set(['t', 'trust'])
const TRUSTED_TOOLS_KEY = 'hitl:trustedTools'

/**
 * Default CLI prompt that reads from stdin.
 * Serializes prompts so concurrent tool calls don't collide on stdin.
 */
function createDefaultAsk(includeTrust: boolean): (prompt: string) => Promise<JSONValue> {
  const options = includeTrust ? '(y/n/t)' : '(y/n)'
  let queue: Promise<unknown> = Promise.resolve()

  return (prompt: string) => {
    const task = queue.then(async () => {
      const { createInterface } = await import('node:readline')
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      return new Promise<JSONValue>((resolve) => {
        rl.question(`${prompt} ${options}: `, (answer) => {
          rl.close()
          resolve(answer.trim())
        })
      })
    })
    queue = task.catch(() => {})
    return task
  }
}

/**
 * Configuration for the {@link HumanInTheLoop} intervention handler.
 */
export interface HumanInTheLoopConfig {
  /**
   * Tools that can execute WITHOUT human approval. All other tools require approval.
   *
   * - Use `'*'` to allow all tools.
   * - Prefix with `!` to exclude specific tools from `'*'` (they still require approval).
   *
   * @example
   * ```typescript
   * // Only readFile and listDir run freely; everything else needs approval
   * { allowedTools: ['readFile', 'listDir'] }
   *
   * // All tools run freely (HITL disabled)
   * { allowedTools: ['*'] }
   *
   * // All tools run freely EXCEPT deleteFile and sendEmail
   * { allowedTools: ['*', '!deleteFile', '!sendEmail'] }
   * ```
   */
  allowedTools?: string[]

  /**
   * When true, the default CLI prompt includes a "trust" option (t).
   * If the human responds with 't', the tool is approved AND remembered
   * in `agent.appState` for the rest of the session (won't ask again).
   *
   * Negated tools (`!tool`) cannot be trusted.
   * Has no effect without an `ask` callback (interrupt/resume mode has no inline session).
   *
   * Defaults to `false`.
   */
  enableTrust?: boolean

  /**
   * Custom response validator. Defaults to accepting `true`, `'y'`/`'yes'` (case-insensitive).
   */
  evaluate?: (response: JSONValue) => boolean

  /**
   * Controls how the human's response is collected.
   *
   * - **Default** (omitted): uses interrupt/resume — agent pauses, caller resumes with response.
   * - **`'stdio'`**: prompts via CLI readline (Node.js only). Agent blocks inline until human responds.
   * - **Custom function**: your own async prompt logic (Slack, web UI, etc.). Agent blocks inline.
   */
  ask?: ((prompt: string) => Promise<JSONValue>) | 'stdio'
}

/**
 * Human-in-the-loop intervention handler that pauses agent execution
 * before tool calls to request human approval.
 *
 * By default, ALL tools require approval and the agent pauses via interrupt/resume.
 * Use `allowedTools` to whitelist tools that run freely, and `ask` to provide
 * inline prompting (CLI, custom UI).
 *
 * @example
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { HumanInTheLoop } from '@strands-agents/sdk/vended-interventions/hitl'
 *
 * // All tools require approval, agent pauses via interrupt (default)
 * const agent = new Agent({
 *   interventions: [new HumanInTheLoop()],
 * })
 *
 * // readFile runs freely, everything else pauses for approval
 * const agent = new Agent({
 *   interventions: [new HumanInTheLoop({ allowedTools: ['readFile'] })],
 * })
 *
 * // CLI mode — prompts in terminal inline
 * const agent = new Agent({
 *   interventions: [new HumanInTheLoop({ ask: 'stdio' })],
 * })
 *
 * // Custom UI — provide your own prompt function
 * const agent = new Agent({
 *   interventions: [new HumanInTheLoop({
 *     ask: async (prompt) => await slackDM(userId, prompt),
 *   })],
 * })
 * ```
 */
export class HumanInTheLoop extends InterventionHandler {
  readonly name = 'human-in-the-loop'

  private readonly _allowedTools: Set<string>
  private readonly _enableTrust: boolean
  private readonly _evaluate: ((response: JSONValue) => boolean) | undefined
  private readonly _ask: ((prompt: string) => Promise<JSONValue>) | undefined

  constructor(config?: HumanInTheLoopConfig) {
    super()
    this._allowedTools = new Set(config?.allowedTools ?? [])
    this._enableTrust = config?.enableTrust ?? false
    this._evaluate = config?.evaluate
    this._ask = config?.ask === 'stdio' ? createDefaultAsk(this._enableTrust) : config?.ask
  }

  override async beforeToolCall(event: BeforeToolCallEvent): Promise<InterventionAction> {
    const toolName = event.toolUse.name
    if (!this._requiresApproval(event)) {
      return proceed()
    }

    const prompt = `Tool "${toolName}" requires human approval. Input: ${JSON.stringify(event.toolUse.input)}`

    if (!this._ask) {
      return confirm(prompt, {
        ...(this._evaluate && { evaluate: this._evaluate }),
      })
    }

    const response = await this._ask(prompt)

    if (this._enableTrust && this._isTrustResponse(response)) {
      this._trustTool(event, toolName)
      return proceed()
    }

    return confirm(prompt, {
      response,
      ...(this._evaluate && { evaluate: this._evaluate }),
    })
  }

  /**
   * Precedence (first match wins):
   * 1. Negated (`!tool`) → always requires approval (cannot be trusted)
   * 2. Trusted at runtime via 't' response (stored in agent.appState) → runs freely
   * 3. Wildcard (`*`) → runs freely
   * 4. Explicitly listed → runs freely
   * 5. Default → requires approval
   */
  private _requiresApproval(event: BeforeToolCallEvent): boolean {
    const toolName = event.toolUse.name
    if (this._allowedTools.has(`!${toolName}`)) return true
    const trusted = (event.agent.appState.get(TRUSTED_TOOLS_KEY) as string[] | undefined) ?? []
    if (trusted.includes(toolName)) return false
    if (this._allowedTools.has('*')) return false
    if (this._allowedTools.has(toolName)) return false
    return true
  }

  private _trustTool(event: BeforeToolCallEvent, toolName: string): void {
    const trusted = (event.agent.appState.get(TRUSTED_TOOLS_KEY) as string[] | undefined) ?? []
    if (!trusted.includes(toolName)) {
      event.agent.appState.set(TRUSTED_TOOLS_KEY, [...trusted, toolName])
    }
  }

  private _isTrustResponse(response: JSONValue): boolean {
    if (typeof response === 'string') return TRUST_RESPONSES.has(response.toLowerCase().trim())
    return false
  }
}
