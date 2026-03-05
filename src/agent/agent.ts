import { AgentResult, type AgentStreamEvent } from '../types/agent.js'
import { BedrockModel } from '../models/bedrock.js'
import {
  contentBlockFromData,
  type ContentBlock,
  type ContentBlockData,
  Message,
  type MessageData,
  type StopReason,
  type SystemPrompt,
  type SystemPromptData,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
} from '../types/messages.js'
import type { JSONValue } from '../types/json.js'
import { McpClient } from '../mcp.js'
import { type Tool, type ToolContext } from '../tools/tool.js'
import type { ToolChoice } from '../tools/types.js'
import { systemPromptFromData } from '../types/messages.js'
import { normalizeError, ConcurrentInvocationError, MaxTokensError } from '../errors.js'
import { Model } from '../models/model.js'
import type { BaseModelConfig, StreamOptions } from '../models/model.js'
import { isModelStreamEvent } from '../models/streaming.js'
import { ToolRegistry } from '../registry/tool-registry.js'
import { AppState } from '../app-state.js'
import type { AgentData } from '../types/agent.js'
import { AgentPrinter, getDefaultAppender, type Printer } from './printer.js'
import type { HookProvider } from '../hooks/types.js'
import { SlidingWindowConversationManager } from '../conversation-manager/sliding-window-conversation-manager.js'
import { HookRegistryImplementation } from '../hooks/registry.js'
import {
  InitializedEvent,
  AfterInvocationEvent,
  AfterModelCallEvent,
  AfterToolCallEvent,
  AfterToolsEvent,
  BeforeInvocationEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
  BeforeToolsEvent,
  HookableEvent,
  MessageAddedEvent,
  ModelStreamUpdateEvent,
  ContentBlockEvent,
  ModelMessageEvent,
  ToolResultEvent,
  AgentResultEvent,
  ToolStreamUpdateEvent,
} from '../hooks/events.js'
import { createStructuredOutputContext } from '../structured-output/context.js'
import { StructuredOutputException } from '../structured-output/exceptions.js'
import type { z } from 'zod'
import { Tracer } from '../telemetry/tracer.js'
import type { Usage } from '../models/streaming.js'
import type { AttributeValue } from '@opentelemetry/api'

/**
 * Recursive type definition for nested tool arrays.
 * Allows tools to be organized in nested arrays of any depth.
 */
export type ToolList = (Tool | McpClient | ToolList)[]

/**
 * Configuration object for creating a new Agent.
 */
export type AgentConfig = {
  /**
   * The model instance that the agent will use to make decisions.
   * Accepts either a Model instance or a string representing a Bedrock model ID.
   * When a string is provided, it will be used to create a BedrockModel instance.
   *
   * @example
   * ```typescript
   * // Using a string model ID (creates BedrockModel)
   * const agent = new Agent({
   *   model: 'anthropic.claude-3-5-sonnet-20240620-v1:0'
   * })
   *
   * // Using an explicit BedrockModel instance with configuration
   * const agent = new Agent({
   *   model: new BedrockModel({
   *     modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
   *     temperature: 0.7,
   *     maxTokens: 2048
   *   })
   * })
   * ```
   */
  model?: Model<BaseModelConfig> | string
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
  systemPrompt?: SystemPrompt | SystemPromptData
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
  /**
   * Zod schema for structured output validation.
   */
  structuredOutputSchema?: z.ZodSchema
  /**
   * Custom trace attributes to include in all spans.
   * These attributes are merged with standard attributes in telemetry spans.
   * Telemetry must be enabled globally via telemetry.setupTracer() for these to take effect.
   */
  traceAttributes?: Record<string, AttributeValue>
  /**
   * Optional name for the agent. Defaults to "Strands Agent".
   */
  name?: string
  /**
   * Optional unique identifier for the agent. Defaults to "default".
   */
  agentId?: string
}

/**
 * Arguments for invoking an agent.
 *
 * Supports multiple input formats:
 * - `string` - User text input (wrapped in TextBlock, creates user Message)
 * - `ContentBlock[]` | `ContentBlockData[]` - Array of content blocks (creates single user Message)
 * - `Message[]` | `MessageData[]` - Array of messages (appends all to conversation)
 */
export type InvokeArgs = string | ContentBlock[] | ContentBlockData[] | Message[] | MessageData[]

/**
 * Options for a single agent invocation.
 */
export interface InvokeOptions {
  /**
   * Zod schema for structured output validation, overriding the constructor-provided schema for this invocation only.
   */
  structuredOutputSchema?: z.ZodSchema
}

/** Fallback name used when no agent name is provided in the config. */
const DEFAULT_AGENT_NAME = 'Strands Agent'

/** Fallback agent ID used when no agent ID is provided in the config. */
const DEFAULT_AGENT_ID = 'default'

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
   * App state storage accessible to tools and application logic.
   * State is not passed to the model during inference.
   */
  public readonly state: AppState
  /**
   * Conversation manager for handling message history and context overflow.
   */
  public readonly conversationManager: HookProvider
  /**
   * Hook registry for managing event callbacks.
   * Hooks enable observing and extending agent behavior.
   */
  public readonly hooks: HookRegistryImplementation

  /**
   * The model provider used by the agent for inference.
   */
  public model: Model

  /**
   * The system prompt to pass to the model provider.
   */
  public systemPrompt?: SystemPrompt

  /**
   * The name of the agent.
   */
  public readonly name: string

  /**
   * The unique identifier of the agent instance.
   */
  public readonly agentId: string

  private _toolRegistry: ToolRegistry
  private _mcpClients: McpClient[]
  private _initialized: boolean
  private _isInvoking: boolean = false
  private _printer?: Printer
  private _structuredOutputSchema?: z.ZodSchema | undefined
  /** Tracer instance for creating and managing OpenTelemetry spans. */
  private _tracer: Tracer
  /** Running total of token usage across all model invocations in the current invocation. */
  private _accumulatedTokenUsage: Usage = Agent._createEmptyUsage()

  /**
   * Creates an instance of the Agent.
   * @param config - The configuration for the agent.
   */
  constructor(config?: AgentConfig) {
    // Initialize public fields
    this.messages = (config?.messages ?? []).map((msg) => (msg instanceof Message ? msg : Message.fromMessageData(msg)))
    this.state = new AppState(config?.state)
    this.conversationManager = config?.conversationManager ?? new SlidingWindowConversationManager({ windowSize: 40 })
    this.name = config?.name ?? DEFAULT_AGENT_NAME
    this.agentId = config?.agentId ?? DEFAULT_AGENT_ID

    // Initialize hooks and register conversation manager hooks
    this.hooks = new HookRegistryImplementation()
    this.hooks.addHook(this.conversationManager)
    this.hooks.addAllHooks(config?.hooks ?? [])

    if (typeof config?.model === 'string') {
      this.model = new BedrockModel({ modelId: config.model })
    } else {
      this.model = config?.model ?? new BedrockModel()
    }

    const { tools, mcpClients } = flattenTools(config?.tools ?? [])
    this._toolRegistry = new ToolRegistry(tools)
    this._mcpClients = mcpClients

    if (config?.systemPrompt !== undefined) {
      this.systemPrompt = systemPromptFromData(config.systemPrompt)
    }

    // Create printer if printer is enabled (default: true)
    const printer = config?.printer ?? true
    if (printer) {
      this._printer = new AgentPrinter(getDefaultAppender())
    }

    // Store structured output schema
    this._structuredOutputSchema = config?.structuredOutputSchema

    // Initialize tracer - OTEL returns no-op tracer if not configured
    this._tracer = new Tracer(config?.traceAttributes)

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

    await this.hooks.invokeCallbacks(new InitializedEvent({ agent: this }))

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
   * @param options - Optional per-invocation options
   * @returns Promise that resolves to the final AgentResult
   *
   * @example
   * ```typescript
   * const agent = new Agent({ model, tools })
   * const result = await agent.invoke('What is 2 + 2?')
   * console.log(result.lastMessage) // Agent's response
   * ```
   */
  public async invoke(args: InvokeArgs, options?: InvokeOptions): Promise<AgentResult> {
    const gen = this.stream(args, options)
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
   * @param options - Optional per-invocation options
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
  public async *stream(
    args: InvokeArgs,
    options?: InvokeOptions
  ): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    using _lock = this.acquireLock()

    await this.initialize()

    // Delegate to _stream and process events through printer and hooks
    const streamGenerator = this._stream(args, options)
    let result = await streamGenerator.next()

    while (!result.done) {
      const event = result.value

      // Invoke hook callbacks for hookable events (all current events are hookable;
      // the guard exists for future StreamEvent subclasses that may not be)
      if (event instanceof HookableEvent) {
        await this.hooks.invokeCallbacks(event)
      }

      this._printer?.processEvent(event)
      yield event
      result = await streamGenerator.next()
    }

    // Yield final result as last event
    const agentResultEvent = new AgentResultEvent({ agent: this, result: result.value })
    await this.hooks.invokeCallbacks(agentResultEvent)
    this._printer?.processEvent(agentResultEvent)
    yield agentResultEvent

    return result.value
  }

  /**
   * Internal implementation of the agent streaming logic.
   * Separated to centralize printer event processing in the public stream method.
   *
   * @param args - Arguments for invoking the agent
   * @param options - Optional per-invocation options
   * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
   */
  private async *_stream(
    args: InvokeArgs,
    options?: InvokeOptions
  ): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    let currentArgs: InvokeArgs | undefined = args
    let forcedToolChoice: ToolChoice | undefined = undefined
    let result: AgentResult | undefined

    // Create structured output context (uses null object pattern when no schema)
    const schema = options?.structuredOutputSchema ?? this._structuredOutputSchema
    const context = createStructuredOutputContext(schema)

    // Emit event before the try block
    yield new BeforeInvocationEvent({ agent: this })

    // Normalize input to get the user messages for telemetry
    const inputMessages = this._normalizeInput(args)

    // Start agent trace span
    this._accumulatedTokenUsage = Agent._createEmptyUsage()
    const agentModelId = this.model.modelId
    const agentSpanOptions: Parameters<Tracer['startAgentSpan']>[0] = {
      messages: inputMessages,
      agentName: this.name,
      agentId: this.agentId,
      tools: this.tools,
    }
    if (agentModelId) agentSpanOptions.modelId = agentModelId
    if (this.systemPrompt) agentSpanOptions.systemPrompt = this.systemPrompt
    const agentSpan = this._tracer.startAgentSpan(agentSpanOptions)

    let caughtError: Error | undefined
    try {
      // Register structured output tool
      context.registerTool(this._toolRegistry)

      // Main agent loop - continues until model stops without requesting tools
      for (let cycleCount = 1; ; cycleCount++) {
        // Create agent loop cycle span within agent span context
        const cycleSpan = this._tracer.startAgentLoopSpan({
          cycleId: `cycle-${cycleCount}`,
          messages: this.messages,
        })

        try {
          const modelResult = yield* this.invokeModel(currentArgs, forcedToolChoice)
          currentArgs = undefined // Only pass args on first invocation
          const wasForced = forcedToolChoice !== undefined
          forcedToolChoice = undefined // Clear after use

          if (modelResult.stopReason !== 'toolUse') {
            // Special handling for maxTokens - always fail regardless of whether we have structured output
            if (modelResult.stopReason === 'maxTokens') {
              throw new MaxTokensError(
                'The model reached maxTokens before producing structured output. Consider increasing maxTokens in your model configuration.',
                modelResult.message
              )
            }

            // Check if we need to force structured output tool
            if (!context.hasResult()) {
              if (wasForced) {
                // Already tried forcing - LLM refused to use the tool
                throw new StructuredOutputException(
                  'The model failed to invoke the structured output tool even after it was forced.'
                )
              }

              // Force the model to use the structured output tool
              const toolName = context.getToolName()
              forcedToolChoice = { tool: { name: toolName } }
              this._tracer.endAgentLoopSpan(cycleSpan)
              continue
            }

            // Loop terminates - no tool use requested (and structured output satisfied if needed)
            yield this._appendMessage(modelResult.message)

            // End cycle span
            this._tracer.endAgentLoopSpan(cycleSpan)

            const structuredOutput = context.getResult()
            result = new AgentResult({
              stopReason: modelResult.stopReason,
              lastMessage: modelResult.message,
              structuredOutput,
            })
            return result
          }

          // Execute tools sequentially
          const toolResultMessage = yield* this.executeTools(modelResult.message, this._toolRegistry)

          /**
           * Deferred append: both messages are added AFTER tool execution completes.
           * This keeps agent.messages in a valid, reinvokable state at all times:
           *
           * - If interrupted during tool execution, messages has no dangling toolUse
           *   without a matching toolResult, so the agent can be reinvoked cleanly.
           * - The Python SDK appends the assistant message BEFORE tool execution,
           *   requiring recovery logic (generate_missing_tool_result_content) on
           *   interrupts. We avoid that by deferring.
           * - Trade-off: MessageAddedEvent for the assistant message fires after tools
           *   complete (not before as in Python), and agent.messages is incomplete
           *   during tool execution. Events like BeforeToolsEvent.message and
           *   BeforeToolCallEvent.toolUse provide the data directly.
           */
          yield this._appendMessage(modelResult.message)
          yield this._appendMessage(toolResultMessage)

          // End cycle span
          this._tracer.endAgentLoopSpan(cycleSpan)

          // Continue loop
        } catch (error) {
          // End cycle span with error
          this._tracer.endAgentLoopSpan(cycleSpan, { error: error as Error })
          throw error
        }
      }
    } catch (error) {
      caughtError = error as Error
      throw error
    } finally {
      this._tracer.endAgentSpan(agentSpan, {
        ...(caughtError && { error: caughtError }),
        ...(result?.lastMessage && { response: result.lastMessage }),
        accumulatedUsage: this._accumulatedTokenUsage,
        ...(result?.stopReason && { stopReason: result.stopReason }),
      })

      // Cleanup structured output context
      context.cleanup(this._toolRegistry)

      // Always emit final event
      yield new AfterInvocationEvent({ agent: this })
    }
  }

  /**
   * Normalizes agent invocation input into an array of messages to append.
   *
   * @param args - Optional arguments for invoking the model
   * @returns Array of messages to append to the conversation
   */
  private _normalizeInput(args?: InvokeArgs): Message[] {
    if (args !== undefined) {
      if (typeof args === 'string') {
        // String input: wrap in TextBlock and create user Message
        return [
          new Message({
            role: 'user',
            content: [new TextBlock(args)],
          }),
        ]
      } else if (Array.isArray(args) && args.length > 0) {
        const firstElement = args[0]!

        // Check if it's Message[] or MessageData[]
        if ('role' in firstElement && typeof firstElement.role === 'string') {
          // Check if it's a Message instance or MessageData
          if (firstElement instanceof Message) {
            // Message[] input: return all messages
            return args as Message[]
          } else {
            // MessageData[] input: convert to Message[]
            return (args as MessageData[]).map((data) => Message.fromMessageData(data))
          }
        } else {
          // It's ContentBlock[] or ContentBlockData[]
          // Check if it's ContentBlock instances or ContentBlockData
          let contentBlocks: ContentBlock[]
          if ('type' in firstElement && typeof firstElement.type === 'string') {
            // ContentBlock[] input: use as-is
            contentBlocks = args as ContentBlock[]
          } else {
            // ContentBlockData[] input: convert using helper function
            contentBlocks = (args as ContentBlockData[]).map(contentBlockFromData)
          }

          return [
            new Message({
              role: 'user',
              content: contentBlocks,
            }),
          ]
        }
      }
    }
    // undefined or empty array: no messages to append
    return []
  }

  /**
   * Invokes the model provider and streams all events.
   *
   * @param args - Optional arguments for invoking the model
   * @param toolChoice - Optional tool choice to force specific tool usage
   * @returns Object containing the assistant message and stop reason
   */
  private async *invokeModel(
    args?: InvokeArgs,
    forcedToolChoice?: ToolChoice
  ): AsyncGenerator<AgentStreamEvent, { message: Message; stopReason: StopReason }, undefined> {
    // Normalize input and append messages to conversation
    const messagesToAppend = this._normalizeInput(args)
    for (const message of messagesToAppend) {
      yield this._appendMessage(message)
    }

    const toolSpecs = this._toolRegistry.values().map((tool) => tool.toolSpec)
    const streamOptions: StreamOptions = { toolSpecs }
    if (this.systemPrompt !== undefined) {
      streamOptions.systemPrompt = this.systemPrompt
    }

    // Add tool choice if provided (for structured output forcing)
    if (forcedToolChoice) {
      streamOptions.toolChoice = forcedToolChoice
    }

    yield new BeforeModelCallEvent({ agent: this })

    // Start model span within loop span context
    const modelId = this.model.modelId
    const modelSpan = this._tracer.startModelInvokeSpan({
      messages: this.messages,
      ...(modelId && { modelId }),
    })

    try {
      const { message, stopReason, usage } = yield* this._streamFromModel(this.messages, streamOptions)

      // Accumulate token usage
      if (usage) {
        Agent._accumulateUsage(this._accumulatedTokenUsage, usage)
      }

      // End model span with usage
      this._tracer.endModelInvokeSpan(modelSpan, { output: message, stopReason, ...(usage && { usage }) })

      yield new ModelMessageEvent({ agent: this, message, stopReason })

      const afterModelCallEvent = new AfterModelCallEvent({ agent: this, stopData: { message, stopReason } })
      yield afterModelCallEvent

      if (afterModelCallEvent.retry) {
        return yield* this.invokeModel(args)
      }

      return { message, stopReason }
    } catch (error) {
      const modelError = normalizeError(error)

      // End model span with error
      this._tracer.endModelInvokeSpan(modelSpan, { error: modelError })

      // Create error event
      const errorEvent = new AfterModelCallEvent({ agent: this, error: modelError })

      // Yield error event - stream will invoke hooks
      yield errorEvent

      // After yielding, hooks have been invoked and may have set retry
      if (errorEvent.retry) {
        return yield* this.invokeModel(args)
      }

      // Re-throw error
      throw error
    }
  }

  /**
   * Streams events from the model and dispatches appropriate events for each.
   *
   * The model's `streamAggregated()` yields two kinds of output:
   * - **ModelStreamEvent**: Transient streaming deltas (partial data while generating).
   *   Wrapped in {@link ModelStreamUpdateEvent} before yielding.
   * - **ContentBlock**: Fully assembled results (after all deltas accumulate).
   *   Wrapped in {@link ContentBlockEvent} before yielding.
   *
   * These are separate event classes because they represent different granularities
   * (partial deltas vs finished blocks). Both are yielded in the stream and hookable.
   *
   * @param messages - Messages to send to the model
   * @param streamOptions - Options for streaming
   * @returns Object containing the assistant message and stop reason
   */
  private async *_streamFromModel(
    messages: Message[],
    streamOptions: StreamOptions
  ): AsyncGenerator<AgentStreamEvent, { message: Message; stopReason: StopReason; usage?: Usage }, undefined> {
    const streamGenerator = this.model.streamAggregated(messages, streamOptions)
    let result = await streamGenerator.next()

    while (!result.done) {
      const event = result.value

      if (isModelStreamEvent(event)) {
        // ModelStreamEvent: wrap in ModelStreamUpdateEvent
        yield new ModelStreamUpdateEvent({ agent: this, event })
      } else {
        // ContentBlock: wrap in ContentBlockEvent
        yield new ContentBlockEvent({ agent: this, contentBlock: event })
      }
      result = await streamGenerator.next()
    }

    // result.done is true, result.value contains the return value
    const { message, stopReason, metadata } = result.value
    const returnValue: { message: Message; stopReason: StopReason; usage?: Usage } = { message, stopReason }
    if (metadata?.usage) returnValue.usage = metadata.usage
    return returnValue
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
    yield new BeforeToolsEvent({ agent: this, message: assistantMessage })

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

      // Yield the tool result event as it's created
      yield new ToolResultEvent({ agent: this, result: toolResultBlock })
    }

    // Create user message with tool results
    const toolResultMessage: Message = new Message({
      role: 'user',
      content: toolResultBlocks,
    })

    yield new AfterToolsEvent({ agent: this, message: toolResultMessage })

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

    // Create toolUse object for hook events and telemetry
    const toolUse = {
      name: toolUseBlock.name,
      toolUseId: toolUseBlock.toolUseId,
      input: toolUseBlock.input,
    }

    // Retry loop for tool execution
    while (true) {
      yield new BeforeToolCallEvent({ agent: this, toolUse, tool })

      // Start tool span within loop span context
      const toolSpan = this._tracer.startToolCallSpan({
        tool: toolUse,
      })

      let toolResult: ToolResultBlock
      let error: Error | undefined

      if (!tool) {
        // Tool not found
        toolResult = new ToolResultBlock({
          toolUseId: toolUseBlock.toolUseId,
          status: 'error',
          content: [new TextBlock(`Tool '${toolUseBlock.name}' not found in registry`)],
        })
      } else {
        // Execute tool within the tool span context
        const toolContext: ToolContext = {
          toolUse: {
            name: toolUseBlock.name,
            toolUseId: toolUseBlock.toolUseId,
            input: toolUseBlock.input,
          },
          agent: this,
        }

        try {
          // Manually iterate tool stream to wrap each ToolStreamEvent in ToolStreamUpdateEvent.
          // This keeps the tool authoring interface unchanged — tools construct ToolStreamEvent
          // without knowledge of agents or hooks, and we wrap at the boundary.
          // Tool execution is ran within the tool span's context so that
          // downstream calls (e.g., MCP clients) can propagate trace context
          const toolGenerator = this._tracer.withSpanContext(toolSpan, () => tool.stream(toolContext))
          let toolNext = await this._tracer.withSpanContext(toolSpan, () => toolGenerator.next())
          while (!toolNext.done) {
            yield new ToolStreamUpdateEvent({ agent: this, event: toolNext.value })
            toolNext = await this._tracer.withSpanContext(toolSpan, () => toolGenerator.next())
          }
          const result = toolNext.value

          if (!result) {
            // Tool didn't return a result
            toolResult = new ToolResultBlock({
              toolUseId: toolUseBlock.toolUseId,
              status: 'error',
              content: [new TextBlock(`Tool '${toolUseBlock.name}' did not return a result`)],
            })
          } else {
            toolResult = result
            error = result.error
          }
        } catch (e) {
          // Tool execution failed with error
          error = normalizeError(e)
          toolResult = new ToolResultBlock({
            toolUseId: toolUseBlock.toolUseId,
            status: 'error',
            content: [new TextBlock(error.message)],
            error,
          })
        }
      }

      // End tool span
      this._tracer.endToolCallSpan(toolSpan, { toolResult, ...(error && { error }) })

      // Single point for AfterToolCallEvent
      const afterToolCallEvent = new AfterToolCallEvent({
        agent: this,
        toolUse,
        tool,
        result: toolResult,
        ...(error !== undefined && { error }),
      })
      yield afterToolCallEvent

      if (afterToolCallEvent.retry) {
        continue
      }

      return toolResult
    }
  }

  /**
   * Appends a message to the conversation history and returns the event for yielding.
   *
   * @param message - The message to append
   * @returns MessageAddedEvent to be yielded
   */
  private _appendMessage(message: Message): MessageAddedEvent {
    this.messages.push(message)
    return new MessageAddedEvent({ agent: this, message })
  }

  /**
   * Creates an empty Usage object with all counters set to zero.
   *
   * @returns A Usage object with zeroed counters
   */
  private static _createEmptyUsage(): Usage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    }
  }

  /**
   * Accumulates token usage from a source into a target Usage object.
   *
   * @param target - The Usage object to accumulate into (mutated in place)
   * @param source - The Usage object to accumulate from
   */
  private static _accumulateUsage(target: Usage, source: Usage): void {
    target.inputTokens += source.inputTokens
    target.outputTokens += source.outputTokens
    target.totalTokens += source.totalTokens
    if (source.cacheReadInputTokens !== undefined) {
      target.cacheReadInputTokens = (target.cacheReadInputTokens ?? 0) + source.cacheReadInputTokens
    }
    if (source.cacheWriteInputTokens !== undefined) {
      target.cacheWriteInputTokens = (target.cacheWriteInputTokens ?? 0) + source.cacheWriteInputTokens
    }
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
