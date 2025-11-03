import type { Message, SystemPrompt, ToolUseBlock, ToolResultBlock } from '../types/messages'
import type { Model, BaseModelConfig, StreamOptions } from '../models/model'
import type { ToolRegistry } from '../tools/registry'
import type { AgentStreamEvent } from './streaming'
import { MaxTokensError } from '../errors'

/**
 * Internal configuration for the agent loop.
 * @internal
 */
interface AgentLike {
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
 * Result returned by the agent loop.
 */
export interface AgentResult {
  /**
   * The stop reason from the final model response.
   */
  stopReason: string | undefined

  /**
   * The last message added to the messages array.
   */
  lastMessage: Message
}

/**
 * Async generator that coordinates execution between model providers and tools.
 *
 * The agent loop manages the conversation flow by:
 * 1. Streaming model responses and yielding all events
 * 2. Executing tools when the model requests them
 * 3. Continuing the loop until the model completes without tool use
 *
 * This implements a transactional message handling pattern where messages are only
 * added to the array after the model provider returns its first event. This ensures
 * that if the model provider throws an error before yielding any events, the messages
 * array remains unchanged.
 *
 * Additionally, assistant messages containing tool uses are only committed to the messages
 * array when we're certain we can complete tool execution or are returning. This prevents
 * dangling tool use messages if an error occurs during tool execution.
 *
 * The messages array passed in agent is mutated in place, so callers can access the
 * updated messages directly from the original array after the loop completes.
 *
 * @param model - Model provider instance for generating responses
 * @param agent - Configuration including messages, toolRegistry, and systemPrompt
 * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
 *
 * @example
 * ```typescript
 * const messages = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
 * const registry = new ToolRegistry()
 * const provider = new BedrockModel(config)
 *
 * for await (const event of runAgentLoop(provider, { messages, toolRegistry: registry })) {
 *   console.log('Event:', event.type)
 * }
 * // Messages array is mutated in place and contains the full conversation
 * ```
 */
export async function* runAgentLoop(
  model: Model<BaseModelConfig>,
  agent: AgentLike
): AsyncGenerator<AgentStreamEvent, AgentResult, never> {
  // Emit event before the loop starts
  yield { type: 'beforeInvocationEvent' }

  try {
    // Main agent loop - continues until model stops without requesting tools
    while (true) {
      const modelResult = yield* invokeModel(model, agent)

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
 * @param model - Model provider instance
 * @param agent - Agent configuration containing messages, toolRegistry, and systemPrompt
 * @returns Object containing the assistant message and stop reason
 */
async function* invokeModel(
  model: Model<BaseModelConfig>,
  agent: AgentLike
): AsyncGenerator<AgentStreamEvent, { message: Message; stopReason: string | undefined }, never> {
  // Emit event before invoking model
  yield { type: 'beforeModelEvent', messages: [...agent.messages] }

  const toolSpecs = agent.toolRegistry.list().map((tool) => tool.toolSpec)
  const streamOptions: StreamOptions = { toolSpecs }
  if (agent.systemPrompt !== undefined) {
    streamOptions.systemPrompt = agent.systemPrompt
  }

  const streamAggregated = model.streamAggregated(agent.messages, streamOptions)

  let assistantMessage: Message | null = null
  let stopReason: string | undefined

  // Stream model events and collect the assistant message
  // We need to manually iterate to capture both yields and the return value
  let done = false
  while (!done) {
    const { value, done: isDone } = await streamAggregated.next()
    done = isDone ?? false

    if (!done) {
      // Yield all events (ModelStreamEvent or ContentBlock)
      yield value as AgentStreamEvent

      // Capture stop reason from modelMessageStopEvent
      if (value.type === 'modelMessageStopEvent') {
        stopReason = value.stopReason
      }
    } else {
      // This is the returned Message
      assistantMessage = value as Message
    }
  }

  if (!assistantMessage) {
    throw new Error('Model stream ended without returning a message')
  }

  yield { type: 'afterModelEvent', message: assistantMessage }

  return { message: assistantMessage, stopReason }
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
    const errorResult: ToolResultBlock = {
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
    return errorResult
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
    const errorResult: ToolResultBlock = {
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
    return errorResult
  }

  // Create ToolResultBlock from ToolResult
  const toolResultBlock: ToolResultBlock = {
    type: 'toolResultBlock',
    toolUseId: toolResult.toolUseId,
    status: toolResult.status,
    content: toolResult.content,
  }

  return toolResultBlock
}
