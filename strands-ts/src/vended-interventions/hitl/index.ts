/**
 * Human-in-the-loop intervention for Strands Agents.
 *
 * Pauses agent execution before tool calls to request human approval.
 * Defaults to prompting in the terminal (CLI), but supports custom UIs
 * and stateless interrupt/resume for API deployments.
 *
 * @example
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { HumanInTheLoop } from '@strands-agents/sdk/vended-interventions/hitl'
 *
 * const agent = new Agent({
 *   tools: [deleteTool, readTool],
 *   interventions: [new HumanInTheLoop({ allowedTools: ['readTool'] })],
 * })
 *
 * // Agent automatically prompts in terminal when it tries to use deleteTool
 * await agent.invoke('Delete the file')
 * ```
 */

export { HumanInTheLoop } from './hitl.js'
export type { HumanInTheLoopConfig } from './hitl.js'
