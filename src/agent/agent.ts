import {
  type AgentResult,
  type AgentStreamEvent,
  BedrockModel,
  type JSONValue,
  MaxTokensError,
  Message,
  type MessageData,
  type SystemPrompt,
  TextBlock,
  type Tool,
  type ToolContext,
  ToolResultBlock,
  type ToolUseBlock,
} from '../index.js'
import type { BaseModelConfig, Model, StreamOptions } from '../models/model.js'
import { ToolRegistry } from '../registry/tool-registry.js'
import { AgentState } from './state.js'
import type { AgentData } from '../types/agent.js'

/**
 * Configuration object for creating a new Agent.
 */
export type AgentConfig = {
  /**
   * The model instance that the agent will use to make decisions.
   */
  model?: Model<BaseModelConfig>
  /**
   * An initial set of messages to seed the agent's conversation history.
   */
  messages?: Message[] | MessageData[]
  /**
   * An initial set of tools to register with the agent.
   */
  tools?: Tool[]
  /**
   * A system prompt which guides model behavior.
   */
  systemPrompt?: SystemPrompt
  /**
   * Optional initial state values for the agent.
   */
  state?: Record<string, JSONValue>
}

/**
 * Arguments for invoking an agent.
 *
 * A plain string represents user input to an agent.
 */
export type InvokeArgs = string

/**
 * Orchestrates the interaction between a model, a set of tools, and MCP clients.
 * The Agent is responsible for managing the lifecycle of tools and clients
 * and invoking the core decision-making loop.
 */
export class Agent implements AgentData {
  private _model: Model<BaseModelConfig>
  private _toolRegistry: ToolRegistry
  private _systemPrompt?: SystemPrompt

  /**
   * The conversation history of messages between user and assistant.
   */
  public readonly messages: Message[]

  /**
   * Agent state storage accessible to tools and application logic.
   * State is not passed to the model during inference.
   */
  public readonly state: AgentState

  /**
   * Creates an instance of the Agent.
   * @param config - The configuration for the agent.
   */
  constructor(config?: AgentConfig) {
    this._model = config?.model ?? new BedrockModel()
    this._toolRegistry = new ToolRegistry(config?.tools)

    if (config?.systemPrompt !== undefined) {
      this._systemPrompt = config.systemPrompt
    }

    this.messages = (config?.messages ?? []).map((msg) => (msg instanceof Message ? msg : Message.fromMessageData(msg)))

    this.state = new AgentState(config?.state)
  }

  /**
   * The tools this agent can use.
   */
  get tools(): Tool[] {
    return this._toolRegistry.values()
  }

  /**
   * The tool registry for managing the agent's tools.
   */
  get toolRegistry(): ToolRegistry {
    return this._toolRegistry
  }

  /**
   * Streams the agent execution, yielding events and returning the final result.
   *
   * The agent loop manages the conversation flow by:
   * 1. Streaming model responses and yielding all events
   * 2. Executing tools when the model requests them
   * 3. Continuing the loop until the model completes without tool use
   *
   * Use this method when you need access to intermediate streaming events.
   * For simple request/response without streaming, use invoke() instead.
   *
   * An explicit goal of this method is to always leave the message array in a way that
   * the agent can be reinvoked with a user prompt after this method completes. To that end
   * assistant messages containing tool uses are only added after tool execution succeeds
   * with valid toolResponses
   *
   * @param args - Arguments for invoking the agent
   * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
   *
   * @example
   * ```typescript
   * const agent = new Agent({ model, tools })
   *
   * for await (const event of agent.stream('Hello')) {
   *   console.log('Event:', event.type)
   * }
   * // Messages array is mutated in place and contains the full conversation
   * ```
   */
  public async *stream(args: InvokeArgs): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    let currentArgs: InvokeArgs | undefined = args

    // Emit event before the loop starts
    yield { type: 'beforeInvocationEvent' }

    try {
      // Main agent loop - continues until model stops without requesting tools
      while (true) {
        const modelResult = yield* this.invokeModel(currentArgs)
        currentArgs = undefined // Only pass args on first invocation

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
          this.messages.push(modelResult.message)
          return {
            stopReason: modelResult.stopReason,
            lastMessage: modelResult.message,
          }
        }

        // Execute tools sequentially
        const toolResultMessage = yield* this.executeTools(modelResult.message, this._toolRegistry)

        // Add assistant message with tool uses right before adding tool results
        // This ensures we don't have dangling tool use messages if tool execution fails
        this.messages.push(modelResult.message)
        this.messages.push(toolResultMessage)

        // Continue loop
      }
    } finally {
      // Always emit final event
      yield { type: 'afterInvocationEvent' }
    }
  }

  /**
   * Invokes the agent and returns the final result.
   *
   * This is a convenience method that consumes the stream() method and returns
   * only the final AgentResult. Use stream() if you need access to intermediate
   * streaming events.
   *
   * @param args - Arguments for invoking the agent
   * @returns Promise that resolves to the final AgentResult
   *
   * @example
   * ```typescript
   * const agent = new Agent({ model, tools })
   * const result = await agent.invoke('What is 2 + 2?')
   * console.log(result.lastMessage) // Agent's response
   * ```
   */
  public async invoke(args: InvokeArgs): Promise<AgentResult> {
    const gen = this.stream(args)
    let result = await gen.next()
    while (!result.done) {
      result = await gen.next()
    }
    return result.value
  }

  /**
   * Invokes the model provider and streams all events.
   *
   * @param args - Optional arguments for invoking the model
   * @returns Object containing the assistant message and stop reason
   */
  private async *invokeModel(
    args?: InvokeArgs
  ): AsyncGenerator<AgentStreamEvent, { message: Message; stopReason: string }, undefined> {
    // Emit event before invoking model
    yield { type: 'beforeModelEvent', messages: [...this.messages] }

    const toolSpecs = this._toolRegistry.values().map((tool) => tool.toolSpec)
    const streamOptions: StreamOptions = { toolSpecs }
    if (this._systemPrompt !== undefined) {
      streamOptions.systemPrompt = this._systemPrompt
    }

    if (args !== undefined && typeof args === 'string') {
      // Add user message from args
      this.messages.push(
        new Message({
          role: 'user',
          content: [{ type: 'textBlock', text: args }],
        })
      )
    }

    const { message, stopReason } = yield* this._model.streamAggregated(this.messages, streamOptions)

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
  private async *executeTools(
    assistantMessage: Message,
    toolRegistry: ToolRegistry
  ): AsyncGenerator<AgentStreamEvent, Message, undefined> {
    yield { type: 'beforeToolsEvent', message: assistantMessage }

    // Extract tool use blocks from assistant message
    const toolUseBlocks = assistantMessage.content.filter(
      (block): block is ToolUseBlock => block.type === 'toolUseBlock'
    )

    if (toolUseBlocks.length === 0) {
      // No tool use blocks found even though stopReason is toolUse
      throw new Error('Model indicated toolUse but no tool use blocks found in message')
    }

    const toolResultBlocks: ToolResultBlock[] = []

    for (const toolUseBlock of toolUseBlocks) {
      const toolResultBlock = yield* this.executeTool(toolUseBlock, toolRegistry)
      toolResultBlocks.push(toolResultBlock)

      // Yield the tool result block as it's created
      yield toolResultBlock as AgentStreamEvent
    }

    // Create user message with tool results
    const toolResultMessage: Message = new Message({
      role: 'user',
      content: toolResultBlocks,
    })

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
  private async *executeTool(
    toolUseBlock: ToolUseBlock,
    toolRegistry: ToolRegistry
  ): AsyncGenerator<AgentStreamEvent, ToolResultBlock, undefined> {
    const tool = toolRegistry.find((t) => t.name === toolUseBlock.name)

    if (!tool) {
      // Tool not found - return error result instead of throwing
      return new ToolResultBlock({
        toolUseId: toolUseBlock.toolUseId,
        status: 'error',
        content: [new TextBlock(`Tool '${toolUseBlock.name}' not found in registry`)],
      })
    }

    // Execute tool and collect result
    const toolContext: ToolContext = {
      toolUse: {
        name: toolUseBlock.name,
        toolUseId: toolUseBlock.toolUseId,
        input: toolUseBlock.input,
      },
      agent: this,
    }

    const toolGenerator = tool.stream(toolContext)

    // Use yield* to delegate to the tool generator and capture the return value
    const toolResult = yield* toolGenerator

    if (!toolResult) {
      // Tool didn't return a result - return error result instead of throwing
      return new ToolResultBlock({
        toolUseId: toolUseBlock.toolUseId,
        status: 'error',
        content: [new TextBlock(`Tool '${toolUseBlock.name}' did not return a result`)],
      })
    }

    // Tool already returns ToolResultBlock directly
    return toolResult
  }
}
