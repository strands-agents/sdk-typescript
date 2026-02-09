import type { Span } from '@opentelemetry/api'
import type { ZodType } from 'zod'
import { v5 as uuidv5 } from 'uuid'
import {
  AgentResult,
  type AgentStreamEvent,
  BedrockModel,
  contentBlockFromData,
  type ContentBlock,
  type ContentBlockData,
  type JSONValue,
  McpClient,
  Message,
  type MessageData,
  type StopReason,
  type SystemPrompt,
  type SystemPromptData,
  TextBlock,
  type Tool,
  type ToolContext,
  ToolResultBlock,
  ToolUseBlock,
} from '../index.js'
import { systemPromptFromData } from '../types/messages.js'
import { normalizeError, ConcurrentInvocationError, StructuredOutputError } from '../errors.js'
import { Interrupt, InterruptException, InterruptState, UUID_NAMESPACE_OID } from '../interrupt.js'
import { MetricsClient } from '../telemetry/metrics.js'
import { isInterruptResponseArray } from '../types/interrupt.js'
import { StructuredOutputContext } from '../tools/structured-output/structured-output-context.js'
import type { BaseModelConfig, Model, StreamOptions } from '../models/model.js'
import type { Usage, Metrics } from '../models/streaming.js'
import { ToolRegistry } from '../registry/tool-registry.js'
import { AgentState } from './state.js'
import type { AgentData } from '../types/agent.js'
import { AgentPrinter, getDefaultAppender, type Printer } from './printer.js'
import type { HookProvider } from '../hooks/types.js'
import type { ConversationManager } from '../conversation-manager/conversation-manager.js'
import { SlidingWindowConversationManager } from '../conversation-manager/sliding-window-conversation-manager.js'
import { getTracer, type StrandsTracer } from '../telemetry/tracer.js'
import { HookRegistryImplementation } from '../hooks/registry.js'
import {
  HookEvent,
  AgentInitializedEvent,
  AfterInvocationEvent,
  AfterModelCallEvent,
  AfterToolCallEvent,
  AfterToolsEvent,
  BeforeInvocationEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
  BeforeToolsEvent,
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
  conversationManager?: ConversationManager
  /**
   * Hook providers to register with the agent.
   * Hooks enable observing and extending agent behavior.
   */
  hooks?: HookProvider[]

  /**
   * Optional default Zod schema for structured output.
   * When set, the agent will request the model to return data matching this schema.
   * Can be overridden per invocation via invoke() or stream() options.
   */
  structuredOutput?: ZodType

  /**
   * Optional default prompt used when forcing the model to use the structured output tool.
   * Used when the model ends its turn without calling the tool.
   */
  structuredOutputPrompt?: string

  /**
   * Human-readable name for this agent.
   * Used for span naming in telemetry and node identification in multi-agent patterns.
   * Defaults to 'Strands Agent'.
   */
  name?: string

  /**
   * Unique identifier for this agent within a session.
   * Used as a storage path key by session managers.
   * Must not contain path separators (/ or \).
   * Defaults to 'default'.
   */
  agentId?: string

  /**
   * Custom attributes to include in OpenTelemetry trace spans.
   */
  traceAttributes?: Record<string, string | number | boolean | string[]>

  /**
   * Session manager for persisting conversation history and agent state across sessions.
   * Registered as a hook provider to integrate with the agent lifecycle.
   */
  sessionManager?: HookProvider
}

/**
 * Options for a single invocation (invoke or stream).
 * Overrides agent-level defaults when provided.
 */
export type InvokeOptions = {
  /**
   * Zod schema for structured output for this invocation.
   * Overrides agent config default when provided.
   */
  structuredOutput?: ZodType

  /**
   * Prompt used when forcing the model to use the structured output tool.
   */
  structuredOutputPrompt?: string

  /**
   * Opaque context passed from multi-agent orchestrators (Swarm/Graph).
   * Available to hooks and tools when the agent is invoked as a node.
   */
  invocationState?: Record<string, unknown>

  /**
   * Parent OpenTelemetry span for nesting agent span under (e.g. multi-agent node span).
   */
  parentSpan?: Span
}

/**
 * Arguments for invoking an agent.
 *
 * Supports multiple input formats:
 * - `string` - User text input (wrapped in TextBlock, creates user Message)
 * - `ContentBlock[]` | `ContentBlockData[]` - Array of content blocks (creates single user Message)
 * - `Message[]` | `MessageData[]` - Array of messages (appends all to conversation)
 * - `InterruptResponseContent[]` - Responses to interrupts when resuming from an interrupt state
 */
export type InvokeArgs =
  | string
  | ContentBlock[]
  | ContentBlockData[]
  | Message[]
  | MessageData[]
  | import('../types/interrupt.js').InterruptResponseContent[]

/**
 * Orchestrates the interaction between a model, a set of tools, and MCP clients.
 * The Agent is responsible for managing the lifecycle of tools and clients
 * and invoking the core decision-making loop.
 */
export class Agent implements AgentData {
  /**
   * Human-readable name for this agent.
   */
  public readonly name: string

  /**
   * Unique identifier for this agent within a session.
   */
  public readonly agentId: string

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
  public readonly conversationManager: ConversationManager
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
   * Interrupt state for human-in-the-loop workflows.
   * Accessed by hook events via type assertion to support the interrupt system.
   * @internal
   */
  readonly _interruptState: InterruptState

  private readonly _traceAttributes: Record<string, string | number | boolean | string[]> | undefined
  private readonly _tracer: StrandsTracer
  private _toolRegistry: ToolRegistry
  private _mcpClients: McpClient[]
  private _initialized: boolean
  private _isInvoking: boolean = false
  private _printer?: Printer
  private _defaultStructuredOutput?: ZodType
  private _defaultStructuredOutputPrompt?: string

  /**
   * Creates an instance of the Agent.
   * @param config - The configuration for the agent.
   */
  constructor(config?: AgentConfig) {
    // Validate and set name
    this.name = config?.name ?? 'Strands Agent'

    // Validate and set agentId
    const agentId = config?.agentId ?? 'default'
    if (agentId.includes('/') || agentId.includes('\\')) {
      throw new Error(`Invalid agentId "${agentId}": must not contain path separators (/ or \\)`)
    }
    this.agentId = agentId

    // Initialize interrupt state for human-in-the-loop workflows
    this._interruptState = new InterruptState()

    // Store trace attributes and create tracer
    this._traceAttributes = config?.traceAttributes
    this._tracer = getTracer()

    // Initialize public fields
    this.messages = (config?.messages ?? []).map((msg) => (msg instanceof Message ? msg : Message.fromMessageData(msg)))
    this.state = new AgentState(config?.state)
    this.conversationManager = config?.conversationManager ?? new SlidingWindowConversationManager({ windowSize: 40 })

    // Initialize hooks and register conversation manager hooks
    this.hooks = new HookRegistryImplementation()
    this.hooks.addHook(this.conversationManager)
    this.hooks.addAllHooks(config?.hooks ?? [])

    // Register session manager as hook provider if provided
    if (config?.sessionManager !== undefined) {
      this.hooks.addHook(config.sessionManager)
    }

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

    if (config?.structuredOutput !== undefined) {
      this._defaultStructuredOutput = config.structuredOutput
    }
    if (config?.structuredOutputPrompt !== undefined) {
      this._defaultStructuredOutputPrompt = config.structuredOutputPrompt
    }
    this._initialized = false
  }

  public async initialize(): Promise<void> {
    if (this._initialized) {
      return
    }

    await Promise.all([
      this._tracer.initialize(),
      ...this._mcpClients.map(async (client) => {
        const tools = await client.listTools()
        this._toolRegistry.addAll(tools)
      }),
    ])

    // Fire AgentInitializedEvent for session managers and other lifecycle hooks
    const initEvent = new AgentInitializedEvent({ agent: this })
    await this.hooks.invokeCallbacks(initEvent)

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
  public async invoke(args: InvokeArgs, options?: InvokeOptions): Promise<AgentResult> {
    const gen = this.stream(args, options)
    let result = await gen.next()
    while (!result.done) {
      result = await gen.next()
    }
    return result.value
  }

  /**
   * Replaces the conversation message history.
   * Used internally by multi-agent orchestrators and session managers to restore state.
   * @internal
   */
  _restoreMessages(messages: Message[]): void {
    this.messages.length = 0
    this.messages.push(...messages)
  }

  /**
   * Replaces the agent state.
   * Used internally by multi-agent orchestrators and session managers to restore state.
   * @internal
   */
  _restoreState(data: Record<string, never>): void {
    ;(this as { state: AgentState }).state = new AgentState(data)
  }

  /**
   * Replaces the interrupt state from serialized data.
   * Used internally by session managers to restore interrupt state.
   * @internal
   */
  _restoreInterruptState(interruptState: InterruptState): void {
    ;(this as { _interruptState: InterruptState })._interruptState = interruptState
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

      // Invoke hook callbacks for Hook Events
      // MessageAddedEvent and BeforeToolCallEvent invoke hooks at their point of use
      if (
        event instanceof HookEvent &&
        !(event instanceof MessageAddedEvent) &&
        !(event instanceof BeforeToolCallEvent)
      ) {
        await this.hooks.invokeCallbacks(event)
      }

      this._printer?.processEvent(event)
      yield event
      result = await streamGenerator.next()
    }

    // Yield final result as last event
    yield result.value

    return result.value
  }

  /**
   * Internal implementation of the agent streaming logic.
   * Separated to centralize printer event processing in the public stream method.
   *
   * @param args - Arguments for invoking the agent
   * @param options - Optional invocation options (e.g. structured output)
   * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
   */
  private async *_stream(
    args: InvokeArgs,
    options?: InvokeOptions
  ): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    // Handle interrupt resume: map user responses to stored interrupts
    this._interruptState.resume(args)

    // Skip input normalization when resuming from interrupt
    let currentArgs: InvokeArgs | undefined = this._interruptState.activated ? undefined : args
    let streamOverrides: Partial<StreamOptions> | undefined

    const structuredOutputSchema = options?.structuredOutput ?? this._defaultStructuredOutput
    const structuredOutputPrompt = options?.structuredOutputPrompt ?? this._defaultStructuredOutputPrompt ?? undefined
    const context = new StructuredOutputContext({
      structuredOutputModel: structuredOutputSchema ?? null,
      structuredOutputPrompt: structuredOutputPrompt ?? null,
    })

    if (context.isEnabled) {
      if (this._interruptState.activated) {
        throw new Error('Cannot use structured output during interrupt resume')
      }
      context.registerTool(this._toolRegistry)
    }

    // Start the agent-level trace span
    const agentSpan = this._tracer.startAgentSpan({
      messages: this.messages,
      agentName: this.name,
      modelId: this.model.getConfig().modelId,
      tools: this._toolRegistry.values().map((t) => t.name),
      customTraceAttributes: this._traceAttributes,
      parentSpan: options?.parentSpan,
    })

    let agentResult: AgentResult | undefined
    let agentError: Error | undefined
    let cycleId = 0

    // Accumulate usage and metrics across all model calls
    const accumulatedUsage: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    const accumulatedMetrics: Metrics = { latencyMs: 0 }

    // Initialize OTel metrics (no-op if @opentelemetry/api not installed)
    const metricsClient = MetricsClient.getInstance()
    await metricsClient.initialize()

    try {
      yield new BeforeInvocationEvent({ agent: this })

      while (true) {
        cycleId++
        const cycleStartTime = Date.now()
        metricsClient.eventLoopCycleCount.add(1)
        metricsClient.eventLoopStartCycle.add(1)

        const cycleSpan = this._tracer.startEventLoopCycleSpan({
          cycleId,
          messages: this.messages,
          parentSpan: agentSpan,
          customTraceAttributes: this._traceAttributes,
        })

        let modelResult: { message: Message; stopReason: StopReason }

        if (this._interruptState.activated) {
          // Skip model invocation when resuming from interrupt
          modelResult = {
            message: this._interruptState.context['toolUseMessage'] as Message,
            stopReason: 'toolUse',
          }
        } else {
          const { message, stopReason, usage, metrics } = yield* this.invokeModel(
            currentArgs,
            streamOverrides,
            cycleSpan
          )
          modelResult = { message, stopReason }
          currentArgs = undefined
          streamOverrides = undefined

          // Accumulate usage and metrics from this model call
          if (usage !== undefined) {
            accumulatedUsage.inputTokens += usage.inputTokens
            accumulatedUsage.outputTokens += usage.outputTokens
            accumulatedUsage.totalTokens += usage.totalTokens
            if (usage.cacheReadInputTokens !== undefined) {
              accumulatedUsage.cacheReadInputTokens =
                (accumulatedUsage.cacheReadInputTokens ?? 0) + usage.cacheReadInputTokens
            }
            if (usage.cacheWriteInputTokens !== undefined) {
              accumulatedUsage.cacheWriteInputTokens =
                (accumulatedUsage.cacheWriteInputTokens ?? 0) + usage.cacheWriteInputTokens
            }
          }
          if (metrics !== undefined) {
            accumulatedMetrics.latencyMs += metrics.latencyMs
          }

          // Record per-cycle OTel metrics
          if (usage !== undefined && metrics !== undefined) {
            metricsClient.recordCycleMetrics({ usage, metrics })
          }
        }

        const metricsSnapshot = {
          accumulatedUsage: { ...accumulatedUsage },
          accumulatedMetrics: { ...accumulatedMetrics },
        }

        if (modelResult.stopReason !== 'toolUse') {
          metricsClient.eventLoopEndCycle.add(1)
          metricsClient.eventLoopCycleDuration.record((Date.now() - cycleStartTime) / 1000)
          this._tracer.endEventLoopCycleSpan({ span: cycleSpan, message: modelResult.message })

          if (context.isEnabled && !context.forceAttempted) {
            context.setForcedMode()
            currentArgs = context.structuredOutputPrompt
            streamOverrides = context.toolChoice != null ? { toolChoice: context.toolChoice } : undefined
            continue
          }
          if (context.isEnabled && context.forceAttempted) {
            throw new StructuredOutputError(
              'Model did not produce structured output after being forced to use the structured output tool.'
            )
          }
          yield await this._appendMessage(modelResult.message)
          agentResult = new AgentResult({
            stopReason: modelResult.stopReason,
            lastMessage: modelResult.message,
            metrics: metricsSnapshot,
          })
          return agentResult
        }

        const { toolResultMessage, interrupts } = yield* this.executeTools(
          modelResult.message,
          this._toolRegistry,
          cycleSpan
        )

        if (interrupts.length > 0) {
          // Store context for resume and activate interrupt state
          this._interruptState.context['toolUseMessage'] = modelResult.message
          this._interruptState.context['toolResults'] = toolResultMessage.content
          this._interruptState.activate()

          metricsClient.eventLoopEndCycle.add(1)
          metricsClient.eventLoopCycleDuration.record((Date.now() - cycleStartTime) / 1000)
          this._tracer.endEventLoopCycleSpan({ span: cycleSpan, message: modelResult.message })

          agentResult = new AgentResult({
            stopReason: 'interrupt',
            lastMessage: modelResult.message,
            interrupts,
            metrics: metricsSnapshot,
          })
          return agentResult
        }

        // No interrupts — deactivate interrupt state
        this._interruptState.deactivate()

        yield await this._appendMessage(modelResult.message)
        yield await this._appendMessage(toolResultMessage)

        metricsClient.eventLoopEndCycle.add(1)
        metricsClient.eventLoopCycleDuration.record((Date.now() - cycleStartTime) / 1000)
        this._tracer.endEventLoopCycleSpan({
          span: cycleSpan,
          message: modelResult.message,
          toolResultMessage,
        })

        const toolUseBlocks = modelResult.message.content.filter(
          (block): block is ToolUseBlock => block.type === 'toolUseBlock'
        )
        const extracted = context.extractResult(toolUseBlocks)
        if (extracted !== null && extracted !== undefined) {
          agentResult = new AgentResult({
            stopReason: 'endTurn',
            lastMessage: modelResult.message,
            structuredOutput: extracted,
            metrics: metricsSnapshot,
          })
          return agentResult
        }
      }
    } catch (error) {
      agentError = error instanceof Error ? error : new Error(String(error))
      throw error
    } finally {
      if (context.isEnabled) {
        context.cleanup(this._toolRegistry)
      }
      this._tracer.endAgentSpan({ span: agentSpan, response: agentResult, error: agentError })
      yield new AfterInvocationEvent({ agent: this })
    }
  }

  /**
   * Normalizes agent invocation input into an array of messages to append.
   *
   * Returns empty when in interrupt state (messages are not appended during resume).
   * Returns empty for interrupt response arrays (handled by InterruptState.resume).
   *
   * @param args - Optional arguments for invoking the model
   * @returns Array of messages to append to the conversation
   */
  private _normalizeInput(args?: InvokeArgs): Message[] {
    // Skip normalization when resuming from interrupt
    if (this._interruptState.activated) {
      return []
    }

    if (args !== undefined) {
      // Skip interrupt response arrays (handled by InterruptState.resume)
      if (isInterruptResponseArray(args)) {
        return []
      }

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
   * @param overrides - Optional overrides for stream options (e.g. toolChoice for structured output)
   * @returns Object containing the assistant message and stop reason
   */
  private async *invokeModel(
    args?: InvokeArgs,
    overrides?: Partial<StreamOptions>,
    parentSpan?: Span
  ): AsyncGenerator<
    AgentStreamEvent,
    { message: Message; stopReason: StopReason; usage: Usage | undefined; metrics: Metrics | undefined },
    undefined
  > {
    const messagesToAppend = this._normalizeInput(args)
    for (const message of messagesToAppend) {
      yield await this._appendMessage(message)
    }

    const toolSpecs = this._toolRegistry.values().map((tool) => tool.toolSpec)
    const streamOptions: StreamOptions = {
      toolSpecs,
      ...(this.systemPrompt !== undefined && { systemPrompt: this.systemPrompt }),
      ...overrides,
    }

    const modelSpan = this._tracer.startModelInvokeSpan({
      messages: this.messages,
      parentSpan,
      modelId: this.model.getConfig().modelId,
      customTraceAttributes: this._traceAttributes,
    })

    yield new BeforeModelCallEvent({ agent: this })

    try {
      const { message, stopReason, usage, metrics } = yield* this._streamFromModel(this.messages, streamOptions)

      if (usage !== undefined && metrics !== undefined) {
        this._tracer.endModelInvokeSpan({ span: modelSpan, message, usage, metrics, stopReason })
      } else {
        // End span without detailed metrics
        modelSpan.end()
      }

      const afterModelCallEvent = new AfterModelCallEvent({ agent: this, stopData: { message, stopReason } })
      yield afterModelCallEvent

      if (afterModelCallEvent.retry) {
        return yield* this.invokeModel(args, undefined, parentSpan)
      }

      return { message, stopReason, usage, metrics }
    } catch (error) {
      const modelError = normalizeError(error)

      // End model span with error
      modelSpan.setStatus({ code: 2, message: String(modelError) })
      modelSpan.recordException(modelError)
      modelSpan.end()

      // Create error event
      const errorEvent = new AfterModelCallEvent({ agent: this, error: modelError })

      // Yield error event - stream will invoke hooks
      yield errorEvent

      // After yielding, hooks have been invoked and may have set retry
      if (errorEvent.retry) {
        return yield* this.invokeModel(args, undefined, parentSpan)
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
   * @returns Object containing the assistant message, stop reason, and optional usage/metrics
   */
  private async *_streamFromModel(
    messages: Message[],
    streamOptions: StreamOptions
  ): AsyncGenerator<
    AgentStreamEvent,
    { message: Message; stopReason: StopReason; usage: Usage | undefined; metrics: Metrics | undefined },
    undefined
  > {
    const streamGenerator = this.model.streamAggregated(messages, streamOptions)
    let result = await streamGenerator.next()

    while (!result.done) {
      const event = result.value

      // Yield hook event for observability
      yield new ModelStreamEventHook({ agent: this, event })

      // Yield the actual model event
      yield event
      result = await streamGenerator.next()
    }

    // result.done is true, result.value contains the return value
    const { message, stopReason, metadata } = result.value
    return { message, stopReason, usage: metadata?.usage, metrics: metadata?.metrics }
  }

  /**
   * Executes tools sequentially and streams all tool events.
   *
   * Handles interrupt state: when resuming from an interrupt, merges stored
   * tool results and only executes tools that were interrupted (have no results yet).
   * Collects interrupts raised during tool execution and stops early if any occur.
   *
   * @param assistantMessage - The assistant message containing tool use blocks
   * @param toolRegistry - Registry containing available tools
   * @returns Object containing the tool result message and any collected interrupts
   */
  private async *executeTools(
    assistantMessage: Message,
    toolRegistry: ToolRegistry,
    parentSpan?: Span
  ): AsyncGenerator<AgentStreamEvent, { toolResultMessage: Message; interrupts: Interrupt[] }, undefined> {
    yield new BeforeToolsEvent({ agent: this, message: assistantMessage })

    // Extract tool use blocks from assistant message
    const toolUseBlocks = assistantMessage.content.filter(
      (block): block is ToolUseBlock => block.type === 'toolUseBlock'
    )

    if (toolUseBlocks.length === 0) {
      throw new Error('Model indicated toolUse but no tool use blocks found in message')
    }

    const toolResultBlocks: ToolResultBlock[] = []
    let toolUsesToProcess = toolUseBlocks

    // When resuming from interrupt, merge stored results and filter to interrupted tools
    if (this._interruptState.activated) {
      const storedResults = (this._interruptState.context['toolResults'] ?? []) as ContentBlock[]
      const storedToolResults = storedResults.filter(
        (block): block is ToolResultBlock => block.type === 'toolResultBlock'
      )
      toolResultBlocks.push(...storedToolResults)

      // Only process tools that don't have results yet
      const completedToolUseIds = new Set(storedToolResults.map((r) => r.toolUseId))
      toolUsesToProcess = toolUseBlocks.filter((block) => !completedToolUseIds.has(block.toolUseId))
    }

    const collectedInterrupts: Interrupt[] = []

    for (const toolUseBlock of toolUsesToProcess) {
      const { toolResultBlock, interrupts } = yield* this.executeTool(toolUseBlock, toolRegistry, parentSpan)

      if (interrupts.length > 0) {
        collectedInterrupts.push(...interrupts)
        // Stop processing more tools when interrupted.
        // Do NOT store the error placeholder — the interrupted tool must re-execute on resume.
        break
      }

      toolResultBlocks.push(toolResultBlock)
      yield toolResultBlock
    }

    // Create user message with tool results
    const toolResultMessage: Message = new Message({
      role: 'user',
      content: toolResultBlocks,
    })

    yield new AfterToolsEvent({ agent: this, message: toolResultMessage })

    return { toolResultMessage, interrupts: collectedInterrupts }
  }

  /**
   * Executes a single tool and returns the result.
   * If the tool is not found or fails to return a result, returns an error ToolResult
   * instead of throwing an exception. This allows the agent loop to continue and
   * let the model handle the error gracefully.
   *
   * Invokes BeforeToolCallEvent hooks directly (not via the stream() outer method)
   * to support interrupt detection at the point of tool execution.
   *
   * @param toolUseBlock - Tool use block to execute
   * @param toolRegistry - Registry containing available tools
   * @returns Object containing the tool result block and any interrupts raised
   */
  private async *executeTool(
    toolUseBlock: ToolUseBlock,
    toolRegistry: ToolRegistry,
    parentSpan?: Span
  ): AsyncGenerator<AgentStreamEvent, { toolResultBlock: ToolResultBlock; interrupts: Interrupt[] }, undefined> {
    const tool = toolRegistry.find((t) => t.name === toolUseBlock.name)
    const toolStartTime = Date.now()

    // Create toolUse object for hook events
    const toolUse = {
      name: toolUseBlock.name,
      toolUseId: toolUseBlock.toolUseId,
      input: toolUseBlock.input,
    }

    // Start tool trace span
    const toolSpan = this._tracer.startToolCallSpan({
      toolUse,
      parentSpan,
      customTraceAttributes: this._traceAttributes,
    })

    // Retry loop for tool execution
    while (true) {
      const beforeToolCallEvent = new BeforeToolCallEvent({ agent: this, toolUse, tool })

      // Invoke hooks directly to capture interrupts at the point of tool execution
      const { interrupts } = await this.hooks.invokeCallbacks(beforeToolCallEvent)
      yield beforeToolCallEvent

      // If hooks raised interrupts, stop tool execution immediately
      if (interrupts.length > 0) {
        this._tracer.endToolCallSpan({ span: toolSpan, toolResult: undefined })
        return {
          toolResultBlock: new ToolResultBlock({
            toolUseId: toolUseBlock.toolUseId,
            status: 'error',
            content: [new TextBlock('Tool execution interrupted')],
          }),
          interrupts,
        }
      }

      // Check if a hook cancelled the tool call
      if (beforeToolCallEvent.cancelTool) {
        const cancelMessage =
          typeof beforeToolCallEvent.cancelTool === 'string' ? beforeToolCallEvent.cancelTool : 'Tool call cancelled'

        const cancelledResult = new ToolResultBlock({
          toolUseId: toolUseBlock.toolUseId,
          status: 'error',
          content: [new TextBlock(cancelMessage)],
        })

        this._tracer.endToolCallSpan({
          span: toolSpan,
          toolResult: {
            toolUseId: cancelledResult.toolUseId,
            status: cancelledResult.status,
            content: cancelledResult.content,
          },
        })
        yield new AfterToolCallEvent({ agent: this, toolUse, tool, result: cancelledResult })
        return { toolResultBlock: cancelledResult, interrupts: [] }
      }

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
        // Execute tool and collect result
        const interruptState = this._interruptState
        const toolContext: ToolContext = {
          toolUse: {
            name: toolUseBlock.name,
            toolUseId: toolUseBlock.toolUseId,
            input: toolUseBlock.input,
          },
          agent: this,
          interrupt(name: string, reason?: unknown, response?: unknown): unknown {
            const id = `v1:tool_call:${toolUseBlock.toolUseId}:${uuidv5(name, UUID_NAMESPACE_OID)}`

            let interrupt = interruptState.interrupts.get(id)
            if (interrupt === undefined) {
              interrupt = new Interrupt({ id, name, reason: reason ?? null, response: response ?? null })
              interruptState.interrupts.set(id, interrupt)
            }

            if (interrupt.response !== null) {
              return interrupt.response
            }

            throw new InterruptException(interrupt)
          },
        }

        try {
          const result = yield* tool.stream(toolContext)

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
          if (e instanceof InterruptException) {
            // Tool raised an interrupt — collect it and stop tool execution
            this._tracer.endToolCallSpan({ span: toolSpan, toolResult: undefined })
            return {
              toolResultBlock: new ToolResultBlock({
                toolUseId: toolUseBlock.toolUseId,
                status: 'error',
                content: [new TextBlock('Tool execution interrupted')],
              }),
              interrupts: [e.interrupt],
            }
          }
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

      const toolDuration = (Date.now() - toolStartTime) / 1000
      MetricsClient.getInstance().recordToolMetrics({
        toolName: toolUseBlock.name,
        duration: toolDuration,
        success: toolResult.status === 'success',
      })

      this._tracer.endToolCallSpan({
        span: toolSpan,
        toolResult: { toolUseId: toolResult.toolUseId, status: toolResult.status, content: toolResult.content },
        error,
      })
      return { toolResultBlock: toolResult, interrupts: [] }
    }
  }

  /**
   * Appends a message to the conversation history, invokes MessageAddedEvent hook,
   * and returns the event for yielding.
   *
   * @param message - The message to append
   * @returns MessageAddedEvent to be yielded (hook already invoked)
   */
  private async _appendMessage(message: Message): Promise<MessageAddedEvent> {
    this.messages.push(message)
    const event = new MessageAddedEvent({ agent: this, message })
    // Invoke hooks immediately for message tracking
    await this.hooks.invokeCallbacks(event)
    // Return event for yielding (stream will skip hook invocation for MessageAddedEvent)
    return event
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
