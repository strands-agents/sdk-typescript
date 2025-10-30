import type { Message, SystemPrompt, ToolUseBlock, ToolResultBlock } from '../types/messages'
import type { Model, BaseModelConfig, StreamOptions } from '../models/model'
import type { ToolRegistry } from '../tools/registry'
import type { AgentStreamEvent } from './streaming'
import type { ToolResult } from '../tools/types'
import { MaxTokensError } from '../errors'

/**
 * Options for configuring the agent loop.
 */
export interface AgentLoopOptions {
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
 * This implements a transactional message handling pattern where messages are only
 * added to the array after the model provider returns its first event. This ensures
 * that if the model provider throws an error before yielding any events, the messages
 * array remains unchanged.
 *
 * @param modelProvider - Model provider instance for generating responses
 * @param options - Configuration options including messages, toolRegistry, and systemPrompt
 * @returns Async generator that yields AgentStreamEvent objects and returns the final messages array
 *
 * @example
 * ```typescript
 * const messages = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
 * const registry = new ToolRegistry()
 * const provider = new BedrockModel(config)
 *
 * for await (const event of agent_loop(provider, { messages, toolRegistry: registry })) {
 *   console.log('Event:', event.type)
 * }
 * // Returns final messages array
 * ```
 */
export async function* agent_loop(
  modelProvider: Model<BaseModelConfig>,
  options: AgentLoopOptions
): AsyncGenerator<AgentStreamEvent, Message[], never> {
  const { messages, toolRegistry, systemPrompt } = options

  // Emit event before the loop starts
  yield { type: 'beforeInvocationEvent' }

  try {
    // Main agent loop - continues until model stops without requesting tools
    while (true) {
      // Invoke model provider
      yield { type: 'beforeModelEvent', messages: [...messages] }

      const modelResult = yield* invokeModel(modelProvider, messages, toolRegistry, systemPrompt)

      // Add assistant message to messages array
      messages.push(modelResult.message)

      // Handle stop reason
      if (modelResult.stopReason === 'maxTokens') {
        throw new MaxTokensError(
          'Model reached maximum token limit. This is an unrecoverable state that requires intervention.',
          modelResult.message
        )
      }

      if (modelResult.stopReason !== 'toolUse') {
        // Loop terminates - no tool use requested
        return messages
      }

      // Extract tool use blocks from assistant message
      const toolUseBlocks = modelResult.message.content.filter(
        (block): block is ToolUseBlock => block.type === 'toolUseBlock'
      )

      if (toolUseBlocks.length === 0) {
        // No tool use blocks found even though stopReason is toolUse
        // Treat this as a normal completion
        return messages
      }

      // Execute tools sequentially
      const toolResultMessage = yield* executeTools(modelResult.message, toolUseBlocks, toolRegistry)

      messages.push(toolResultMessage)

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
 * @param modelProvider - Model provider instance
 * @param messages - Current conversation messages
 * @param toolRegistry - Registry containing available tools
 * @param systemPrompt - Optional system prompt
 * @returns Object containing the assistant message and stop reason
 */
async function* invokeModel(
  modelProvider: Model<BaseModelConfig>,
  messages: Message[],
  toolRegistry: ToolRegistry,
  systemPrompt: SystemPrompt | undefined
): AsyncGenerator<AgentStreamEvent, { message: Message; stopReason: string | undefined }, never> {
  const toolSpecs = toolRegistry.list().map((tool) => tool.toolSpec)
  const options: StreamOptions = { toolSpecs }
  if (systemPrompt !== undefined) {
    options.systemPrompt = systemPrompt
  }

  const streamAggregated = modelProvider.streamAggregated(messages, options)

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
      if ('type' in value && value.type === 'modelMessageStopEvent') {
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
 * @param toolUseBlocks - Tool use blocks to execute
 * @param toolRegistry - Registry containing available tools
 * @returns User message containing tool results
 */
async function* executeTools(
  assistantMessage: Message,
  toolUseBlocks: ToolUseBlock[],
  toolRegistry: ToolRegistry
): AsyncGenerator<AgentStreamEvent, Message, never> {
  yield { type: 'beforeToolsEvent', message: assistantMessage }

  const toolResultBlocks: ToolResultBlock[] = []

  for (const toolUseBlock of toolUseBlocks) {
    const tool = toolRegistry.get(toolUseBlock.name)

    if (!tool) {
      throw new Error(`Tool '${toolUseBlock.name}' not found in registry`)
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

    let toolResult: ToolResult | null = null
    let done = false

    // Manually iterate to capture both yields and return value
    // Note: Cannot use yield* here because we need to capture the return value
    // and also yield the ToolResultBlock separately after construction
    while (!done) {
      const { value, done: isDone } = await toolGenerator.next()
      done = isDone ?? false

      if (!done) {
        // This is a yielded ToolStreamEvent
        yield value as AgentStreamEvent
      } else {
        // This is the returned ToolResult
        toolResult = value as ToolResult
      }
    }

    if (!toolResult) {
      throw new Error(`Tool '${toolUseBlock.name}' did not return a result`)
    }

    // Create ToolResultBlock from ToolResult
    const toolResultBlock: ToolResultBlock = {
      type: 'toolResultBlock',
      toolUseId: toolResult.toolUseId,
      status: toolResult.status,
      content: toolResult.content,
    }

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
