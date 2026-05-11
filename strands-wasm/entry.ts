/**
 * WASM component — exports strands:agent/api.
 *
 * The Agent resource is persistent: it holds a TS Agent instance across
 * multiple generate() calls, maintaining conversation history.
 *
 * Each call to readNext() awaits the next generator value, which
 * causes componentize-js to yield via wasi:io/poll, letting the
 * host drive HTTP I/O forward.
 */

/// <reference path="./generated/interfaces/strands-agent-types.d.ts" />
/// <reference path="./generated/interfaces/strands-agent-host-log.d.ts" />
/// <reference path="./generated/interfaces/strands-agent-tool-provider.d.ts" />

import type {
  AgentConfig,
  StreamEvent,
  StreamArgs,
  RespondArgs,
  SetMessagesArgs,
  ModelConfig,
  ModelParams,
  StopData,
  ToolSpec,
  LifecycleEventType,
  StreamEventLifecycle,
} from 'strands:agent/types'

import { callTool } from 'strands:agent/tool-provider'
import { log as hostLog } from 'strands:agent/host-log'
import { Agent, FunctionTool, SessionManager, FileStorage } from '@strands-agents/sdk'
import { S3Storage } from '@strands-agents/sdk/session/s3-storage'
import { AnthropicModel } from '@strands-agents/sdk/models/anthropic'
import { BedrockModel } from '@strands-agents/sdk/models/bedrock'
import { OpenAIModel } from '@strands-agents/sdk/models/openai'
import { GoogleModel } from '@strands-agents/sdk/models/google'
import type {
  StopReason,
  AgentStreamEvent,
  Model,
  BaseModelConfig,
  Plugin,
  LocalAgent,
  Usage,
  Metrics,
  AgentResult,
  ToolContext,
  SystemPrompt,
  InvokeArgs,
  Message,
  StreamOptions,
  ToolChoice,
  ModelStreamEvent,
  ContentBlock,
  ToolStreamEvent,
  SaveLatestStrategy,
  JSONValue,
} from '@strands-agents/sdk'
import {
  ConversationManager,
  NullConversationManager,
  SlidingWindowConversationManager,
  SummarizingConversationManager,
  AfterInvocationEvent,
  AfterModelCallEvent,
  AfterToolCallEvent,
  InitializedEvent,
  BeforeInvocationEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
  MessageAddedEvent,
} from '@strands-agents/sdk'
import { z } from 'zod'

// All log calls go through `hostLog` (the WIT import).  The host can
// route them to the host language's logging framework (e.g. Python `logging`).

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

type WitResult = { tag: 'ok' | 'err'; val: string }

function glog(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  hostLog({ level, message, context: context ? JSON.stringify(context) : undefined })
}

/** Capture a JS Error's stack and message as a structured context blob. */
function errContext(err: unknown, extra?: Record<string, unknown>): Record<string, unknown> {
  const e = err instanceof Error ? err : new Error(String(err))
  return { error: e.message, stack: e.stack, ...extra }
}

/** Convert TS SDK Usage to WIT Usage. */
function mapUsage(src: Partial<Usage> | null | undefined): import('strands:agent/types').Usage | undefined {
  if (src == null) return undefined
  return {
    inputTokens: src.inputTokens ?? 0,
    outputTokens: src.outputTokens ?? 0,
    totalTokens: src.totalTokens ?? (src.inputTokens ?? 0) + (src.outputTokens ?? 0),
    cacheReadInputTokens: src.cacheReadInputTokens,
    cacheWriteInputTokens: src.cacheWriteInputTokens,
  }
}

/** Convert TS SDK Metrics to WIT Metrics. */
function mapMetrics(src: Partial<Metrics> | null | undefined): import('strands:agent/types').Metrics | undefined {
  if (src == null) return undefined
  return { latencyMs: typeof src.latencyMs === 'number' ? src.latencyMs : 0 }
}

/** Map a TS SDK StopReason string to the WIT reason tag. */
function mapStopReasonTag(reason: StopReason): StopData['reason'] {
  switch (reason) {
    case 'endTurn':
      return 'end-turn'
    case 'toolUse':
      return 'tool-use'
    case 'maxTokens':
      return 'max-tokens'
    case 'contentFiltered':
      return 'content-filtered'
    case 'guardrailIntervened':
      return 'guardrail-intervened'
    case 'stopSequence':
      return 'stop-sequence'
    case 'modelContextWindowExceeded':
      return 'model-context-window-exceeded'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'error'
  }
}

/** Convert a TS SDK StopReason to a WIT StopData with usage/metrics. */
function mapStopReason(
  reason: StopReason,
  stopData?: { usage?: Partial<Usage>; metrics?: Partial<Metrics>; structuredOutput?: unknown }
): StopData {
  return {
    reason: mapStopReasonTag(reason),
    usage: mapUsage(stopData?.usage),
    metrics: mapMetrics(stopData?.metrics),
    structuredOutput: stopData?.structuredOutput !== undefined ? JSON.stringify(stopData.structuredOutput) : undefined,
  }
}

/** Convert a TS SDK AgentStreamEvent to a WIT StreamEvent for the host. */
function mapEvent(event: AgentStreamEvent): StreamEvent | null {
  if ('interrupt' in event && typeof (event as unknown as Record<string, unknown>).interrupt !== 'function') {
    return { tag: 'interrupt', val: JSON.stringify(event) }
  }

  switch (event.type) {
    // Mapped to WIT stream events for the Python host
    case 'modelStreamUpdateEvent':
      return mapModelStreamEvent(event.event)
    case 'contentBlockEvent':
      return mapContentBlock(event.contentBlock)
    case 'toolResultEvent':
      return mapContentBlock(event.result)
    case 'toolStreamUpdateEvent':
      return mapToolStreamEvent(event.event)

    // Handled by LifecycleBridge via hook subscriptions
    case 'beforeInvocationEvent':
    case 'afterInvocationEvent':
    case 'beforeModelCallEvent':
    case 'afterModelCallEvent':
    case 'beforeToolCallEvent':
    case 'afterToolCallEvent':
    case 'messageAddedEvent':

    // No WIT representation — data available through other channels
    case 'modelMessageEvent':
    case 'agentResultEvent':
    case 'beforeToolsEvent':
    case 'afterToolsEvent':
      return null

    default: {
      const _: never = event
      return null
    }
  }
}

/** Convert a ModelStreamEvent to a WIT StreamEvent. */
function mapModelStreamEvent(event: ModelStreamEvent): StreamEvent | null {
  switch (event.type) {
    case 'modelContentBlockDeltaEvent':
      return event.delta.type === 'textDelta' ? { tag: 'text-delta', val: event.delta.text } : null
    case 'modelContentBlockStartEvent':
      return event.start?.type === 'toolUseStart'
        ? {
            tag: 'tool-use',
            val: {
              name: event.start.name,
              toolUseId: event.start.toolUseId,
              input: JSON.stringify({}),
            },
          }
        : null
    case 'modelMetadataEvent':
      return { tag: 'metadata', val: { usage: mapUsage(event.usage), metrics: mapMetrics(event.metrics) } }
    case 'modelContentBlockStopEvent':
    case 'modelMessageStartEvent':
    case 'modelMessageStopEvent':
    case 'modelRedactionEvent':
      return null
    default: {
      const _: never = event
      return null
    }
  }
}

/** Convert a ContentBlock to a WIT StreamEvent. */
function mapContentBlock(block: ContentBlock): StreamEvent | null {
  switch (block.type) {
    case 'toolUseBlock':
      return {
        tag: 'tool-use',
        val: {
          name: block.name,
          toolUseId: block.toolUseId,
          input: JSON.stringify(block.input ?? {}),
        },
      }
    case 'toolResultBlock':
      return {
        tag: 'tool-result',
        val: {
          toolUseId: block.toolUseId,
          status: block.status,
          content: JSON.stringify(block.content ?? []),
        },
      }
    case 'textBlock':
    case 'reasoningBlock':
    case 'cachePointBlock':
    case 'guardContentBlock':
    case 'imageBlock':
    case 'videoBlock':
    case 'documentBlock':
    case 'citationsBlock':
      return null
    default: {
      const _: never = block
      return null
    }
  }
}

/** Convert a ToolStreamEvent to a WIT StreamEvent. */
function mapToolStreamEvent(event: ToolStreamEvent): StreamEvent {
  return {
    tag: 'tool-result',
    val: {
      toolUseId: '',
      status: 'success',
      content: JSON.stringify({ data: event.data ?? null }),
    },
  }
}

/** Extract WIT ModelParams into a plain config object for TS model constructors. */
function modelParamsConfig(params?: ModelParams): Record<string, unknown> {
  if (!params) return {}
  return {
    ...(params.maxTokens != null ? { maxTokens: params.maxTokens } : {}),
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(params.topP != null ? { topP: params.topP } : {}),
  }
}

/** Instantiate a TS SDK Model from the WIT ModelConfig variant. */
function createModel(config?: ModelConfig, params?: ModelParams): Model<BaseModelConfig> {
  const base = modelParamsConfig(params)

  if (!config) {
    glog('info', 'createModel: defaulting to Bedrock')
    return new BedrockModel(base)
  }

  const extra = config.val.additionalConfig ? JSON.parse(config.val.additionalConfig) : {}

  switch (config.tag) {
    case 'anthropic': {
      glog('info', 'createModel: Anthropic', { modelId: config.val.modelId })
      return new AnthropicModel({
        ...base,
        ...(config.val.modelId ? { modelId: config.val.modelId } : {}),
        ...(config.val.apiKey ? { apiKey: config.val.apiKey } : {}),
        ...extra,
      })
    }
    case 'bedrock': {
      glog('info', 'createModel: Bedrock', { modelId: config.val.modelId, region: config.val.region })
      const clientConfig: Record<string, unknown> = extra.clientConfig ?? {}
      if (config.val.accessKeyId && config.val.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: config.val.accessKeyId,
          secretAccessKey: config.val.secretAccessKey,
          ...(config.val.sessionToken ? { sessionToken: config.val.sessionToken } : {}),
        }
      }
      return new BedrockModel({
        ...base,
        ...(config.val.modelId ? { modelId: config.val.modelId } : {}),
        ...(config.val.region ? { region: config.val.region } : {}),
        clientConfig,
        ...extra,
      })
    }
    case 'openai': {
      glog('info', 'createModel: OpenAI', { modelId: config.val.modelId })
      return new OpenAIModel({
        ...base,
        ...(config.val.modelId ? { modelId: config.val.modelId } : {}),
        ...(config.val.apiKey ? { apiKey: config.val.apiKey } : {}),
        ...extra,
      })
    }
    case 'gemini': {
      glog('info', 'createModel: Gemini', { modelId: config.val.modelId })
      return new GoogleModel({
        ...base,
        ...(config.val.modelId ? { modelId: config.val.modelId } : {}),
        ...(config.val.apiKey ? { apiKey: config.val.apiKey } : {}),
        ...extra,
      })
    }
    default:
      throw new Error(`Unknown model provider: ${(config as any).tag}`)
  }
}

/** Convert WIT ToolSpecs into TS FunctionTools that call back to the host via tool-provider. */
function createTools(specs: ToolSpec[] | undefined): FunctionTool[] | undefined {
  if (!specs || specs.length === 0) return undefined

  return specs.map(
    (spec) =>
      new FunctionTool({
        name: spec.name,
        description: spec.description,
        inputSchema: JSON.parse(spec.inputSchema),
        callback: (input: unknown, toolContext: ToolContext) => {
          const toolUseId = toolContext.toolUse.toolUseId

          let rawResult: unknown
          try {
            rawResult = callTool({
              name: spec.name,
              input: JSON.stringify(input),
              toolUseId,
            })
          } catch (e: unknown) {
            const err = e instanceof Error ? e : new Error(String(e))
            glog('error', 'callTool: host threw', errContext(err, { tool: spec.name }))
            throw err
          }

          let json: string
          if (typeof rawResult === 'object' && rawResult !== null && 'tag' in rawResult) {
            const result = rawResult as WitResult
            if (result.tag === 'err') {
              throw new Error(result.val)
            }
            json = result.val
          } else {
            json = rawResult as string
          }

          const parsed = JSON.parse(json) as JSONValue
          if (
            parsed &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed) &&
            'status' in parsed &&
            'content' in parsed
          ) {
            return parsed.content
          }
          return parsed
        },
      })
  )
}

/** Build a system prompt from the agent config (string or JSON content blocks). */
function buildSystemPrompt(config: AgentConfig): SystemPrompt | undefined {
  if (config.systemPromptBlocks) {
    return JSON.parse(config.systemPromptBlocks) as SystemPrompt
  }
  return config.systemPrompt
}

/** Wrap a model in a Proxy that injects toolChoice into every stream() call. */
function createToolChoiceProxy(baseModel: Model<BaseModelConfig>, toolChoice: ToolChoice): Model<BaseModelConfig> {
  return new Proxy(baseModel, {
    get(target, prop, receiver) {
      if (prop === 'stream') {
        return async function* (messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
          yield* target.stream(messages, { ...options, toolChoice })
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as Model<BaseModelConfig>
}

/** Bridges TS SDK lifecycle hooks to WIT StreamEvent lifecycle variants for the host. */
class LifecycleBridge implements Plugin {
  readonly name = 'strands:lifecycle-bridge'
  queue: StreamEvent[] = []

  private push(eventType: LifecycleEventType, toolUse?: unknown, toolResult?: unknown): void {
    const event: StreamEventLifecycle = {
      tag: 'lifecycle',
      val: {
        eventType,
        toolUse: toolUse ? JSON.stringify(toolUse) : undefined,
        toolResult: toolResult ? JSON.stringify(toolResult) : undefined,
      },
    }
    this.queue.push(event)
  }

  initAgent(agent: LocalAgent): void {
    agent.addHook(InitializedEvent, () => this.push('initialized'))
    agent.addHook(BeforeInvocationEvent, () => this.push('before-invocation'))
    agent.addHook(AfterInvocationEvent, () => this.push('after-invocation'))
    agent.addHook(BeforeModelCallEvent, () => this.push('before-model-call'))
    agent.addHook(AfterModelCallEvent, () => this.push('after-model-call'))
    agent.addHook(MessageAddedEvent, () => this.push('message-added'))

    agent.addHook(BeforeToolCallEvent, (event) => {
      this.push('before-tool-call', event.toolUse)
    })

    agent.addHook(AfterToolCallEvent, (event) => {
      this.push('after-tool-call', event.toolUse, event.result)
    })
  }

  drain(): StreamEvent[] {
    return this.queue.splice(0)
  }
}

/** Parse user input — JSON arrays pass through, plain strings stay as-is. */
function parseInput(input: string): InvokeArgs {
  try {
    const parsed = JSON.parse(input)
    if (Array.isArray(parsed)) return parsed as InvokeArgs
  } catch {
    /* not JSON, treat as plain string */
  }
  return input
}

/** Validate a WIT save-latest strategy string against the SDK's union type. */
function parseSaveLatestStrategy(s?: string): SaveLatestStrategy | undefined {
  if (s === 'message' || s === 'invocation' || s === 'trigger') return s
  if (s) glog('warn', `save_latest_on=<${s}> | unknown strategy, using default`)
  return undefined
}

/** Build a SessionManager from the WIT session config. */
function createSessionManager(config: AgentConfig): SessionManager | undefined {
  if (!config.session) return undefined

  const sc = config.session
  let storage
  switch (sc.storage.tag) {
    case 'file':
      storage = new FileStorage(sc.storage.val.baseDir)
      break
    case 's3': {
      const s3 = sc.storage.val
      storage = new S3Storage({
        bucket: s3.bucket,
        ...(s3.region ? { region: s3.region } : {}),
        ...(s3.prefix ? { prefix: s3.prefix } : {}),
      })
      break
    }
    default:
      throw new Error(`Unknown storage type: ${(sc.storage as any).tag}`)
  }

  const saveLatestOn = parseSaveLatestStrategy(sc.saveLatestOn)
  return new SessionManager({
    sessionId: sc.sessionId,
    storage: { snapshot: storage },
    ...(saveLatestOn !== undefined ? { saveLatestOn } : {}),
  })
}

/** Instantiate a conversation manager from the WIT config, or undefined to use the TS Agent default. */
function createConversationManager(config: AgentConfig): ConversationManager | undefined {
  const cmConfig = config.conversationManager
  if (!cmConfig) {
    return undefined
  }
  switch (cmConfig.strategy) {
    case 'none':
      return new NullConversationManager()
    case 'sliding-window':
      return new SlidingWindowConversationManager({
        windowSize: cmConfig.windowSize,
        shouldTruncateResults: cmConfig.shouldTruncateResults,
      })
    case 'summarizing': {
      let summaryModel: Model<BaseModelConfig> | undefined
      if (cmConfig.summarizationModelConfig) {
        try {
          const parsed = JSON.parse(cmConfig.summarizationModelConfig)
          summaryModel = createModel(parsed)
        } catch (e) {
          glog('warn', 'failed to parse summarization model config, using agent model', errContext(e))
        }
      }
      return new SummarizingConversationManager({
        model: summaryModel,
        summaryRatio: cmConfig.summaryRatio,
        preserveRecentMessages: cmConfig.preserveRecentMessages,
        summarizationSystemPrompt: cmConfig.summarizationSystemPrompt,
      })
    }
    default:
      glog('warn', `unknown conversation manager strategy: ${cmConfig.strategy}, using default`)
      return undefined
  }
}

/** Parse a JSON Schema string into a Zod schema for structured output validation. */
function parseStructuredOutputSchema(jsonStr: string | undefined): z.ZodSchema | undefined {
  if (!jsonStr) return undefined
  try {
    return z.fromJSONSchema(JSON.parse(jsonStr))
  } catch (e) {
    throw new Error(`Invalid structured output schema: ${e instanceof Error ? e.message : String(e)}`)
  }
}

class AgentImpl {
  private agent: Agent
  private defaultTools: FunctionTool[] | undefined
  private lifecycleBridge: LifecycleBridge
  private sessionManager: SessionManager | undefined

  constructor(config: AgentConfig) {
    glog('info', 'AgentImpl: constructing', {
      hasModel: !!config.model,
      hasTools: !!config.tools?.length,
      toolCount: config.tools?.length ?? 0,
      hasSession: !!config.session,
    })

    const model = createModel(config.model, config.modelParams)
    this.defaultTools = createTools(config.tools)
    this.lifecycleBridge = new LifecycleBridge()
    this.sessionManager = createSessionManager(config)
    const conversationManager = createConversationManager(config)

    const structuredOutputSchema = parseStructuredOutputSchema(config.structuredOutputSchema)

    const plugins: Plugin[] = [this.lifecycleBridge]

    this.agent = new Agent({
      model,
      systemPrompt: buildSystemPrompt(config),
      tools: this.defaultTools,
      plugins,
      sessionManager: this.sessionManager,
      conversationManager,
      structuredOutputSchema,
      printer: false,
    })
  }

  generate(args: StreamArgs): ResponseStreamImpl {
    glog('debug', 'AgentImpl.generate', {
      inputLen: args.input.length,
      hasTools: !!args.tools?.length,
      hasToolChoice: !!args.toolChoice,
    })

    if (args.tools) {
      const requestTools = createTools(args.tools)
      this.agent.toolRegistry.clear()
      if (requestTools) {
        this.agent.toolRegistry.add(requestTools)
      }
    }

    let originalModel: Model<BaseModelConfig> | undefined
    if (args.toolChoice) {
      const tc = JSON.parse(args.toolChoice) as ToolChoice
      originalModel = this.agent.model
      this.agent.model = createToolChoiceProxy(originalModel, tc)
    }

    const structuredOutputSchema = parseStructuredOutputSchema(args.structuredOutputSchema)

    return new ResponseStreamImpl(
      this.agent,
      args.input,
      this.lifecycleBridge,
      this.defaultTools,
      originalModel,
      structuredOutputSchema
    )
  }

  getMessages(): string {
    return JSON.stringify(this.agent.messages)
  }

  setMessages(args: SetMessagesArgs): void {
    const newMessages = JSON.parse(args.json)
    this.agent.messages.splice(0, this.agent.messages.length, ...newMessages)
  }

  async saveSession(): Promise<void> {
    if (!this.sessionManager) throw new Error('No session manager configured')
    await this.sessionManager.saveSnapshot({ target: this.agent, isLatest: true })
  }

  async listSnapshots(): Promise<string[]> {
    if (!this.sessionManager) throw new Error('No session manager configured')
    return this.sessionManager.listSnapshotIds({ target: this.agent })
  }

  async deleteSession(): Promise<void> {
    if (!this.sessionManager) throw new Error('No session manager configured')
    // Delete by removing all snapshots - FileStorage/S3Storage don't have a bulk delete,
    // so we'd need to implement this per-storage. For now, list and delete individually.
    // TODO: Add deleteSession to SnapshotStorage interface upstream.
    throw new Error('deleteSession not yet implemented')
  }
}

class ResponseStreamImpl {
  private done = false
  private generator: AsyncGenerator<AgentStreamEvent, AgentResult | undefined, undefined>
  private interruptResolve: ((payload: string) => void) | null = null
  private agent: Agent
  private bridge: LifecycleBridge
  private defaultTools: FunctionTool[] | undefined
  private originalModel: Model<BaseModelConfig> | undefined

  constructor(
    agent: Agent,
    input: string,
    bridge: LifecycleBridge,
    defaultTools?: FunctionTool[],
    originalModel?: Model<BaseModelConfig>,
    structuredOutputSchema?: z.ZodSchema
  ) {
    this.agent = agent
    this.bridge = bridge
    this.defaultTools = defaultTools
    this.originalModel = originalModel
    this.generator = agent.stream(parseInput(input), {
      structuredOutputSchema,
    })
  }

  private restoreDefaults(): void {
    if (this.originalModel) {
      this.agent.model = this.originalModel
    }
    this.agent.toolRegistry.clear()
    if (this.defaultTools) {
      this.agent.toolRegistry.add(this.defaultTools)
    }
  }

  async readNext(): Promise<StreamEvent[] | undefined> {
    if (this.done) return undefined

    try {
      const result = await this.generator.next()
      const lifecycle = this.bridge.drain()

      if (result.done) {
        this.done = true
        this.restoreDefaults()
        const agentResult = result.value
        if (agentResult) {
          return [
            ...lifecycle,
            {
              tag: 'stop',
              val: mapStopReason(agentResult.stopReason, {
                usage: agentResult.metrics?.accumulatedUsage,
                metrics: agentResult.metrics?.accumulatedMetrics,
                structuredOutput: agentResult.structuredOutput,
              }),
            },
          ]
        }
        return lifecycle.length > 0 ? lifecycle : undefined
      }

      const mapped = mapEvent(result.value)
      if (mapped) lifecycle.push(mapped)
      return lifecycle.length > 0 ? lifecycle : []
    } catch (err: unknown) {
      this.done = true
      this.restoreDefaults()
      const lifecycle = this.bridge.drain()
      const msg = err instanceof Error ? err.message : String(err)
      return [...lifecycle, { tag: 'error', val: msg }]
    }
  }

  respond(args: RespondArgs): void {
    if (this.interruptResolve) {
      this.interruptResolve(args.payload)
      this.interruptResolve = null
    }
  }

  cancel(): void {
    this.done = true
    this.restoreDefaults()
    this.generator.return(undefined)
  }
}

export const api = {
  Agent: AgentImpl,
  ResponseStream: ResponseStreamImpl,
}

// Exported for contract testing. Not used by the WASM component build —
// componentize-js generates bindings from the WIT world definition
// (`world agent { export api; }`), which only declares the `api` export.
// Additional ESM exports in bundle.js are inaccessible from the WASM boundary.
export {
  mapEvent,
  mapModelStreamEvent,
  mapContentBlock,
  mapToolStreamEvent,
  mapStopReason,
  mapStopReasonTag,
  mapUsage,
  mapMetrics,
  parseInput,
  parseStructuredOutputSchema,
  createTools,
  LifecycleBridge,
  parseSaveLatestStrategy,
  createToolChoiceProxy,
}
