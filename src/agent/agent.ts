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
import { normalizeError, ConcurrentInvocationError } from '../errors.js'
import type { BaseModelConfig, Model, StreamOptions } from '../models/model.js'
import { ToolRegistry } from '../registry/tool-registry.js'
import { AgentState } from './state.js'
import type { AgentData } from '../types/agent.js'
import { AgentPrinter, getDefaultAppender, type Printer } from './printer.js'
import type { HookProvider } from '../hooks/types.js'
import { SlidingWindowConversationManager } from '../conversation-manager/sliding-window-conversation-manager.js'
import { HookRegistryImplementation } from '../hooks/registry.js'
import {
  HookEvent,
  InitializedEvent,
  AfterInvocationEvent,
  AfterModelCallEvent,
  AfterToolCallEvent,
  AfterToolsEvent,
  BeforeInvocationEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
  BeforeToolsEvent,
  BeforeTransferEvent,
  AfterTransferEvent,
  MessageAddedEvent,
  ModelStreamEventHook,
} from '../hooks/events.js'
import { createTransferToAgentTool } from '../tools/transfer-to-agent-tool.js'

const MAX_CONSECUTIVE_TRANSFERS = 8

/**
 * Recursive type definition for nested tool arrays.
 * Allows tools to be organized in nested arrays of any depth.
 */
export type ToolList = (Tool | McpClient | ToolList)[]

/**
 * Configuration object for creating a new Agent.
 */
export type AgentConfig = {
  /** Optional unique identifier for this agent in a sub-agent tree. */
  name?: string
  /**
   * The model instance that the agent will use to make decisions.
   * Accepts either a Model instance or a string representing a Bedrock model ID.
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
  /** Child agents available for transfer from this agent. */
  subAgents?: Agent[]
  /** Optional parent agent reference (internally normalized via tree wiring). */
  parentAgent?: Agent
  /** Disallow LLM-driven transfer from this agent to its parent. */
  disallowTransferToParent?: boolean
  /** Disallow LLM-driven transfer from this agent to sibling peers. */
  disallowTransferToPeers?: boolean
  /** Optional initial state values for the agent. */
  state?: Record<string, JSONValue>
  /**
   * Enable automatic printing of agent output to console.
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
 */
export type InvokeArgs = string | ContentBlock[] | ContentBlockData[] | Message[] | MessageData[]

type ActiveAgentRuntime = {
  toolRegistry: ToolRegistry
  systemPrompt: SystemPrompt | undefined
}

/**
 * Orchestrates the interaction between a model, a set of tools, and MCP clients.
 */
export class Agent implements AgentData {
  /**
   * The conversation history of messages between user and assistant.
   */
  public readonly messages: Message[]
  /**
   * Agent state storage accessible to tools and application logic.
   */
  public readonly state: AgentState
  /**
   * Conversation manager for handling message history and context overflow.
   */
  public readonly conversationManager: HookProvider
  /**
   * Hook registry for managing event callbacks.
   */
  public readonly hooks: HookRegistryImplementation

  /** Optional unique name used for sub-agent transfer routing. */
  public readonly name: string | undefined

  /** Child agents available for transfer from this agent. */
  public readonly subAgents: Agent[]

  /** Parent agent in the tree when present. */
  public parentAgent: Agent | undefined

  /** Whether transfer to parent is disabled for this agent. */
  public readonly disallowTransferToParent: boolean

  /** Whether transfer to peers is disabled for this agent. */
  public readonly disallowTransferToPeers: boolean

  /**
   * The model provider used by the agent for inference.
   */
  public model: Model

  /**
   * The system prompt to pass to the model provider.
   */
  public systemPrompt?: SystemPrompt

  private _toolRegistry: ToolRegistry
  private _mcpClients: McpClient[]
  private _initialized: boolean
  private _isInvoking = false
  private _printer?: Printer

  // Root-managed runtime state for handoff orchestration
  private _activeAgentName: string | undefined
  private _pendingTransferTarget: string | undefined
  private _consecutiveTransfers = 0

  /**
   * Creates an instance of the Agent.
   * @param config - The configuration for the agent.
   */
  constructor(config?: AgentConfig) {
    this.messages = (config?.messages ?? []).map((msg) => (msg instanceof Message ? msg : Message.fromMessageData(msg)))
    this.state = new AgentState(config?.state)
    this.conversationManager = config?.conversationManager ?? new SlidingWindowConversationManager({ windowSize: 40 })

    this.hooks = new HookRegistryImplementation()
    this.hooks.addHook(this.conversationManager)
    this.hooks.addAllHooks(config?.hooks ?? [])

    this.name = config?.name
    this.subAgents = config?.subAgents ?? []
    this.parentAgent = config?.parentAgent
    this.disallowTransferToParent = config?.disallowTransferToParent ?? false
    this.disallowTransferToPeers = config?.disallowTransferToPeers ?? false

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

    const printer = config?.printer ?? true
    if (printer) {
      this._printer = new AgentPrinter(getDefaultAppender())
    }

    this._initialized = false

    this._wireAgentTree()
  }

  /**
   * Returns the root agent by traversing parent links.
   */
  get rootAgent(): Agent {
    return getRootAgent(this)
  }

  /**
   * Finds an agent by name in this agent and descendants.
   */
  findAgent(name: string): Agent | undefined {
    if (this.name === name) {
      return this
    }
    return this.findSubAgent(name)
  }

  /**
   * Finds an agent by name in descendants only.
   */
  findSubAgent(name: string): Agent | undefined {
    for (const child of this.subAgents) {
      const found = child.findAgent(name)
      if (found) {
        return found
      }
    }
    return undefined
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
   */
  public async *stream(args: InvokeArgs): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    const root = this.rootAgent

    if (root !== this) {
      return yield* root._streamFromEntry(args, this)
    }

    return yield* this._streamFromEntry(args, this)
  }

  private async *_streamFromEntry(
    args: InvokeArgs,
    initialAgent: Agent
  ): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    using _lock = this.acquireLock()

    await this.initialize()

    const streamGenerator = this._stream(args, initialAgent)
    let result = await streamGenerator.next()

    while (!result.done) {
      const event = result.value

      if (event instanceof HookEvent && !(event instanceof MessageAddedEvent)) {
        await this.hooks.invokeCallbacks(event)
      }

      this._printer?.processEvent(event)
      yield event
      result = await streamGenerator.next()
    }

    yield result.value

    return result.value
  }

  /**
   * Internal implementation of the agent streaming logic.
   */
  private async *_stream(
    args: InvokeArgs,
    initialAgent: Agent
  ): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    let currentArgs: InvokeArgs | undefined = args
    let activeAgent = this._resolveInitialActiveAgent(initialAgent)

    yield new BeforeInvocationEvent({ agent: this })

    try {
      while (true) {
        await activeAgent.initialize()

        const runtime = this._buildRuntimeForActiveAgent(activeAgent)
        const modelResult = yield* this.invokeModel(activeAgent, runtime, currentArgs)
        currentArgs = undefined

        if (modelResult.stopReason !== 'toolUse') {
          yield await this._appendMessage(modelResult.message, activeAgent.name)
          this._activeAgentName = activeAgent.name
          return new AgentResult({
            stopReason: modelResult.stopReason,
            lastMessage: modelResult.message,
          })
        }

        const toolResultMessage = yield* this.executeTools(modelResult.message, runtime.toolRegistry, activeAgent)

        yield await this._appendMessage(modelResult.message, activeAgent.name)
        yield await this._appendMessage(toolResultMessage, activeAgent.name)

        const pendingTarget = this._pendingTransferTarget
        this._pendingTransferTarget = undefined

        if (pendingTarget) {
          const nextAgent = this.findAgent(pendingTarget)
          if (!nextAgent) {
            throw new Error(`Agent '${pendingTarget}' not found in the agent tree`)
          }

          if (this._consecutiveTransfers >= MAX_CONSECUTIVE_TRANSFERS) {
            this._consecutiveTransfers = 0
            continue
          }

          const fromAgentName = activeAgent.name ?? 'unnamed_agent'
          const toAgentName = nextAgent.name ?? 'unnamed_agent'

          yield new BeforeTransferEvent({
            agent: this,
            fromAgentName,
            toAgentName,
          })

          activeAgent = nextAgent
          this._activeAgentName = activeAgent.name
          this._consecutiveTransfers++

          yield new AfterTransferEvent({
            agent: this,
            fromAgentName,
            toAgentName,
          })
          continue
        }

        this._consecutiveTransfers = 0
      }
    } finally {
      yield new AfterInvocationEvent({ agent: this })
    }
  }

  /**
   * Normalizes agent invocation input into an array of messages to append.
   */
  private _normalizeInput(args?: InvokeArgs): Message[] {
    if (args !== undefined) {
      if (typeof args === 'string') {
        return [
          new Message({
            role: 'user',
            content: [new TextBlock(args)],
          }),
        ]
      } else if (Array.isArray(args) && args.length > 0) {
        const firstElement = args[0]!

        if ('role' in firstElement && typeof firstElement.role === 'string') {
          if (firstElement instanceof Message) {
            return args as Message[]
          }

          return (args as MessageData[]).map((data) => Message.fromMessageData(data))
        }

        let contentBlocks: ContentBlock[]
        if ('type' in firstElement && typeof firstElement.type === 'string') {
          contentBlocks = args as ContentBlock[]
        } else {
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

    return []
  }

  /**
   * Invokes the model provider and streams all events.
   */
  private async *invokeModel(
    activeAgent: Agent,
    runtime: ActiveAgentRuntime,
    args?: InvokeArgs
  ): AsyncGenerator<AgentStreamEvent, { message: Message; stopReason: StopReason }, undefined> {
    const messagesToAppend = this._normalizeInput(args)
    for (const message of messagesToAppend) {
      yield await this._appendMessage(message)
    }

    const toolSpecs = runtime.toolRegistry.values().map((tool) => tool.toolSpec)
    const streamOptions: StreamOptions = { toolSpecs }
    if (runtime.systemPrompt !== undefined) {
      streamOptions.systemPrompt = runtime.systemPrompt
    }

    yield new BeforeModelCallEvent({ agent: this })

    try {
      const { message, stopReason } = yield* this._streamFromModel(activeAgent, this.messages, streamOptions)

      const afterModelCallEvent = new AfterModelCallEvent({ agent: this, stopData: { message, stopReason } })
      yield afterModelCallEvent

      if (afterModelCallEvent.retry) {
        return yield* this.invokeModel(activeAgent, runtime, args)
      }

      return { message, stopReason }
    } catch (error) {
      const modelError = normalizeError(error)

      const errorEvent = new AfterModelCallEvent({ agent: this, error: modelError })
      yield errorEvent

      if (errorEvent.retry) {
        return yield* this.invokeModel(activeAgent, runtime, args)
      }

      throw error
    }
  }

  /**
   * Streams events from the model and fires ModelStreamEventHook for each event.
   */
  private async *_streamFromModel(
    activeAgent: Agent,
    messages: Message[],
    streamOptions: StreamOptions
  ): AsyncGenerator<AgentStreamEvent, { message: Message; stopReason: StopReason }, undefined> {
    const streamGenerator = activeAgent.model.streamAggregated(messages, streamOptions)
    let result = await streamGenerator.next()

    while (!result.done) {
      const event = result.value

      yield new ModelStreamEventHook({ agent: this, event })
      yield event
      result = await streamGenerator.next()
    }

    return result.value
  }

  /**
   * Executes tools sequentially and streams all tool events.
   */
  private async *executeTools(
    assistantMessage: Message,
    toolRegistry: ToolRegistry,
    activeAgent: Agent
  ): AsyncGenerator<AgentStreamEvent, Message, undefined> {
    yield new BeforeToolsEvent({ agent: this, message: assistantMessage })

    const toolUseBlocks = assistantMessage.content.filter(
      (block): block is ToolUseBlock => block.type === 'toolUseBlock'
    )

    if (toolUseBlocks.length === 0) {
      throw new Error('Model indicated toolUse but no tool use blocks found in message')
    }

    const toolResultBlocks: ToolResultBlock[] = []

    for (const toolUseBlock of toolUseBlocks) {
      const toolResultBlock = yield* this.executeTool(toolUseBlock, toolRegistry, activeAgent)
      toolResultBlocks.push(toolResultBlock)

      yield toolResultBlock
    }

    const toolResultMessage: Message = new Message({
      role: 'user',
      content: toolResultBlocks,
    })

    yield new AfterToolsEvent({ agent: this, message: toolResultMessage })

    return toolResultMessage
  }

  /**
   * Executes a single tool and returns the result.
   */
  private async *executeTool(
    toolUseBlock: ToolUseBlock,
    toolRegistry: ToolRegistry,
    activeAgent: Agent
  ): AsyncGenerator<AgentStreamEvent, ToolResultBlock, undefined> {
    const tool = toolRegistry.find((t) => t.name === toolUseBlock.name)

    const toolUse = {
      name: toolUseBlock.name,
      toolUseId: toolUseBlock.toolUseId,
      input: toolUseBlock.input,
    }

    while (true) {
      yield new BeforeToolCallEvent({ agent: this, toolUse, tool })

      let toolResult: ToolResultBlock
      let error: Error | undefined

      if (!tool) {
        toolResult = new ToolResultBlock({
          toolUseId: toolUseBlock.toolUseId,
          status: 'error',
          content: [new TextBlock(`Tool '${toolUseBlock.name}' not found in registry`)],
        })
      } else {
        const toolContext: ToolContext = {
          toolUse: {
            name: toolUseBlock.name,
            toolUseId: toolUseBlock.toolUseId,
            input: toolUseBlock.input,
          },
          agent: activeAgent,
        }

        try {
          const result = yield* tool.stream(toolContext)

          if (!result) {
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
          error = normalizeError(e)
          toolResult = new ToolResultBlock({
            toolUseId: toolUseBlock.toolUseId,
            status: 'error',
            content: [new TextBlock(error.message)],
            error,
          })
        }
      }

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
   * Appends a message to the conversation history, invokes MessageAddedEvent hook,
   * and returns the event for yielding.
   */
  private async _appendMessage(message: Message, author?: string): Promise<MessageAddedEvent> {
    const messageToAppend =
      author !== undefined && message.author === undefined
        ? new Message({ role: message.role, content: message.content, author })
        : message

    this.messages.push(messageToAppend)
    const event = new MessageAddedEvent({ agent: this, message: messageToAppend })
    await this.hooks.invokeCallbacks(event)
    return event
  }

  private _wireAgentTree(): void {
    // Normalize config.parentAgent links
    if (this.parentAgent && !this.parentAgent.subAgents.includes(this)) {
      ;(this.parentAgent.subAgents as Agent[]).push(this)
    }

    // Ensure child parent pointers are aligned and share root timeline state.
    for (const child of this.subAgents) {
      if (child.parentAgent && child.parentAgent !== this) {
        throw new Error(
          `Agent '${child.name ?? '<unnamed>'}' already has parent '${child.parentAgent.name ?? '<unnamed>'}'`
        )
      }

      child.parentAgent = this
      ;(child as unknown as { messages: Message[] }).messages = this.messages
    }

    this._validateSiblingNames()

    if (this.subAgents.length > 0 || this.parentAgent !== undefined) {
      this._assertNamePresent(this)
      for (const child of this.subAgents) {
        this._assertNamePresent(child)
      }
    }
  }

  private _validateSiblingNames(): void {
    const seen = new Set<string>()
    for (const child of this.subAgents) {
      if (child.name === undefined) {
        continue
      }
      if (seen.has(child.name)) {
        throw new Error(`Duplicate sub-agent name '${child.name}' under parent '${this.name ?? '<unnamed>'}'`)
      }
      seen.add(child.name)
    }
  }

  private _assertNamePresent(agent: Agent): void {
    if (!agent.name) {
      throw new Error('Agent name is required when using subAgents or parentAgent')
    }
  }

  private _resolveInitialActiveAgent(initialAgent: Agent): Agent {
    if (this._activeAgentName) {
      const remembered = this.findAgent(this._activeAgentName)
      if (remembered) {
        return remembered
      }
    }

    return initialAgent
  }

  private _buildRuntimeForActiveAgent(activeAgent: Agent): ActiveAgentRuntime {
    const transferTargets = this._getTransferTargets(activeAgent)
    const runtimeTools = [...activeAgent.toolRegistry.values()]

    if (transferTargets.length > 0) {
      runtimeTools.push(
        createTransferToAgentTool({
          resolveAllowedTargets: () => transferTargets.map((agent) => agent.name!),
          queueTransfer: (targetAgentName) => {
            if (this._consecutiveTransfers >= MAX_CONSECUTIVE_TRANSFERS) {
              throw new Error(
                `Transfer guard triggered after ${MAX_CONSECUTIVE_TRANSFERS} consecutive transfers in one invocation`
              )
            }
            this._pendingTransferTarget = targetAgentName
          },
        })
      )
    }

    return {
      toolRegistry: new ToolRegistry(runtimeTools),
      systemPrompt: this._buildEffectiveSystemPrompt(activeAgent, transferTargets),
    }
  }

  private _buildEffectiveSystemPrompt(activeAgent: Agent, transferTargets: Agent[]): SystemPrompt | undefined {
    const basePrompt = activeAgent.systemPrompt

    if (transferTargets.length === 0) {
      return basePrompt
    }

    const transferPrompt = this._buildTransferInstructions(activeAgent, transferTargets)

    if (basePrompt === undefined) {
      return transferPrompt
    }

    if (typeof basePrompt === 'string') {
      return `${basePrompt}\n\n${transferPrompt}`
    }

    return [...basePrompt, new TextBlock(transferPrompt)]
  }

  private _buildTransferInstructions(activeAgent: Agent, targets: Agent[]): string {
    const lines: string[] = []
    lines.push('You can transfer this conversation to another specialized agent when appropriate.')
    lines.push('Available transfer targets:')
    for (const target of targets) {
      const description = target.systemPrompt
      if (typeof description === 'string' && description.trim().length > 0) {
        lines.push(`- ${target.name}: ${description}`)
      } else {
        lines.push(`- ${target.name}`)
      }
    }

    lines.push(
      'If another agent should handle the request, call transfer_to_agent with agentName and do not include extra assistant text in that same handoff step.'
    )

    if (activeAgent.parentAgent && !activeAgent.disallowTransferToParent) {
      lines.push(
        `If no listed specialist is better and you are not best suited, transfer to your parent agent '${activeAgent.parentAgent.name}'.`
      )
    }

    return lines.join('\n')
  }

  private _getTransferTargets(agent: Agent): Agent[] {
    const targets: Agent[] = []

    targets.push(...agent.subAgents)

    if (agent.parentAgent) {
      if (!agent.disallowTransferToParent) {
        targets.push(agent.parentAgent)
      }

      if (!agent.disallowTransferToPeers) {
        targets.push(...agent.parentAgent.subAgents.filter((peer) => peer !== agent))
      }
    }

    const dedupedTargets: Agent[] = []
    const seenNames = new Set<string>()
    for (const target of targets) {
      if (!target.name || seenNames.has(target.name)) {
        continue
      }
      seenNames.add(target.name)
      dedupedTargets.push(target)
    }

    return dedupedTargets
  }
}

/**
 * Recursively flattens nested arrays of tools into a single flat array.
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

function getRootAgent(agent: Agent): Agent {
  let current = agent
  while (current.parentAgent !== undefined) {
    current = current.parentAgent
  }
  return current
}
