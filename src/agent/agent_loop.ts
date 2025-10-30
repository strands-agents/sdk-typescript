import type { Message, SystemPrompt, ToolUseBlock, ToolResultBlock } from '../types/messages'
import type { Model, BaseModelConfig } from '../models/model'
import type { ToolRegistry } from '../tools/registry'
import type { AgentStreamEvent } from './streaming'
import type { ToolResult } from '../tools/types'
import { MaxTokensError } from '../errors'

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
 * @param messages - Array of conversation messages (will be mutated as the loop progresses)
 * @param toolRegistry - Registry containing available tools
 * @param systemPrompt - Optional system prompt to guide model behavior
 * @param modelProvider - Model provider instance for generating responses
 * @returns Async generator that yields AgentStreamEvent objects and returns the final messages array
 *
 * @example
 * ```typescript
 * const messages = [{ type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello' }] }]
 * const registry = new ToolRegistry()
 * const provider = new BedrockModel(config)
 *
 * for await (const event of agent_loop(messages, registry, undefined, provider)) {
 *   console.log('Event:', event.type)
 * }
 * // Returns final messages array
 * ```
 */
export async function* agent_loop(
  messages: Message[],
  toolRegistry: ToolRegistry,
  systemPrompt: SystemPrompt | undefined,
  modelProvider: Model<BaseModelConfig>
): AsyncGenerator<AgentStreamEvent, Message[], never> {
  let iteration = 0

  // Main agent loop - continues until model stops without requesting tools
  while (true) {
    yield { type: 'beforeInvocationEvent', iteration }

    // Invoke model provider
    yield { type: 'beforeModelEvent', messages: [...messages] }

    const toolSpecs = toolRegistry.list().map((tool) => tool.toolSpec)
    const options = systemPrompt !== undefined ? { systemPrompt, toolSpecs } : { toolSpecs }
    const streamAggregated = modelProvider.streamAggregated(messages, options)

    let firstEventReceived = false
    let assistantMessage: Message | null = null
    let stopReason: string | undefined

    // Stream model events and collect the assistant message
    // We need to manually iterate to capture both yields and the return value
    let done = false
    while (!done) {
      const { value, done: isDone } = await streamAggregated.next()
      done = isDone ?? false

      if (!done) {
        // Mark that we received first event (for transactional handling)
        if (!firstEventReceived) {
          firstEventReceived = true
        }

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

    // Add assistant message to messages array
    messages.push(assistantMessage)

    yield { type: 'afterModelEvent', message: assistantMessage }

    // Handle stop reason
    if (stopReason === 'maxTokens') {
      throw new MaxTokensError(
        'Model reached maximum token limit. This is an unrecoverable state that requires intervention.'
      )
    }

    if (stopReason !== 'toolUse') {
      // Loop terminates - no tool use requested
      yield { type: 'afterInvocationEvent', iteration }
      return messages
    }

    // Extract tool use blocks from assistant message
    const toolUseBlocks = assistantMessage.content.filter(
      (block): block is ToolUseBlock => block.type === 'toolUseBlock'
    )

    if (toolUseBlocks.length === 0) {
      // No tool use blocks found even though stopReason is toolUse
      // Treat this as a normal completion
      yield { type: 'afterInvocationEvent', iteration }
      return messages
    }

    // Execute tools sequentially
    yield { type: 'beforeToolsEvent', toolUseBlocks }

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
    }

    yield { type: 'afterToolsEvent', toolResultBlocks }

    // Create user message with tool results
    const toolResultMessage: Message = {
      type: 'message',
      role: 'user',
      content: toolResultBlocks,
    }

    messages.push(toolResultMessage)

    // Continue loop
    yield { type: 'afterInvocationEvent', iteration }
    iteration++
  }
}
