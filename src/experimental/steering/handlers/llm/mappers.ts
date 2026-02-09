/**
 * LLM steering prompt mappers for generating evaluation prompts.
 *
 * @experimental This API is experimental and may change in future releases.
 */

import type { JSONValue } from '../../../../types/json.js'
import type { SteeringContext } from '../../core/context.js'

/**
 * Tool use data for prompt generation.
 */
interface ToolUseData {
  name: string
  input: JSONValue
}

/**
 * Protocol for mapping context and events to LLM evaluation prompts.
 *
 * Implement this interface to customize how steering prompts are generated
 * from context data and tool use events.
 *
 * @experimental This API is experimental and may change in future releases.
 */
export interface LLMPromptMapper {
  /**
   * Creates a steering prompt for LLM evaluation.
   *
   * @param steeringContext - Steering context with populated data
   * @param toolUse - Tool use object for tool call events (undefined for other events)
   * @returns Formatted prompt string for LLM evaluation
   */
  createSteeringPrompt(steeringContext: SteeringContext, toolUse?: ToolUseData): string
}

// Agent SOP format - see https://github.com/strands-agents/agent-sop
const STEERING_PROMPT_TEMPLATE = `# Steering Evaluation

## Overview

You are a STEERING AGENT that evaluates a {action_type} that ANOTHER AGENT is attempting to make.
Your job is to provide contextual guidance to help the other agent navigate workflows effectively.
You act as a safety net that can intervene when patterns in the context data suggest the agent
should try a different approach or get human input.

**YOUR ROLE:**
- Analyze context data for concerning patterns (repeated failures, inappropriate timing, etc.)
- Provide just-in-time guidance when the agent is going down an ineffective path
- Allow normal operations to proceed when context shows no issues

**CRITICAL CONSTRAINTS:**
- Base decisions ONLY on the context data provided below
- Do NOT use external knowledge about domains, URLs, or tool purposes
- Do NOT make assumptions about what tools "should" or "shouldn't" do
- Focus ONLY on patterns in the context data

## Context

{context_str}

### Understanding Ledger Tool States

If the context includes a ledger with tool_calls, the "status" field indicates:

- **"pending"**: The tool is CURRENTLY being evaluated by you (the steering agent).
This is NOT a duplicate call - it's the tool you're deciding whether to approve.
The tool has NOT started executing yet.
- **"success"**: The tool completed successfully in a previous turn
- **"error"**: The tool failed or was cancelled in a previous turn

**IMPORTANT**: When you see a tool with status="pending" that matches the tool you're evaluating,
that IS the current tool being evaluated.
It is NOT already executing or a duplicate.

## Event to Evaluate

{event_description}

## Steps

### 1. Analyze the {action_type_title}

Review ONLY the context data above. Look for patterns in the data that indicate:

- Previous failures or successes with this tool
- Frequency of attempts
- Any relevant tracking information

**Constraints:**
- You MUST base analysis ONLY on the provided context data
- You MUST NOT use external knowledge about tool purposes or domains
- You SHOULD identify patterns in the context data
- You MAY reference relevant context data to inform your decision

### 2. Make Steering Decision

**Constraints:**
- You MUST respond with exactly one of: "proceed", "guide", or "interrupt"
- You MUST base the decision ONLY on context data patterns
- Your reason will be shown to the AGENT as guidance

**Decision Options:**
- "proceed" if context data shows no concerning patterns
- "guide" if context data shows patterns requiring intervention
- "interrupt" if context data shows patterns requiring human input
`

/**
 * Default prompt mapper for steering evaluation using Agent SOP format.
 *
 * @experimental This API is experimental and may change in future releases.
 */
export class DefaultPromptMapper implements LLMPromptMapper {
  /**
   * Creates a steering prompt using the Agent SOP structure.
   *
   * @param steeringContext - Steering context with populated data
   * @param toolUse - Tool use object for tool call events
   * @returns Formatted prompt string for LLM evaluation
   */
  createSteeringPrompt(steeringContext: SteeringContext, toolUse?: ToolUseData): string {
    const allData = steeringContext.getAll()
    const contextStr = Object.keys(allData).length > 0 ? JSON.stringify(allData, null, 2) : 'No context available'

    let eventDescription: string
    let actionType: string

    if (toolUse !== undefined) {
      eventDescription = `Tool: ${toolUse.name}\nArguments: ${JSON.stringify(toolUse.input, null, 2)}`
      actionType = 'tool call'
    } else {
      eventDescription = 'General evaluation'
      actionType = 'action'
    }

    const actionTypeTitle = actionType
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')

    return STEERING_PROMPT_TEMPLATE.replace(/{action_type}/g, actionType)
      .replace(/{action_type_title}/g, actionTypeTitle)
      .replace(/{context_str}/g, contextStr)
      .replace(/{event_description}/g, eventDescription)
  }
}
