import {
  AgentResult,
  type AgentStreamEvent,
  type InvokableAgent,
  type InvokeArgs,
  type InvokeOptions,
  type LocalAgent,
  type localAgentSymbol,
} from '../types/agent.js'
import { BedrockModel } from '../models/bedrock.js'
import {
  contentBlockFromData,
  type ContentBlock,
  type ContentBlockData,
  Message,
  type MessageData,
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
import { normalizeError, ConcurrentInvocationError, StructuredOutputError } from '../errors.js'
import { Model } from '../models/model.js'
import type { BaseModelConfig, StreamAggregatedResult, StreamOptions } from '../models/model.js'
import { isModelStreamEvent } from '../models/streaming.js'
import { ToolRegistry } from '../registry/tool-registry.js'
import { StateStore } from '../state-store.js'
import { AgentPrinter, getDefaultAppender, type Printer } from './printer.js'
import type { Plugin } from '../plugins/plugin.js'
import { PluginRegistry } from '../plugins/registry.js'
import { SlidingWindowConversationManager } from '../conversation-manager/sliding-window-conversation-manager.js'
import { ConversationManager } from '../conversation-manager/conversation-manager.js'
import { HookRegistryImplementation } from '../hooks/registry.js'
import type { HookableEventConstructor, HookCallback, HookCleanup } from '../hooks/types.js'
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
  type ModelStopData,
} from '../hooks/events.js'
import { StructuredOutputTool, STRUCTURED_OUTPUT_TOOL_NAME } from '../tools/structured-output-tool.js'
import { AgentAsTool } from './agent-as-tool.js'
import type { AgentAsToolOptions } from './agent-as-tool.js'

import type { z } from 'zod'
import { SessionManager } from '../session/session-manager.js'
import { Tracer } from '../telemetry/tracer.js'
import { Meter } from '../telemetry/meter.js'
import type { AttributeValue } from '@opentelemetry/api'
import { logger } from '../logging/logger.js'
import { CancelledError } from '../errors.js'

/**
 * Recursive type definition for nested tool arrays.
 * Allows tools to be organized in nested arrays of any depth.
 *
 * {@link Agent} instances in the array are automatically wrapped via
 * {@link Agent.asTool}, so they can be passed directly without calling
 * `.asTool()` explicitly.
 */
export type ToolList = (Tool | McpClient | Agent | ToolList)[]

/**
 * Strategy for executing tool calls that the model emits in a single assistant turn.
 *
 * - `'sequential'` (default) — runs tool calls one at a time, matching the historical
 *   behavior of the agent loop.
 * - `'concurrent'` — runs all tool calls from a single turn in parallel. Per-tool event
 *   order (`BeforeToolCallEvent` → `ToolStreamUpdateEvent*` → `AfterToolCallEvent` →
 *   `ToolResultEvent`) is preserved, while cross-tool events may interleave.
 *
 * Cancellation works identically in both modes: {@link Agent.cancel} flips
 * {@link Agent.cancelSignal} and tools must observe it cooperatively to stop early.
 * In concurrent mode, prompt batch-wide cancellation requires every in-flight tool
 * to honor the signal.
 */
export type ToolExecutor = 'sequential' | 'concurrent'

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
   * {@link Agent} instances are automatically wrapped as tools via {@link Agent.asTool}.
   */
  tools?: ToolList
  /**
   * A system prompt which guides model behavior.
   */
  systemPrompt?: SystemPrompt | SystemPromptData
  /** Optional initial state values for the agent. */
  appState?: Record<string, JSONValue>
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
   * Plugins to register with the agent.
   */
  plugins?: Plugin[]
  /**
   * Zod schema for structured output validation.
   */
  structuredOutputSchema?: z.ZodSchema
  /**
   * Session manager for saving and restoring agent sessions
   */
  sessionManager?: SessionManager
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
   * Optional description of what the agent does.
   */
  description?: string
  /**
   * Optional unique identifier for the agent. Defaults to "agent".
   */
  id?: string
  /**
   * Strategy for executing tool calls from a single assistant turn.
   * Defaults to `'sequential'`. See {@link ToolExecutor} for details.
   */
  toolExecutor?: ToolExecutor
}

/** Default name assigned to agents when none is provided. */
const DEFAULT_AGENT_NAME = 'Strands Agent'

/** Default identifier assigned to agents when none is provided. */
const DEFAULT_AGENT_ID = 'agent'

/**
 * Orchestrates the interaction between a model, a set of tools, and MCP clients.
 * The Agent is responsible for managing the lifecycle of tools and clients
 * and invoking the core decision-making loop.
 */
export class Agent implements LocalAgent, InvokableAgent {
  /** @internal */
  declare readonly [localAgentSymbol]: true

  /**
   * The conversation history of messages between user and assistant.
   */
  public messages: Message[]
  /**
   * App state storage accessible to tools and application logic.
   * State is not passed to the model during inference.
   */
  public readonly appState: StateStore
  private readonly _conversationManager: ConversationManager

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
  public readonly id: string

  /**
   * Optional description of what the agent does.
   */
  public readonly description?: string

  /**
   * The session manager for saving and restoring agent sessions, if configured.
   */
  public readonly sessionManager?: SessionManager | undefined

  private readonly _hooksRegistry: HookRegistryImplementation
  private readonly _pluginRegistry: PluginRegistry
  private _toolRegistry: ToolRegistry
  private _mcpClients: McpClient[]
  private _initialized: boolean
  private _isInvoking: boolean = false
  private _abortController = new AbortController()
  private _abortSignal: AbortSignal = this._abortController.signal
  private _printer?: Printer
  private _structuredOutputSchema?: z.ZodSchema | undefined
  /** Tracer instance for creating and managing OpenTelemetry spans. */
  private _tracer: Tracer
  /** Meter instance for accumulating loop metrics during invocation. */
  private _meter: Meter
  private readonly _toolExecutor: ToolExecutor

  /**
   * Creates an instance of the Agent.
   * @param config - The configuration for the agent.
   */
  constructor(config?: AgentConfig) {
    // Initialize public fields
    this.messages = (config?.messages ?? []).map((msg) => (msg instanceof Message ? msg : Message.fromMessageData(msg)))
    this.appState = new StateStore(config?.appState)
    this._conversationManager = config?.conversationManager ?? new SlidingWindowConversationManager({ windowSize: 40 })
    this.name = config?.name ?? DEFAULT_AGENT_NAME
    this.id = config?.id ?? DEFAULT_AGENT_ID
    if (config?.description !== undefined) this.description = config.description
    this.sessionManager = config?.sessionManager

    if (typeof config?.model === 'string') {
      this.model = new BedrockModel({ modelId: config.model })
    } else {
      this.model = config?.model ?? new BedrockModel()
    }

    const { tools, mcpClients } = flattenTools(config?.tools ?? [])
    this._toolRegistry = new ToolRegistry(tools)
    this._mcpClients = mcpClients

    // Initialize hooks registry
    this._hooksRegistry = new HookRegistryImplementation()

    // Initialize plugin registry with all plugins to be initialized during initialize()
    this._pluginRegistry = new PluginRegistry([
      this._conversationManager,
      ...(config?.plugins ?? []),
      ...(config?.sessionManager ? [config.sessionManager] : []),
    ])

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

    // Initialize meter for local metrics accumulation
    this._meter = new Meter()

    // Default to sequential tool execution
    this._toolExecutor = config?.toolExecutor ?? 'sequential'

    this._initialized = false
  }

  /**
   * Register a hook callback for a specific event type.
   *
   * @param eventType - The event class constructor to register the callback for
   * @param callback - The callback function to invoke when the event occurs
   * @returns Cleanup function that removes the callback when invoked
   *
   * @example
   * ```typescript
   * const agent = new Agent({ model })
   *
   * const cleanup = agent.addHook(BeforeInvocationEvent, (event) => {
   *   console.log('Invocation started')
   * })
   *
   * // Later, to remove the hook:
   * cleanup()
   * ```
   */
  addHook<T extends HookableEvent>(eventType: HookableEventConstructor<T>, callback: HookCallback<T>): HookCleanup {
    return this._hooksRegistry.addCallback(eventType, callback)
  }

  public async initialize(): Promise<void> {
    if (this._initialized) {
      return
    }

    // Initialize MCP clients and register their tools
    await Promise.all(
      this._mcpClients.map(async (client) => {
        const tools = await client.listTools()
        this._toolRegistry.add(tools)
      })
    )

    await this._pluginRegistry.initialize(this)

    await this._hooksRegistry.invokeCallbacks(new InitializedEvent({ agent: this }))

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
   * Throws {@link CancelledError} if cancellation has been requested.
   * Called at cancellation checkpoints within the agent loop.
   */
  private _throwIfCancelled(): void {
    if (this.isCancelled) {
      throw new CancelledError()
    }
  }

  /**
   * The tools this agent can use.
   */
  get tools(): Tool[] {
    return this._toolRegistry.list()
  }

  /**
   * The tool registry for managing the agent's tools.
   */
  get toolRegistry(): ToolRegistry {
    return this._toolRegistry
  }

  /**
   * The cancellation signal for the current invocation.
   *
   * Tools can pass this to cancellable operations (e.g., `fetch(url, { signal: agent.cancelSignal })`).
   * Hooks can check `event.agent.cancelSignal.aborted` to detect cancellation.
   */
  get cancelSignal(): AbortSignal {
    return this._abortSignal
  }

  /**
   * Cancels the current agent invocation cooperatively.
   *
   * The agent will stop at the next cancellation checkpoint:
   * - During model response streaming
   * - Before tool execution
   * - Between sequential tool executions
   * - At the top of each agent loop cycle
   *
   * If a tool is already executing, it will run to completion unless
   * the tool checks {@link LocalAgent.cancelSignal | cancelSignal} internally.
   *
   * Hook callbacks can check `event.agent.cancelSignal.aborted` to detect
   * cancellation and adjust their behavior accordingly.
   *
   * The stream/invoke call will return an AgentResult with `stopReason: 'cancelled'`.
   * If the agent is not currently invoking, this is a no-op.
   *
   * @example
   * ```typescript
   * const agent = new Agent({ model, tools })
   *
   * // Cancel after 5 seconds
   * setTimeout(() => agent.cancel(), 5000)
   * const result = await agent.invoke('Do something')
   * console.log(result.stopReason) // 'cancelled'
   * ```
   */
  public cancel(): void {
    if (this._isInvoking) {
      this._abortController.abort()
    }
  }

  /**
   * Whether the current invocation has been cancelled.
   * Returns `false` when the agent is idle.
   */
  private get isCancelled(): boolean {
    return this._abortSignal.aborted
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

    // Create AbortController for this invocation and compose with external signal
    this._abortController = new AbortController()
    this._abortSignal = options?.cancelSignal
      ? AbortSignal.any([this._abortController.signal, options.cancelSignal])
      : this._abortController.signal

    await this.initialize()

    // Delegate to _stream and process events through printer and hooks
    const streamGenerator = this._stream(args, options)
    let caughtError: Error | undefined
    try {
      let result = await streamGenerator.next()

      while (!result.done) {
        yield await this._invokeCallbacks(result.value)
        result = await streamGenerator.next()
      }

      yield await this._invokeCallbacks(new AgentResultEvent({ agent: this, result: result.value }))

      return result.value
    } catch (error) {
      caughtError = error as Error
      throw error
    } finally {
      // Drain _stream() so cleanup hooks and printer still fire.
      // Yield only on error (consumer may still be iterating); on a consumer
      // break, yielding would suspend the generator and leak the lock.
      let result = await streamGenerator.return(undefined as never)
      while (!result.done) {
        try {
          if (caughtError) {
            yield await this._invokeCallbacks(result.value)
          } else {
            await this._invokeCallbacks(result.value)
          }
        } catch (error) {
          logger.warn(`event_type=<${result.value.type}>, error=<${error}> | error invoking callbacks during cleanup`)
        }
        result = await streamGenerator.next()
      }

      // Reset controller and signal for next invocation
      this._abortController = new AbortController()
      this._abortSignal = this._abortController.signal
    }
  }

  /**
   * Returns a {@link Tool} that wraps this agent, allowing it to be used
   * as a tool by another agent.
   *
   * The returned tool accepts a single `input` string parameter, invokes
   * this agent, and returns the text response as a tool result.
   *
   * **Note:** You can also pass an Agent directly in another agent's
   * {@link AgentConfig.tools | tools} array — it will be wrapped
   * automatically via this method.
   *
   * @param options - Optional configuration for the tool name, description, and context preservation
   * @returns A Tool wrapping this agent
   *
   * @example
   * ```typescript
   * const researcher = new Agent({ name: 'researcher', description: 'Finds info', printer: false })
   *
   * // Explicit wrapping
   * const writer = new Agent({ tools: [researcher.asTool()] })
   *
   * // Automatic wrapping (equivalent)
   * const writer = new Agent({ tools: [researcher] })
   * ```
   */
  public asTool(options?: AgentAsToolOptions): Tool {
    return new AgentAsTool({ agent: this, ...options })
  }

  /**
   * Invokes hook callbacks and printer for a stream event.
   *
   * @param event - The event to process
   * @returns The event after processing
   */
  private async _invokeCallbacks(event: AgentStreamEvent): Promise<AgentStreamEvent> {
    if (event instanceof HookableEvent) {
      await this._hooksRegistry.invokeCallbacks(event)
    }
    this._printer?.processEvent(event)
    return event
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
    let result: AgentResult | undefined

    // Resolve structured output schema from per-invocation options or constructor config
    const structuredOutputSchema = options?.structuredOutputSchema ?? this._structuredOutputSchema
    const structuredOutputTool = structuredOutputSchema ? new StructuredOutputTool(structuredOutputSchema) : undefined
    let structuredOutputChoice: ToolChoice | undefined

    // Emit event before the try block
    yield new BeforeInvocationEvent({ agent: this })

    // Normalize input to get the user messages for telemetry
    const inputMessages = this._normalizeInput(args)

    // Start agent trace span
    this._meter.startNewInvocation()
    const agentModelId = this.model.modelId
    const agentSpanOptions: Parameters<Tracer['startAgentSpan']>[0] = {
      messages: inputMessages,
      agentName: this.name,
      agentId: this.id,
      tools: this.tools,
    }
    if (agentModelId) agentSpanOptions.modelId = agentModelId
    if (this.systemPrompt !== undefined) agentSpanOptions.systemPrompt = this.systemPrompt
    const agentSpan = this._tracer.startAgentSpan(agentSpanOptions)

    let caughtError: Error | undefined
    try {
      // Register structured output tool if schema provided
      if (structuredOutputTool) {
        this._toolRegistry.add(structuredOutputTool)
      }

      // Main agent loop - continues until model stops without requesting tools
      while (true) {
        this._throwIfCancelled()

        // Start metrics cycle tracking
        const { cycleId, startTime: cycleStartTime } = this._meter.startCycle()

        // Create agent loop cycle span within agent span context
        const cycleSpan = this._tracer.startAgentLoopSpan({
          cycleId,
          messages: this.messages,
        })

        try {
          // Normalize input and append user messages on first invocation only
          if (currentArgs !== undefined) {
            const messagesToAppend = this._normalizeInput(currentArgs)
            for (const message of messagesToAppend) {
              yield this._appendMessage(message)
            }
            currentArgs = undefined
          }

          const modelResult = yield* this._invokeModel(structuredOutputChoice)

          if (modelResult.stopReason !== 'toolUse') {
            // If structured output is required, force it
            if (structuredOutputTool) {
              if (structuredOutputChoice) {
                throw new StructuredOutputError(
                  'The model failed to invoke the structured output tool even after it was forced.'
                )
              }

              structuredOutputChoice = { tool: { name: STRUCTURED_OUTPUT_TOOL_NAME } }
            }

            this._meter.endCycle(cycleStartTime)
            this._tracer.endAgentLoopSpan(cycleSpan)

            yield this._appendMessage(modelResult.message)

            if (structuredOutputChoice) {
              continue
            }

            result = new AgentResult({
              stopReason: modelResult.stopReason,
              lastMessage: modelResult.message,
              traces: this._tracer.localTraces,
              metrics: this._meter.metrics,
            })
            return result
          }

          // Cancel before tool execution: create error results for all pending tools
          if (this.isCancelled) {
            const toolUseBlocks = modelResult.message.content.filter(
              (block): block is ToolUseBlock => block.type === 'toolUseBlock'
            )
            const cancelBlocks = toolUseBlocks.map(
              (block) =>
                new ToolResultBlock({
                  toolUseId: block.toolUseId,
                  status: 'error',
                  content: [new TextBlock('Tool execution cancelled')],
                })
            )
            const toolResultMessage = new Message({ role: 'user', content: cancelBlocks })

            yield this._appendMessage(modelResult.message)
            yield this._appendMessage(toolResultMessage)

            this._meter.endCycle(cycleStartTime)
            this._tracer.endAgentLoopSpan(cycleSpan)

            result = new AgentResult({
              stopReason: 'cancelled',
              lastMessage: modelResult.message,
              traces: this._tracer.localTraces,
              metrics: this._meter.metrics,
            })
            return result
          }

          // Execute tools
          const toolResultMessage = yield* this.executeTools(modelResult.message, this._toolRegistry)

          /**
           * Deferred append: both messages are added AFTER tool execution completes.
           * This keeps agent.messages in a valid, reinvokable state at all times.
           * If interrupted during tool execution, messages has no dangling toolUse
           * without a matching toolResult, so the agent can be reinvoked cleanly.
           */
          yield this._appendMessage(modelResult.message)
          yield this._appendMessage(toolResultMessage)

          this._meter.endCycle(cycleStartTime)
          this._tracer.endAgentLoopSpan(cycleSpan)

          // Structured output captured: exit
          const structuredOutput = structuredOutputTool
            ? this._extractStructuredOutput(modelResult.message, toolResultMessage)
            : undefined
          if (structuredOutput !== undefined) {
            result = new AgentResult({
              stopReason: modelResult.stopReason,
              lastMessage: modelResult.message,
              traces: this._tracer.localTraces,
              structuredOutput,
              metrics: this._meter.metrics,
            })
            return result
          }
        } catch (error) {
          this._meter.endCycle(cycleStartTime)
          this._tracer.endAgentLoopSpan(cycleSpan, { error: error as Error })
          throw error
        }
      }
    } catch (error) {
      if (error instanceof CancelledError) {
        // Cancelled during model streaming or at the top of a cycle.
        // No partial messages have been appended (deferred append pattern).
        const cancelMessage = new Message({
          role: 'assistant',
          content: [new TextBlock('Cancelled by user')],
        })
        yield this._appendMessage(cancelMessage)

        result = new AgentResult({
          stopReason: 'cancelled',
          lastMessage: cancelMessage,
          traces: this._tracer.localTraces,
          metrics: this._meter.metrics,
        })
        return result
      }
      caughtError = error as Error
      throw error
    } finally {
      // If cancelled but the catch block was bypassed (generator terminated
      // via .return() when the consumer breaks out of for-await), append an
      // assistant message so the agent can be reinvoked with a new user prompt.
      if (!caughtError && !result && this.isCancelled) {
        const cancelMessage = new Message({
          role: 'assistant',
          content: [new TextBlock('Cancelled by user')],
        })
        yield this._appendMessage(cancelMessage)
      }

      this._tracer.endAgentSpan(agentSpan, {
        ...(caughtError && { error: caughtError }),
        ...(result?.lastMessage && { response: result.lastMessage }),
        accumulatedUsage: this._meter.metrics.accumulatedUsage,
        ...(result?.stopReason && { stopReason: result.stopReason }),
      })

      // Cleanup structured output tool
      if (structuredOutputTool) {
        this._toolRegistry.remove(STRUCTURED_OUTPUT_TOOL_NAME)
      }

      // Always emit final event
      yield new AfterInvocationEvent({ agent: this })
    }
  }

  /**
   * Extracts the validated structured output result from tool execution.
   *
   * @param toolUseMessage - The assistant message containing tool use blocks
   * @param toolResultMessage - The message containing tool results
   * @returns The parsed structured output, or undefined if not found
   */
  private _extractStructuredOutput(toolUseMessage: Message, toolResultMessage: Message): unknown | undefined {
    const toolUse = toolUseMessage.content.find(
      (block): block is ToolUseBlock => block.type === 'toolUseBlock' && block.name === STRUCTURED_OUTPUT_TOOL_NAME
    )
    if (!toolUse) return undefined

    const toolResult = toolResultMessage.content.find(
      (block): block is ToolResultBlock =>
        block.type === 'toolResultBlock' && block.toolUseId === toolUse.toolUseId && block.status === 'success'
    )
    if (!toolResult) return undefined

    const firstContent = toolResult.content[0]
    return firstContent?.type === 'jsonBlock' ? firstContent.json : undefined
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
   * @returns Object containing the assistant message, stop reason, and optional redaction message
   */
  private async *_invokeModel(
    toolChoice?: ToolChoice
  ): AsyncGenerator<AgentStreamEvent, StreamAggregatedResult, undefined> {
    const toolSpecs = this._toolRegistry.list().map((tool) => tool.toolSpec)
    const streamOptions: StreamOptions = { toolSpecs }
    if (this.systemPrompt !== undefined) {
      streamOptions.systemPrompt = this.systemPrompt
    }

    // Add tool choice if provided
    if (toolChoice) {
      streamOptions.toolChoice = toolChoice
    }

    yield new BeforeModelCallEvent({ agent: this, model: this.model })

    // Start model span within loop span context
    const modelId = this.model.modelId
    const modelSpan = this._tracer.startModelInvokeSpan({
      messages: this.messages,
      ...(modelId && { modelId }),
      ...(this.systemPrompt !== undefined && { systemPrompt: this.systemPrompt }),
    })

    try {
      const result = yield* this._streamFromModel(this.messages, streamOptions)

      // Accumulate token usage and model latency metrics
      this._meter.updateCycle(result.metadata)

      // End model span with usage
      const usage = result.metadata?.usage
      const metrics = result.metadata?.metrics
      this._tracer.endModelInvokeSpan(modelSpan, {
        output: result.message,
        stopReason: result.stopReason,
        ...(usage && { usage }),
        ...(metrics && { metrics }),
      })

      yield new ModelMessageEvent({ agent: this, message: result.message, stopReason: result.stopReason })

      // Handle user content redaction if guardrails blocked input
      if (result.redaction?.userMessage) {
        this._redactLastMessage(result.redaction.userMessage)
      }

      const stopData: ModelStopData = {
        message: result.message,
        stopReason: result.stopReason,
        ...(result.redaction && { redaction: result.redaction }),
      }

      const afterModelCallEvent = new AfterModelCallEvent({ agent: this, model: this.model, stopData })
      yield afterModelCallEvent

      if (afterModelCallEvent.retry) {
        return yield* this._invokeModel(toolChoice)
      }

      return result
    } catch (error) {
      const modelError = normalizeError(error)

      // End model span with error
      this._tracer.endModelInvokeSpan(modelSpan, { error: modelError })

      // Create error event
      const errorEvent = new AfterModelCallEvent({ agent: this, model: this.model, error: modelError })

      // Yield error event - stream will invoke hooks
      yield errorEvent

      // Let CancelledError propagate directly — no retry
      // (we emit the AfterModelCall because we already emitted Before and we guarentee the pair)
      if (error instanceof CancelledError) {
        throw error
      }

      // After yielding, hooks have been invoked and may have set retry
      if (errorEvent.retry) {
        return yield* this._invokeModel(toolChoice)
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
   * @returns StreamAggregatedResult containing message, stop reason, and optional redaction message
   */
  private async *_streamFromModel(
    messages: Message[],
    streamOptions: StreamOptions
  ): AsyncGenerator<AgentStreamEvent, StreamAggregatedResult, undefined> {
    const streamGenerator = this.model.streamAggregated(messages, streamOptions)
    let result = await streamGenerator.next()

    while (!result.done) {
      this._throwIfCancelled()

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
    return result.value
  }

  /**
   * Dispatches to the configured tool executor. See {@link ToolExecutor}.
   *
   * @param assistantMessage - The assistant message containing tool use blocks
   * @param toolRegistry - Registry containing available tools
   * @returns User message containing tool results
   */
  private async *executeTools(
    assistantMessage: Message,
    toolRegistry: ToolRegistry
  ): AsyncGenerator<AgentStreamEvent, Message, undefined> {
    switch (this._toolExecutor) {
      case 'sequential':
        return yield* this._executeToolsSequential(assistantMessage, toolRegistry)
      case 'concurrent':
        return yield* this._executeToolsConcurrent(assistantMessage, toolRegistry)
      default: {
        const _exhaustive: never = this._toolExecutor
        throw new Error(`Unknown toolExecutor: ${_exhaustive as string}`)
      }
    }
  }

  /**
   * Executes tools sequentially and streams all tool events.
   */
  private async *_executeToolsSequential(
    assistantMessage: Message,
    toolRegistry: ToolRegistry
  ): AsyncGenerator<AgentStreamEvent, Message, undefined> {
    const beforeToolsEvent = new BeforeToolsEvent({ agent: this, message: assistantMessage })
    yield beforeToolsEvent

    const toolResultBlocks: ToolResultBlock[] = []
    let toolResultMessage: Message

    try {
      // Extract tool use blocks from assistant message
      const toolUseBlocks = assistantMessage.content.filter(
        (block): block is ToolUseBlock => block.type === 'toolUseBlock'
      )

      if (toolUseBlocks.length === 0) {
        // No tool use blocks found even though stopReason is toolUse
        throw new Error('Model indicated toolUse but no tool use blocks found in message')
      }

      // Pre-launch cancel: hook requested cancel, or agent is already cancelled.
      if (beforeToolsEvent.cancel) {
        const message = typeof beforeToolsEvent.cancel === 'string' ? beforeToolsEvent.cancel : 'Tool cancelled by hook'
        const cancelBlocks = this._cancelAllAsResults(toolUseBlocks, message)
        for (const result of cancelBlocks) {
          yield new ToolResultEvent({ agent: this, result })
        }
        toolResultBlocks.push(...cancelBlocks)
      } else if (this.isCancelled) {
        const cancelBlocks = this._cancelAllAsResults(toolUseBlocks, 'Tool execution cancelled')
        for (const result of cancelBlocks) {
          yield new ToolResultEvent({ agent: this, result })
        }
        toolResultBlocks.push(...cancelBlocks)
      } else {
        for (const toolUseBlock of toolUseBlocks) {
          if (this.isCancelled) {
            const cancelBlock = new ToolResultBlock({
              toolUseId: toolUseBlock.toolUseId,
              status: 'error',
              content: [new TextBlock('Tool execution cancelled')],
            })
            toolResultBlocks.push(cancelBlock)
            yield new ToolResultEvent({ agent: this, result: cancelBlock })
            continue
          }

          const toolResultBlock = yield* this.executeTool(toolUseBlock, toolRegistry)
          toolResultBlocks.push(toolResultBlock)
          yield new ToolResultEvent({ agent: this, result: toolResultBlock })
        }
      }
    } finally {
      toolResultMessage = new Message({
        role: 'user',
        content: toolResultBlocks,
      })

      yield new AfterToolsEvent({ agent: this, message: toolResultMessage })
    }

    return toolResultMessage
  }

  /**
   * Produces one error ToolResultBlock per tool use block, each carrying
   * `message` as its error text. Shared by pre-launch cancel paths.
   */
  private _cancelAllAsResults(toolUseBlocks: ToolUseBlock[], message: string): ToolResultBlock[] {
    return toolUseBlocks.map(
      (block) =>
        new ToolResultBlock({
          toolUseId: block.toolUseId,
          status: 'error',
          content: [new TextBlock(message)],
        })
    )
  }

  /**
   * Executes tools concurrently by merging N per-tool {@link executeTool}
   * async generators via `Promise.race`. Per-tool event order is preserved
   * (because each generator is iterated serially); cross-tool events may
   * interleave at race resolution boundaries.
   *
   * Per-tool retry (`AfterToolCallEvent.retry`) is isolated — it lives inside
   * `executeTool`'s own `while(true)` loop, so one tool retrying does not
   * disturb its siblings.
   */
  private async *_executeToolsConcurrent(
    assistantMessage: Message,
    toolRegistry: ToolRegistry
  ): AsyncGenerator<AgentStreamEvent, Message, undefined> {
    const beforeToolsEvent = new BeforeToolsEvent({ agent: this, message: assistantMessage })
    yield beforeToolsEvent

    const toolUseBlocks = assistantMessage.content.filter(
      (block): block is ToolUseBlock => block.type === 'toolUseBlock'
    )

    if (toolUseBlocks.length === 0) {
      throw new Error('Model indicated toolUse but no tool use blocks found in message')
    }

    let toolResultMessage: Message

    // Pre-launch cancel: hook requested cancel, or agent is already cancelled.
    if (beforeToolsEvent.cancel) {
      const message = typeof beforeToolsEvent.cancel === 'string' ? beforeToolsEvent.cancel : 'Tool cancelled by hook'
      const cancelBlocks = this._cancelAllAsResults(toolUseBlocks, message)
      for (const result of cancelBlocks) {
        yield new ToolResultEvent({ agent: this, result })
      }
      toolResultMessage = new Message({ role: 'user', content: cancelBlocks })
      yield new AfterToolsEvent({ agent: this, message: toolResultMessage })
      return toolResultMessage
    }
    if (this.isCancelled) {
      const cancelBlocks = this._cancelAllAsResults(toolUseBlocks, 'Tool execution cancelled')
      for (const result of cancelBlocks) {
        yield new ToolResultEvent({ agent: this, result })
      }
      toolResultMessage = new Message({ role: 'user', content: cancelBlocks })
      yield new AfterToolsEvent({ agent: this, message: toolResultMessage })
      return toolResultMessage
    }

    // Wrap each in-flight `.next()` so the raced promise always resolves to a
    // tagged Step. That prevents one generator rejection from rejecting the
    // whole race and lets us convert per-tool failures into ToolResultBlocks
    // without orphaning other generators.
    type Step =
      | { i: number; kind: 'next'; r: IteratorResult<AgentStreamEvent, ToolResultBlock> }
      | { i: number; kind: 'throw'; error: unknown }

    const gens = toolUseBlocks.map((block) => ({
      block,
      gen: this.executeTool(block, toolRegistry),
    }))

    const step = (i: number): Promise<Step> =>
      gens[i]!.gen.next().then(
        (r): Step => ({ i, kind: 'next', r }),
        (error: unknown): Step => ({ i, kind: 'throw', error })
      )

    const pendingNext = new Map<number, Promise<Step>>(gens.map((_, i) => [i, step(i)]))
    const resultsByToolUseId = new Map<string, ToolResultBlock>()

    try {
      while (pendingNext.size > 0) {
        const winner = await Promise.race(pendingNext.values())
        const { i } = winner
        const block = gens[i]!.block

        if (winner.kind === 'throw') {
          pendingNext.delete(i)
          const err = normalizeError(winner.error)
          const result = new ToolResultBlock({
            toolUseId: block.toolUseId,
            status: 'error',
            content: [new TextBlock(err.message)],
            error: err,
          })
          resultsByToolUseId.set(block.toolUseId, result)
          yield new ToolResultEvent({ agent: this, result })
          continue
        }

        if (winner.r.done) {
          pendingNext.delete(i)
          resultsByToolUseId.set(block.toolUseId, winner.r.value)
          yield new ToolResultEvent({ agent: this, result: winner.r.value })
        } else {
          yield winner.r.value
          pendingNext.set(i, step(i))
        }
      }
    } finally {
      // Close any generators still in-flight (e.g. consumer broke out of stream).
      await Promise.allSettled(
        Array.from(pendingNext.keys(), (i) => gens[i]!.gen.return(undefined as unknown as ToolResultBlock))
      )

      // Build the result message from whatever completed, in source order.
      // Missing entries get a fallback error block so the message always
      // accounts for every toolUseBlock the model emitted.
      const toolResultBlocks: ToolResultBlock[] = []
      for (const block of toolUseBlocks) {
        const result = resultsByToolUseId.get(block.toolUseId)
        if (result) {
          toolResultBlocks.push(result)
        } else {
          toolResultBlocks.push(
            new ToolResultBlock({
              toolUseId: block.toolUseId,
              status: 'error',
              content: [new TextBlock('Tool execution interrupted')],
            })
          )
        }
      }

      toolResultMessage = new Message({ role: 'user', content: toolResultBlocks })
      yield new AfterToolsEvent({ agent: this, message: toolResultMessage })
    }

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
    const tool = toolRegistry.get(toolUseBlock.name)

    // Create toolUse object for hook events and telemetry
    const toolUse = {
      name: toolUseBlock.name,
      toolUseId: toolUseBlock.toolUseId,
      input: toolUseBlock.input,
    }

    // Retry loop for tool execution
    while (true) {
      const beforeToolCallEvent = new BeforeToolCallEvent({ agent: this, toolUse, tool })
      yield beforeToolCallEvent

      // Cancel individual tool if hook requested it
      if (beforeToolCallEvent.cancel) {
        const cancelMessage =
          typeof beforeToolCallEvent.cancel === 'string' ? beforeToolCallEvent.cancel : 'Tool cancelled by hook'
        const toolResult = new ToolResultBlock({
          toolUseId: toolUseBlock.toolUseId,
          status: 'error',
          content: [new TextBlock(cancelMessage)],
        })
        const afterToolCallEvent = new AfterToolCallEvent({
          agent: this,
          toolUse,
          tool,
          result: toolResult,
        })
        yield afterToolCallEvent
        if (afterToolCallEvent.retry) {
          continue
        }
        return toolResult
      }

      // Start tool span within loop span context
      const toolSpan = this._tracer.startToolCallSpan({
        tool: toolUse,
      })

      // Track tool execution time for metrics
      const toolStartTime = Date.now()

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

      // End tool metrics tracking
      this._meter.endToolCall({
        tool: toolUse,
        duration: Date.now() - toolStartTime,
        success: toolResult.status === 'success',
      })

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
   * Redacts the last message in the conversation history.
   * Called when guardrails block user input and redaction is enabled.
   *
   * Follows the redaction strategy:
   * - If the message contains at least one toolResult block, all toolResult blocks
   *   are kept with redacted content, and all other blocks are discarded.
   * - Otherwise, the entire content is replaced with a single text block containing
   *   the redaction message.
   *
   * @param redactMessage - The redaction message to replace the content with
   */
  private _redactLastMessage(redactMessage: string): void {
    // Find and redact the last message
    const lastIndex = this.messages.length - 1
    if (lastIndex >= 0) {
      const lastMessage = this.messages[lastIndex]
      if (lastMessage && lastMessage.role === 'user') {
        // Collect only tool result blocks with redacted content
        const redactedContent: ContentBlock[] = []
        for (const block of lastMessage.content) {
          if (block.type === 'toolResultBlock') {
            // Preserve tool result block structure, only redact its content
            redactedContent.push(
              new ToolResultBlock({
                toolUseId: block.toolUseId,
                status: block.status,
                content: [new TextBlock(redactMessage)],
              })
            )
          }
        }

        // If no tool result blocks were found, replace entire content with redaction message
        if (redactedContent.length === 0) {
          redactedContent.push(new TextBlock(redactMessage))
        }

        this.messages[lastIndex] = new Message({
          role: 'user',
          content: redactedContent,
        })
      } else if (lastMessage) {
        // Unexpected state: redaction requested but last message is not from user
        logger.warn(
          `role=<${lastMessage.role}> | received input redaction but last message is not from user | redaction skipped`
        )
      }
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
    } else if (item instanceof Agent) {
      tools.push(item.asTool())
    } else if (item instanceof McpClient) {
      mcpClients.push(item)
    } else {
      tools.push(item)
    }
  }

  return { tools, mcpClients }
}
