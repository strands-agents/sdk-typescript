/**
 * Iterative-refinement plugin for Strands agents
 * Validates the agent's response after each invocation; if it doesn't
 * satisfy the goal, feeds validator feedback back as a user message and re-enters the
 * agent loop via `AfterInvocationEvent.resume`. Loops until validation passes,
 * `maxAttempts` is reached, or `timeout` elapses.
 *
 * @example
 * ```ts
 * import { Agent } from '@strands-agents/sdk'
 * import { GoalPlugin } from '@strands-agents/sdk/vended-plugins/goal'
 *
 * // Natural-language goal — judged by an internal Agent built from the host's model.
 * const concise = new GoalPlugin({
 *   validate: 'At most 3 sentences, accessible to a 10-year-old, no jargon.',
 *   maxAttempts: 3,
 * })
 * const agent = new Agent({ model, plugins: [concise] })
 * await agent.invoke('Explain how rainbows form.')
 * console.log(concise.lastResult)
 * ```
 *
 * @example
 * ```ts
 * // Programmatic validator — runs your own check (here, a word-count cap).
 * const wordCount = new GoalPlugin({
 *   validate: (response) => {
 *     const text = response.content.flatMap((b) => (b.type === 'textBlock' ? [b.text] : [])).join(' ')
 *     const words = text.trim().split(/\s+/).length
 *     return words <= 50 || { passed: false, feedback: `Too long (${words} words). Cap at 50.` }
 *   },
 *   maxAttempts: 5,
 *   timeout: 30_000,
 * })
 * ```
 *
 * @example
 * ```ts
 * // Toolchain-driven validator — runs `npm test` after each attempt and gates
 * // on exit code (a Ralph-shaped use). Pair with file-editor / bash tools so the
 * // agent can actually fix what the test runner reports.
 * import { exec } from 'node:child_process'
 * import { promisify } from 'node:util'
 * const execAsync = promisify(exec)
 *
 * new GoalPlugin({
 *   validate: async () => {
 *     try {
 *       await execAsync('npm test')
 *       return true
 *     } catch (err) {
 *       const e = err as { stdout?: string; stderr?: string; code?: number }
 *       const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.slice(-4000)
 *       return { passed: false, feedback: `npm test exited ${e.code}.\n\n${out}` }
 *     }
 *   },
 *   maxAttempts: 10,
 * })
 * ```
 */

import { Agent } from '../../agent/agent.js'
import { AfterInvocationEvent, BeforeInvocationEvent, BeforeModelCallEvent } from '../../hooks/events.js'
import { logger } from '../../logging/logger.js'
import { warnOnce } from '../../logging/warn-once.js'
import type { Model } from '../../models/model.js'
import type { Plugin } from '../../plugins/plugin.js'
import type { LocalAgent } from '../../types/agent.js'
import type { Message } from '../../types/messages.js'
import type { Snapshot } from '../../types/snapshot.js'
import { JUDGE_OUTCOME_SCHEMA, JUDGE_SYSTEM_PROMPT, buildJudgePrompt } from './judge.js'

/** Outcome a validator returns. */
export interface ValidationOutcome {
  passed: boolean
  /** Feedback fed to the agent as a user message before the next attempt. */
  feedback?: string
}

/**
 * Validator must return `true`, `false`, or a `ValidationOutcome`. Booleans
 * are shorthand: `true` → pass, `false` → fail with no feedback. Use the
 * object form when you have actionable feedback for the next attempt.
 */
export type Validator =
  | string
  | ((response: Message) => boolean | ValidationOutcome | Promise<boolean | ValidationOutcome>)

/** Why a goal run ended. */
export type GoalStopReason = 'satisfied' | 'maxAttempts' | 'timeout'

/** Single attempt summary preserved on `GoalResult`. */
export interface GoalAttempt {
  /** 1-indexed attempt number. */
  attempt: number
  passed: boolean
  feedback?: string
}

/** Aggregate result of a goal run, exposed via `GoalPlugin.lastResult`. */
export interface GoalResult {
  passed: boolean
  stopReason: GoalStopReason
  attempts: readonly GoalAttempt[]
}

/** Configuration for {@link GoalPlugin}. */
export interface GoalPluginOptions {
  /**
   * Validator. Pass a string for a natural-language goal — an internal judge
   * Agent grades the response. Pass a function for a programmatic predicate.
   */
  validate: Validator
  /**
   * Model used by the auto-built judge when `validate` is a string. Defaults to
   * the host agent's model. Consider passing a cheaper or faster model.
   * Harmlessly ignored when `validate` is a function — no judge is built in that case.
   */
  evaluatorModel?: Model
  /** Max attempts. Defaults to `Infinity`. `warnOnce` when both this and `timeout` are unbounded. */
  maxAttempts?: number
  /** Wall-clock budget for the whole run, in ms. Defaults to `Infinity`. */
  timeout?: number
  /** Plugin name. Defaults to `'strands:goal'`. Override only when stacking multiple goal plugins. */
  name?: string
  /**
   * Ralph-Wiggum-style retry loop: each failed attempt restores the agent's
   * transcript to its initial post-input state, then re-runs the goal with
   * the latest validator feedback as a fresh user message. The agent never
   * sees its own prior attempts. Other state (appState, modelState,
   * systemPrompt) accumulates normally — only messages rewind.
   */
  freshContextPerAttempt?: boolean
  /**
   * Builds the user message fed to the agent before each retry. Receives the
   * trimmed validator feedback (or `undefined` if the validator gave none).
   * Override to localize the default English, retune the framing, or embed
   * feedback in a domain-specific structure.
   */
  resumePromptTemplate?: (feedback: string | undefined) => string
}

/**
 * Single source of truth for an in-progress or just-finished goal run.
 *
 * - `result` undefined → run is mid-flight; `lastResult` returns undefined.
 * - `result` set → run terminated with that outcome; survives until the next
 *   top-level invoke, when the Before hook clears the run.
 * - `resumed` true between After arming `event.resume` and the next Before
 *   consuming it; lets Before tell a continuation from a fresh invoke.
 */
interface RunState {
  startTime: number
  attempts: GoalAttempt[]
  result?: GoalResult
  resumed?: boolean
  /**
   * Set on attempt 1 when `freshContextPerAttempt` is enabled. Captures the
   * post-input transcript only (no appState / modelState / systemPrompt /
   * interrupts — those accumulate normally across attempts). Restored before
   * each retry so the agent sees the original input and nothing else.
   */
  initialSnapshot?: Snapshot
}

/**
 * Iterative-refinement plugin. Construct a separate `GoalPlugin` for each `Agent`
 * you attach it to — sharing one instance across multiple agents is not supported.
 */
export class GoalPlugin implements Plugin {
  readonly name: string

  private readonly _validate: Validator
  private readonly _evaluatorModel?: Model
  private readonly _maxAttempts: number
  private readonly _timeout: number
  private readonly _freshContextPerAttempt: boolean
  private readonly _resumePromptTemplate: (feedback: string | undefined) => string
  private _run: RunState | undefined = undefined
  // Set in `initAgent` before any hook fires.
  private _validator!: (response: Message) => Promise<ValidationOutcome>
  private _initialised = false

  constructor(opts: GoalPluginOptions) {
    if ((opts.maxAttempts ?? Infinity) < 1) {
      throw new Error(`maxAttempts=<${opts.maxAttempts}> | must be at least 1`)
    }
    if ((opts.timeout ?? Infinity) < 1) {
      throw new Error(`timeout=<${opts.timeout}> | must be at least 1`)
    }
    this.name = opts.name ?? 'strands:goal'
    this._validate = opts.validate
    if (opts.evaluatorModel !== undefined) this._evaluatorModel = opts.evaluatorModel
    this._maxAttempts = opts.maxAttempts ?? Infinity
    this._timeout = opts.timeout ?? Infinity
    this._freshContextPerAttempt = opts.freshContextPerAttempt ?? false
    this._resumePromptTemplate = opts.resumePromptTemplate ?? defaultResumePrompt
    if (this._maxAttempts === Infinity && this._timeout === Infinity) {
      warnOnce(logger, `${this.name} has no maxAttempts or timeout; execution is unbounded`)
    }
  }

  /**
   * Result of the most recent completed run, or `undefined` if no run has finished
   * since this plugin was constructed. Reads while a run is in-flight, or after a
   * thrown invoke that left a run half-finished, return `undefined` rather than
   * stale data — the previous run's snapshot is dropped on the next invoke.
   */
  get lastResult(): GoalResult | undefined {
    return this._run?.result
  }

  initAgent(agent: LocalAgent): void {
    // Sharing a GoalPlugin across agents would silently judge the wrong
    // transcript (the validator closes over the first agent) or interleave
    // runs across hosts. Fail loudly.
    if (this._initialised) {
      throw new Error(`${this.name}: GoalPlugin instances cannot be shared across agents; construct one per agent`)
    }
    this._initialised = true
    this._validator = this._buildValidator(this._validate, agent)

    // Tells the next After call whether to start a fresh run or continue the
    // current one. Clears stale state from a prior invoke that threw mid-run,
    // and starts a fresh RunState so later hooks (BeforeModelCall, After) can
    // attach to it without each having to lazy-create.
    agent.addHook(BeforeInvocationEvent, () => {
      if (this._run?.resumed) {
        this._run.resumed = false
        return
      }
      this._run = { startTime: Date.now(), attempts: [] }
    })

    // On attempt 1 only, snapshot the transcript while messages = [user: input]
    // (no assistant turn yet) so retries restore to that exact state.
    if (this._freshContextPerAttempt) {
      agent.addHook(BeforeModelCallEvent, () => {
        if (this._run && !this._run.initialSnapshot) {
          this._run.initialSnapshot = agent.takeSnapshot({ include: ['messages'] })
        }
      })
    }

    // Validates the assistant's reply, terminates the run on pass / budget
    // exhausted, or arms `event.resume` with feedback for another attempt.
    agent.addHook(AfterInvocationEvent, async (event) => {
      const run = this._run
      // Defensive: BeforeInvocationEvent always creates a run before this hook
      // fires under normal operation.
      if (!run) return

      // `startTime` is wall-clock for the whole run, not per-attempt — the
      // budget caps total time including the agent invocations between
      // attempts. Checked before validation so an expensive validator
      // (e.g. a judge agent) can't blow the budget.
      if (Date.now() - run.startTime >= this._timeout) {
        finishRun(run, 'timeout')
        return
      }

      // Cancelled or model-threw before emitting an assistant message.
      const response = lastAssistantMessage(agent.messages)
      if (!response) return

      const attemptNumber = run.attempts.length + 1

      let outcome: ValidationOutcome
      try {
        outcome = await this._validator(response)
      } catch (validatorError) {
        outcome = { passed: false, feedback: `Validator error: ${(validatorError as Error).message}` }
      }

      run.attempts.push({
        attempt: attemptNumber,
        passed: outcome.passed,
        ...(outcome.feedback !== undefined && { feedback: outcome.feedback }),
      })

      if (outcome.passed) {
        finishRun(run, 'satisfied')
        return
      }
      if (attemptNumber >= this._maxAttempts) {
        finishRun(run, 'maxAttempts')
        return
      }

      if (run.initialSnapshot) {
        agent.loadSnapshot(run.initialSnapshot)
      }
      event.resume = this._resumePromptTemplate(outcome.feedback?.trim())
      run.resumed = true
    })
  }

  /**
   * Compiles the user's `validate` option into the canonical
   * `(response) => Promise<ValidationOutcome>` shape used by the After hook.
   * The string-validator path builds a fresh judge `Agent` per call so prior
   * judgements' prompts don't leak into the next judgement's context.
   */
  private _buildValidator(
    validator: Validator,
    hostAgent: LocalAgent
  ): (response: Message) => Promise<ValidationOutcome> {
    if (typeof validator === 'function') {
      return async (response) => {
        const outcome = await validator(response)
        if (typeof outcome === 'boolean') return { passed: outcome }
        return outcome
      }
    }
    const goalDescription = validator
    return async () => {
      const judge = new Agent({
        model: this._evaluatorModel ?? hostAgent.model,
        printer: false,
        systemPrompt: JUDGE_SYSTEM_PROMPT,
      })
      const judgeResult = await judge.invoke(buildJudgePrompt(goalDescription, hostAgent.messages), {
        structuredOutputSchema: JUDGE_OUTCOME_SCHEMA,
      })
      return (
        (judgeResult.structuredOutput as ValidationOutcome | undefined) ?? {
          passed: false,
          feedback: 'Judge produced no structured outcome.',
        }
      )
    }
  }
}

function finishRun(run: RunState, stopReason: GoalStopReason): void {
  run.result = {
    passed: stopReason === 'satisfied',
    stopReason,
    attempts: run.attempts.slice(),
  }
  run.resumed = false
}

function defaultResumePrompt(feedback: string | undefined): string {
  if (!feedback) {
    return 'Your previous attempt did not satisfy the goal. Refine your response and try again.'
  }
  return `Your previous attempt did not satisfy the goal.\n\nValidator feedback:\n${feedback}\n\nRefine your response and try again.`
}

/** `undefined` when the invocation was cancelled before the model replied. */
function lastAssistantMessage(messages: readonly Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') return messages[i]
  }
  return undefined
}
