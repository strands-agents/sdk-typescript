import type { Message, SystemPrompt, ToolResultBlock, ToolUseBlock } from '../types/messages.js'
import type { BaseModelConfig, Model, StreamOptions } from '../models/model.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { AgentStreamEvent } from './streaming.js'
import { MaxTokensError } from '../errors.js'
import type { AgentResult } from '../types/agent.js'

/**
 * Internal configuration for the agent loop.
 * @internal
 */
interface AgentLike {
  /**
   * Model provider instance for generating responses.
   */
  model: Model<BaseModelConfig>

  /**
   * Array of conversation messages (will be mutated as the loop progresses).
   */
  messages: Message[]

  /**
   * Registry containing available tools.
   */
  toolRegistry: ToolRegistry

  /**
   * Optional system prompt to guide model behavior.
   */
  systemPrompt?: SystemPrompt
}

/**
 * Async generator that coordinates execution between model providers and tools.
 *
 * The agent loop manages the conversation flow by:
 * 1. Streaming model responses and yielding all events
 * 2. Executing tools when the model requests them
 * 3. Continuing the loop until the model completes without tool use
 *
 * An explicit goal of this method is to always leave the message array in a way that
 * the agent can be reinvoked with a user prompt after this method completes. To that end
 * assistant messages containing tool uses are only added after tool execution succeeds
 * with valid toolResponses
 *
 * @param agent - Configuration including model, messages, toolRegistry, and systemPrompt
 * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
 *
 * @example
 * ```typescript
 * const messages = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
 * const registry = new ToolRegistry()
 * const provider = new BedrockModel(config)
 *
 * for await (const event of runAgentLoop({ model: provider, messages, toolRegistry: registry })) {
 *   console.log('Event:', event.type)
 * }
 * // Messages array is mutated in place and contains the full conversation
 * ```
 */
export async function* runAgentLoop(agent: AgentLike): AsyncGenerator<AgentStreamEvent, AgentResult, never> {
  // Emit event before the loop starts
  yield { type: 'beforeInvocationEvent' }

  try {
    // Main agent loop - continues until model stops without requesting tools
    while (true) {
      const modelResult = yield* invokeModel(agent)

      // Handle stop reason
      if (modelResult.stopReason === 'maxTokens') {
        throw new MaxTokensError(
          'Model reached maximum token limit. This is an unrecoverable state that requires intervention.',
          modelResult.message
        )
      }

      if (modelResult.stopReason !== 'toolUse') {
        // Loop terminates - no tool use requested
        // Add assistant message now that we're returning
        agent.messages.push(modelResult.message)
        return {
          stopReason: modelResult.stopReason,
          lastMessage: modelResult.message,
        }
      }

      // Execute tools sequentially
      const toolResultMessage = yield* executeTools(modelResult.message, agent.toolRegistry)

      // Add assistant message with tool uses right before adding tool results
      // This ensures we don't have dangling tool use messages if tool execution fails
      agent.messages.push(modelResult.message)
      agent.messages.push(toolResultMessage)

      // Continue loop
    }
  } finally {
    // Always emit final event
    yield { type: 'afterInvocationEvent' }
  }
}

/**
 * Invokes the model provider and streams all events.
 *
 * @param agent - Agent configuration containing model, messages, toolRegistry, and systemPrompt
 * @returns Object containing the assistant message and stop reason
 */
async function* invokeModel(
  agent: AgentLike
): AsyncGenerator<AgentStreamEvent, { message: Message; stopReason: string }, never> {
  // Emit event before invoking model
  yield { type: 'beforeModelEvent', messages: [...agent.messages] }

  const toolSpecs = agent.toolRegistry.list().map((tool) => tool.toolSpec)
  const streamOptions: StreamOptions = { toolSpecs }
  if (agent.systemPrompt !== undefined) {
    streamOptions.systemPrompt = agent.systemPrompt
  }

  const { message, stopReason } = yield* agent.model.streamAggregated(agent.messages, streamOptions)

  yield { type: 'afterModelEvent', message, stopReason }

  return { message, stopReason }
}

/**
 * Executes tools sequentially and streams all tool events.
 *
 * @param assistantMessage - The assistant message containing tool use blocks
 * @param toolRegistry - Registry containing available tools
 * @returns User message containing tool results
 */
async function* executeTools(
  assistantMessage: Message,
  toolRegistry: ToolRegistry
): AsyncGenerator<AgentStreamEvent, Message, never> {
  yield { type: 'beforeToolsEvent', message: assistantMessage }

  // Extract tool use blocks from assistant message
  const toolUseBlocks = assistantMessage.content.filter((block): block is ToolUseBlock => block.type === 'toolUseBlock')

  if (toolUseBlocks.length === 0) {
    // No tool use blocks found even though stopReason is toolUse
    throw new Error('Model indicated toolUse but no tool use blocks found in message')
  }

  const toolResultBlocks: ToolResultBlock[] = []

  for (const toolUseBlock of toolUseBlocks) {
    const toolResultBlock = yield* executeTool(toolUseBlock, toolRegistry)
    toolResultBlocks.push(toolResultBlock)

    // Yield the tool result block as it's created
    yield toolResultBlock as AgentStreamEvent
  }

  // Create user message with tool results
  const toolResultMessage: Message = {
    type: 'message',
    role: 'user',
    content: toolResultBlocks,
  }

  yield { type: 'afterToolsEvent', message: toolResultMessage }

  return toolResultMessage
}

/**
 * Executes a single tool and returns the result.
 * If the tool is not found or fails to return a result, returns an error ToolResult
 * instead of throwing an exception. This allows the agent loop to continue and
 * let the model handle the error gracefully.
 *
 * @param toolUseBlock - Tool use block to execute
 * @param toolRegistry - Registry containing available tools
 * @returns Tool result block
 */
async function* executeTool(
  toolUseBlock: ToolUseBlock,
  toolRegistry: ToolRegistry
): AsyncGenerator<AgentStreamEvent, ToolResultBlock, never> {
  const tool = toolRegistry.get(toolUseBlock.name)

  if (!tool) {
    // Tool not found - return error result instead of throwing
    return {
      type: 'toolResultBlock',
      toolUseId: toolUseBlock.toolUseId,
      status: 'error',
      content: [
        {
          type: 'toolResultTextContent',
          text: `Tool '${toolUseBlock.name}' not found in registry`,
        },
      ],
    }
  }

  // Execute tool and collect result
  const toolContext = {
    toolUse: {
      name: toolUseBlock.name,
      toolUseId: toolUseBlock.toolUseId,
      input: toolUseBlock.input,
    },
    invocationState: {},
  }

  const toolGenerator = tool.stream(toolContext)

  // Use yield* to delegate to the tool generator and capture the return value
  const toolResult = yield* toolGenerator

  if (!toolResult) {
    // Tool didn't return a result - return error result instead of throwing
    return {
      type: 'toolResultBlock',
      toolUseId: toolUseBlock.toolUseId,
      status: 'error',
      content: [
        {
          type: 'toolResultTextContent',
          text: `Tool '${toolUseBlock.name}' did not return a result`,
        },
      ],
    }
  }

  // Create ToolResultBlock from ToolResult
  return {
    type: 'toolResultBlock',
    toolUseId: toolResult.toolUseId,
    status: toolResult.status,
    content: toolResult.content,
  }
}
