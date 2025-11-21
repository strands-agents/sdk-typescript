import {
  type AgentResult,
  type AgentStreamEvent,
  BedrockModel,
  type JSONValue,
  McpClient,
  Message,
  type MessageData,
  type SystemPrompt,
  TextBlock,
  type Tool,
  type ToolContext,
  ToolResultBlock,
  type ToolUseBlock,
} from '../index.js'
import { normalizeError, ConcurrentInvocationError, MaxTokensError } from '../errors.js'
import type { BaseModelConfig, Model, StreamOptions } from '../models/model.js'
import { ToolRegistry } from '../registry/tool-registry.js'
import { AgentState } from './state.js'
import type { AgentData } from '../types/agent.js'
import { AgentPrinter, getDefaultAppender, type Printer } from './printer.js'
import type { HookProvider } from '../hooks/types.js'
import { SlidingWindowConversationManager } from '../conversation-manager/sliding-window-conversation-manager.js'
import { HookRegistryImplementation } from '../hooks/registry.js'
import {
  AfterInvocationEvent,
  AfterModelCallEvent,
  AfterToolCallEvent,
  BeforeInvocationEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
  MessageAddedEvent,
  ModelStreamEventHook,
} from '../hooks/events.js'

/**
 * Recursive type definition for nested tool arrays.
 * Allows tools to be organized in nested arrays of any depth.
 */
export type ToolList = (Tool | McpClient | ToolList)[]

/**
 * Configuration object for creating a new Agent.
 */
export type AgentConfig = {
  /** The model instance that the agent will use to make decisions. */
  model?: Model<BaseModelConfig>
  /** An initial set of messages to seed the agent's conversation history. */
  messages?: Message[] | MessageData[]
  /**
   * An initial set of tools to register with the agent.
   * Accepts nested arrays of tools at any depth, which will be flattened automatically.
   */
  tools?: ToolList
  /**
   * A system prompt which guides model behavior.
   */
  systemPrompt?: SystemPrompt
  /** Optional initial state values for the agent. */
  state?: Record<string, JSONValue>
  /**
   * Enable automatic printing of agent output to console.
   * When true, prints text generation, reasoning, and tool usage as they occur.
   * Defaults to true.
   */
  printer?: boolean
  /**
   * Conversation manager for handling message history and context overflow.
   * Defaults to SlidingWindowConversationManager with windowSize of 40.
   */
  conversationManager?: HookProvider
  /**
   * Hook providers to register with the agent.
   * Hooks enable observing and extending agent behavior.
   */
  hooks?: HookProvider[]
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
   * Conversation manager for handling message history and context overflow.
   */
  public readonly conversationManager: HookProvider
  /**
   * Hook registry for managing event callbacks.
   * Hooks enable observing and extending agent behavior.
   */
  public readonly hooks: HookRegistryImplementation

  private _model: Model<BaseModelConfig>
  private _toolRegistry: ToolRegistry
  private _mcpClients: McpClient[]
  private _systemPrompt?: SystemPrompt
  private _initialized: boolean
  private _isInvoking: boolean = false
  private _printer?: Printer

  /**
   * Creates an instance of the Agent.
   * @param config - The configuration for the agent.
   */
  constructor(config?: AgentConfig) {
    // Initialize public fields
    this.messages = (config?.messages ?? []).map((msg) => (msg instanceof Message ? msg : Message.fromMessageData(msg)))
    this.state = new AgentState(config?.state)
    this.conversationManager = config?.conversationManager ?? new SlidingWindowConversationManager({ windowSize: 40 })

    // Initialize hooks and register conversation manager hooks
    this.hooks = new HookRegistryImplementation()
    this.hooks.addHook(this.conversationManager)
    this.hooks.addAllHooks(config?.hooks ?? [])

    this._model = config?.model ?? new BedrockModel()
    const { tools, mcpClients } = flattenTools(config?.tools ?? [])
    this._toolRegistry = new ToolRegistry(tools)
    this._mcpClients = mcpClients

    if (config?.systemPrompt !== undefined) {
      this._systemPrompt = config.systemPrompt
    }

    // Create printer if printer is enabled (default: true)
    const printer = config?.printer ?? true
    if (printer) {
      this._printer = new AgentPrinter(getDefaultAppender())
    }

    this._initialized = false
  }

  public async initialize(): Promise<void> {
    if (this._initialized) {
      return
    }

    await Promise.all(
      this._mcpClients.map(async (client) => {
        const tools = await client.listTools()
        this._toolRegistry.addAll(tools)
      })
    )

    this._initialized = true
  }

  /**
   * Acquires a lock to prevent concurrent invocations.
   * Returns a Disposable that releases the lock when disposed.
   */
  private acquireLock(): { [Symbol.dispose]: () => void } {
    if (this._isInvoking) {
      throw new ConcurrentInvocationError(
        'Agent is already processing an invocation. Wait for the current invoke() or stream() call to complete before invoking again.'
      )
    }
    this._isInvoking = true

    return {
      [Symbol.dispose]: (): void => {
        this._isInvoking = false
      },
    }
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
    using _lock = this.acquireLock()

    await this.initialize()

    // Delegate to _stream and process events through printer
    const streamGenerator = this._stream(args)
    let result = await streamGenerator.next()

    while (!result.done) {
      const event = result.value
      this._printer?.processEvent(event)
      yield event
      result = await streamGenerator.next()
    }

    return result.value
  }

  /**
   * Internal implementation of the agent streaming logic.
   * Separated to centralize printer event processing in the public stream method.
   *
   * @param args - Arguments for invoking the agent
   * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
   */
  private async *_stream(args: InvokeArgs): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    let currentArgs: InvokeArgs | undefined = args

    // Invoke BeforeInvocationEvent hook
    await this.hooks.invokeCallbacks(new BeforeInvocationEvent({ agent: this }))

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
          await this._appendMessage(modelResult.message)
          return {
            stopReason: modelResult.stopReason,
            lastMessage: modelResult.message,
          }
        }

        // Execute tools sequentially
        const toolResultMessage = yield* this.executeTools(modelResult.message, this._toolRegistry)

        // Add assistant message with tool uses right before adding tool results
        // This ensures we don't have dangling tool use messages if tool execution fails
        await this._appendMessage(modelResult.message)
        await this._appendMessage(toolResultMessage)

        // Continue loop
      }
    } finally {
      // Invoke AfterInvocationEvent hook
      await this.hooks.invokeCallbacks(new AfterInvocationEvent({ agent: this }))

      // Always emit final event
      yield { type: 'afterInvocationEvent' }
    }
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
      await this._appendMessage(
        new Message({
          role: 'user',
          content: [{ type: 'textBlock', text: args }],
        })
      )
    }

    await this.hooks.invokeCallbacks(new BeforeModelCallEvent({ agent: this }))

    try {
      const { message, stopReason } = yield* this._streamFromModel(this.messages, streamOptions)

      // Invoke AfterModelCallEvent hook on success
      await this.hooks.invokeCallbacks(new AfterModelCallEvent({ agent: this, stopData: { message, stopReason } }))

      yield { type: 'afterModelEvent', message, stopReason }

      return { message, stopReason }
    } catch (error) {
      const modelError = normalizeError(error)

      // Invoke AfterModelCallEvent hook even on error
      const event = await this.hooks.invokeCallbacks(new AfterModelCallEvent({ agent: this, error: modelError }))

      // Check if hooks request a retry (e.g., after reducing context)
      if (event.retryModelCall) {
        return yield* this.invokeModel(args)
      }

      // Re-throw error
      throw error
    }
  }

  /**
   * Streams events from the model and fires ModelStreamEventHook for each event.
   *
   * @param messages - Messages to send to the model
   * @param streamOptions - Options for streaming
   * @returns Object containing the assistant message and stop reason
   */
  private async *_streamFromModel(
    messages: Message[],
    streamOptions: StreamOptions
  ): AsyncGenerator<AgentStreamEvent, { message: Message; stopReason: string }, undefined> {
    const streamGenerator = this._model.streamAggregated(messages, streamOptions)
    let result = await streamGenerator.next()

    while (!result.done) {
      const event = result.value

      await this.hooks.invokeCallbacks(new ModelStreamEventHook({ agent: this, event }))

      yield event
      result = await streamGenerator.next()
    }

    // result.done is true, result.value contains the return value
    return result.value
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
      yield toolResultBlock
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

    // Create toolUse object for hook events
    const toolUse = {
      name: toolUseBlock.name,
      toolUseId: toolUseBlock.toolUseId,
      input: toolUseBlock.input,
    }

    // Invoke BeforeToolCallEvent hook
    await this.hooks.invokeCallbacks(new BeforeToolCallEvent({ agent: this, toolUse, tool }))

    if (!tool) {
      // Tool not found - return error result instead of throwing
      const errorResult = new ToolResultBlock({
        toolUseId: toolUseBlock.toolUseId,
        status: 'error',
        content: [new TextBlock(`Tool '${toolUseBlock.name}' not found in registry`)],
      })

      // Invoke AfterToolCallEvent hook for tool not found
      await this.hooks.invokeCallbacks(new AfterToolCallEvent({ agent: this, toolUse, tool, result: errorResult }))

      return errorResult
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

    try {
      const toolGenerator = tool.stream(toolContext)

      // Use yield* to delegate to the tool generator and capture the return value
      const toolResult = yield* toolGenerator

      if (!toolResult) {
        // Tool didn't return a result - return error result instead of throwing
        const errorResult = new ToolResultBlock({
          toolUseId: toolUseBlock.toolUseId,
          status: 'error',
          content: [new TextBlock(`Tool '${toolUseBlock.name}' did not return a result`)],
        })

        // Invoke AfterToolCallEvent hook for no result
        await this.hooks.invokeCallbacks(new AfterToolCallEvent({ agent: this, toolUse, tool, result: errorResult }))

        return errorResult
      }

      // Invoke AfterToolCallEvent hook for success
      await this.hooks.invokeCallbacks(new AfterToolCallEvent({ agent: this, toolUse, tool, result: toolResult }))

      // Tool already returns ToolResultBlock directly
      return toolResult
    } catch (error) {
      // Tool execution failed with error
      const toolError = normalizeError(error)
      const errorResult = new ToolResultBlock({
        toolUseId: toolUseBlock.toolUseId,
        status: 'error',
        content: [new TextBlock(toolError.message)],
        error: toolError,
      })

      // Invoke AfterToolCallEvent hook for error
      await this.hooks.invokeCallbacks(
        new AfterToolCallEvent({ agent: this, toolUse, tool, result: errorResult, error: toolError })
      )

      return errorResult
    }
  }

  /**
   * Appends a message to the conversation history and fires the MessageAddedEvent hook.
   *
   * @param message - The message to append
   */
  private async _appendMessage(message: Message): Promise<void> {
    this.messages.push(message)
    await this.hooks.invokeCallbacks(new MessageAddedEvent({ agent: this, message }))
  }
}

/**
 * Recursively flattens nested arrays of tools into a single flat array.
 * @param tools - Tools or nested arrays of tools
 * @returns Flat array of tools and MCP clients
 */
function flattenTools(toolList: ToolList): { tools: Tool[]; mcpClients: McpClient[] } {
  const tools: Tool[] = []
  const mcpClients: McpClient[] = []

  for (const item of toolList) {
    if (Array.isArray(item)) {
      const { tools: nestedTools, mcpClients: nestedMcpClients } = flattenTools(item)
      tools.push(...nestedTools)
      mcpClients.push(...nestedMcpClients)
    } else if (item instanceof McpClient) {
      mcpClients.push(item)
    } else {
      tools.push(item)
    }
  }

  return { tools, mcpClients }
}
