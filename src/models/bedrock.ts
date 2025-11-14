/**
 * AWS Bedrock model provider implementation.
 *
 * This module provides integration with AWS Bedrock's Converse API,
 * supporting streaming responses, tool use, and prompt caching.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html
 */

import {
  BedrockRuntimeClient,
  type BedrockRuntimeClientConfig,
  type ContentBlock as BedrockContentBlock,
  type ContentBlockDeltaEvent as BedrockContentBlockDeltaEvent,
  type ContentBlockStartEvent as BedrockContentBlockStartEvent,
  ConverseCommand,
  type ConverseCommandOutput,
  ConverseStreamCommand,
  type ConverseStreamCommandInput,
  type ConverseStreamMetadataEvent as BedrockConverseStreamMetadataEvent,
  type ConverseStreamOutput,
  type InferenceConfiguration,
  type Message as BedrockMessage,
  type MessageStartEvent as BedrockMessageStartEvent,
  type MessageStopEvent as BedrockMessageStopEvent,
  type ReasoningContentBlock,
  type ReasoningContentBlockDelta,
  type Tool,
  type ToolConfiguration,
  type ToolUseBlockDelta,
} from '@aws-sdk/client-bedrock-runtime'
import { type BaseModelConfig, Model, type StreamOptions } from '../models/model.js'
import type { ContentBlock, Message, SystemContentBlock, ToolUseBlock } from '../types/messages.js'
import type { ModelStreamEvent, ReasoningContentDelta, Usage } from '../models/streaming.js'
import type { JSONValue } from '../types/json.js'
import { ContextWindowOverflowError } from '../errors.js'
import { ensureDefined } from '../types/validation.js'

/**
 * Default Bedrock model ID.
 * Uses Claude Sonnet 4.5 with global inference profile for cross-region availability.
 */
const DEFAULT_BEDROCK_MODEL_ID = 'global.anthropic.claude-sonnet-4-5-20250929-v1:0'

/**
 * Models that require the status field in tool results.
 * According to AWS Bedrock API documentation, the status field is only supported by Anthropic Claude models.
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolResultBlock.html
 */
const MODELS_INCLUDE_STATUS = ['anthropic.claude']

/**
 * Error messages that indicate context window overflow.
 * Used to detect when input exceeds the model's context window.
 */
const BEDROCK_CONTEXT_WINDOW_OVERFLOW_MESSAGES = [
  'Input is too long for requested model',
  'input length and `max_tokens` exceed context limit',
  'too many total text bytes',
]

/**
 * Mapping of Bedrock stop reasons to SDK stop reasons.
 */
const STOP_REASON_MAP = {
  end_turn: 'endTurn',
  tool_use: 'toolUse',
  max_tokens: 'maxTokens',
  stop_sequence: 'stopSequence',
  content_filtered: 'contentFiltered',
  guardrail_intervened: 'guardrailIntervened',
} as const

/**
 * Converts a snake_case string to camelCase.
 * Used for mapping unknown stop reasons from Bedrock to SDK format.
 *
 * @param str - Snake case string
 * @returns Camel case string
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Configuration interface for AWS Bedrock model provider.
 *
 * Extends BaseModelConfig with Bedrock-specific configuration options
 * for model parameters, caching, and additional request/response fields.
 *
 * @example
 * ```typescript
 * const config: BedrockModelConfig = {
 *   modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
 *   maxTokens: 1024,
 *   temperature: 0.7,
 *   cachePrompt: 'ephemeral'
 * }
 * ```
 */
export interface BedrockModelConfig extends BaseModelConfig {
  /**
   * Maximum number of tokens to generate in the response.
   */
  maxTokens?: number

  /**
   * Controls randomness in generation (0 to 1).
   */
  temperature?: number

  /**
   * Controls diversity via nucleus sampling (0 to 1).
   */
  topP?: number

  /**
   * Array of sequences that will stop generation when encountered.
   */
  stopSequences?: string[]

  /**
   * Cache point type for the system prompt.
   * @see https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
   */
  cachePrompt?: string

  /**
   * Cache point type for tools.
   * @see https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
   */
  cacheTools?: string

  /**
   * Additional fields to include in the Bedrock request.
   */
  additionalRequestFields?: JSONValue

  /**
   * Additional response field paths to extract from the Bedrock response.
   */
  additionalResponseFieldPaths?: string[]

  /**
   * Additional arguments to pass through to the Bedrock Converse API.
   * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-runtime/command/ConverseStreamCommand/
   */
  additionalArgs?: JSONValue

  /**
   * Whether or not to stream responses from the model.
   *
   * This will use the ConverseStream API instead of the Converse API.
   *
   * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
   * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html
   */
  stream?: boolean

  /**
   * Flag to include status field in tool results.
   * - `true`: Always include status field
   * - `false`: Never include status field
   * - `'auto'`: Automatically determine based on model ID (default)
   */
  includeToolResultStatus?: 'auto' | boolean
}

/**
 * Options for creating a BedrockModel instance.
 */
export interface BedrockModelOptions extends BedrockModelConfig {
  /**
   * AWS region to use for the Bedrock service.
   */
  region?: string

  /**
   * Configuration for the Bedrock Runtime client.
   */
  clientConfig?: BedrockRuntimeClientConfig
}

/**
 * AWS Bedrock model provider implementation.
 *
 * Implements the Model interface for AWS Bedrock using the Converse Stream API.
 * Supports streaming responses, tool use, prompt caching, and comprehensive error handling.
 *
 * @example
 * ```typescript
 * const provider = new BedrockModel({
 *   modelConfig: {
 *     modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
 *     maxTokens: 1024,
 *     temperature: 0.7
 *   },
 *   clientConfig: {
 *     region: 'us-west-2'
 *   }
 * })
 *
 * const messages: Message[] = [
 *   { type: 'message', role: 'user', content: [{ type: 'textBlock', text: 'Hello!' }] }
 * ]
 *
 * for await (const event of provider.stream(messages)) {
 *   if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
 *     process.stdout.write(event.delta.text)
 *   }
 * }
 * ```
 */
export class BedrockModel extends Model<BedrockModelConfig> {
  private _config: BedrockModelConfig
  private _client: BedrockRuntimeClient

  /**
   * Creates a new BedrockModel instance.
   *
   * @param options - Optional configuration for model and client
   *
   * @example
   * ```typescript
   * // Minimal configuration with defaults
   * const provider = new BedrockModel({
   *   region: 'us-west-2'
   * })
   *
   * // With model configuration
   * const provider = new BedrockModel({
   *   region: 'us-west-2',
   *   modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
   *   maxTokens: 2048,
   *   temperature: 0.8,
   *   cachePrompt: 'ephemeral'
   * })
   *
   * // With client configuration
   * const provider = new BedrockModel({
   *   region: 'us-east-1',
   *   clientConfig: {
   *     credentials: myCredentials
   *   }
   * })
   * ```
   */
  constructor(options?: BedrockModelOptions) {
    super()

    const { region, clientConfig, ...modelConfig } = options ?? {}

    // Initialize model config with default model ID if not provided
    this._config = {
      modelId: DEFAULT_BEDROCK_MODEL_ID,
      ...modelConfig,
    }

    // Build user agent string (extend if provided, otherwise use SDK identifier)
    const customUserAgent = clientConfig?.customUserAgent
      ? `${clientConfig.customUserAgent} strands-agents-ts-sdk`
      : 'strands-agents-ts-sdk'

    // Initialize Bedrock Runtime client with custom user agent
    this._client = new BedrockRuntimeClient({
      ...(clientConfig ?? {}),
      // region takes precedence over clientConfig
      ...(region ? { region: region } : {}),
      customUserAgent,
    })
  }

  /**
   * Updates the model configuration.
   * Merges the provided configuration with existing settings.
   *
   * @param modelConfig - Configuration object with model-specific settings to update
   *
   * @example
   * ```typescript
   * // Update temperature and maxTokens
   * provider.updateConfig({
   *   temperature: 0.9,
   *   maxTokens: 2048
   * })
   * ```
   */
  updateConfig(modelConfig: BedrockModelConfig): void {
    this._config = { ...this._config, ...modelConfig }
  }

  /**
   * Retrieves the current model configuration.
   *
   * @returns The current configuration object
   *
   * @example
   * ```typescript
   * const config = provider.getConfig()
   * console.log(config.modelId)
   * ```
   */
  getConfig(): BedrockModelConfig {
    return this._config
  }

  /**
   * Streams a conversation with the Bedrock model.
   * Returns an async iterable that yields streaming events as they occur.
   *
   * @param messages - Array of conversation messages
   * @param options - Optional streaming configuration
   * @returns Async iterable of streaming events
   *
   * @throws \{ContextWindowOverflowError\} When input exceeds the model's context window
   * @throws \{ModelThrottledError\} When Bedrock service throttles requests
   *
   * @example
   * ```typescript
   * const messages: Message[] = [
   *   { type: 'message', role: $1, content: [{ type: 'textBlock', text: 'What is 2+2?' }] }
   * ]
   *
   * const options: StreamOptions = {
   *   systemPrompt: 'You are a helpful math assistant.',
   *   toolSpecs: [calculatorTool]
   * }
   *
   * for await (const event of provider.stream(messages, options)) {
   *   if (event.type === 'modelContentBlockDeltaEvent') {
   *     console.log(event.delta)
   *   }
   * }
   * ```
   */
  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    try {
      // Format the request for Bedrock
      const request = this._formatRequest(messages, options)

      if (this._config.stream !== false) {
        // Create and send the command
        const command = new ConverseStreamCommand(request)
        const response = await this._client.send(command)

        // Stream the response
        if (response.stream) {
          for await (const chunk of response.stream) {
            // Map Bedrock events to SDK events
            const events = this._mapStreamedBedrockEventToSDKEvent(chunk)
            for (const event of events) {
              yield event
            }
          }
        }
      } else {
        const command = new ConverseCommand(request)
        const response = await this._client.send(command)
        for (const event of this._mapBedrockEventToSDKEvent(response)) {
          yield event
        }
      }
    } catch (error) {
      const err = error as Error

      // Check for context window overflow
      if (BEDROCK_CONTEXT_WINDOW_OVERFLOW_MESSAGES.some((msg) => err.message.includes(msg))) {
        throw new ContextWindowOverflowError(err.message)
      }

      // Re-throw other errors as-is
      throw err
    }
  }

  /**
   * Formats a request for the Bedrock Converse Stream API.
   *
   * @param messages - Conversation messages
   * @param options - Stream options
   * @returns Formatted Bedrock request
   */
  private _formatRequest(messages: Message[], options?: StreamOptions): ConverseStreamCommandInput {
    const request: ConverseStreamCommandInput = {
      modelId: this._config.modelId,
      messages: this._formatMessages(messages),
    }

    // Add system prompt with optional caching
    if (options?.systemPrompt !== undefined) {
      if (typeof options.systemPrompt === 'string') {
        // String path: apply cachePrompt config if set
        const system: BedrockContentBlock[] = [{ text: options.systemPrompt }]

        if (this._config.cachePrompt) {
          system.push({ cachePoint: { type: this._config.cachePrompt as 'default' } })
        }

        request.system = system
      } else if (options.systemPrompt.length > 0) {
        // Array path: use as-is, but warn if cachePrompt config is also set
        if (this._config.cachePrompt) {
          console.warn(
            'cachePrompt config is ignored when systemPrompt is an array. Use explicit cache points in the array instead.'
          )
        }

        request.system = options.systemPrompt.map((block) => this._formatContentBlock(block))
      }
    }

    // Add tool configuration
    if (options?.toolSpecs && options.toolSpecs.length > 0) {
      const tools: Tool[] = options.toolSpecs.map(
        (spec) =>
          ({
            toolSpec: {
              name: spec.name,
              description: spec.description,
              inputSchema: { json: spec.inputSchema },
            },
          }) as Tool
      )

      if (this._config.cacheTools) {
        tools.push({
          cachePoint: { type: this._config.cacheTools as 'default' },
        } as Tool)
      }

      const toolConfig: ToolConfiguration = {
        tools: tools,
      }

      if (options.toolChoice) {
        toolConfig.toolChoice = options.toolChoice
      }

      request.toolConfig = toolConfig
    }

    // Add inference configuration
    const inferenceConfig: InferenceConfiguration = {}
    if (this._config.maxTokens !== undefined) inferenceConfig.maxTokens = this._config.maxTokens
    if (this._config.temperature !== undefined) inferenceConfig.temperature = this._config.temperature
    if (this._config.topP !== undefined) inferenceConfig.topP = this._config.topP
    if (this._config.stopSequences !== undefined) inferenceConfig.stopSequences = this._config.stopSequences

    if (Object.keys(inferenceConfig).length > 0) {
      request.inferenceConfig = inferenceConfig
    }

    // Add additional request fields
    if (this._config.additionalRequestFields) {
      request.additionalModelRequestFields = this._config.additionalRequestFields
    }

    // Add additional response field paths
    if (this._config.additionalResponseFieldPaths) {
      request.additionalModelResponseFieldPaths = this._config.additionalResponseFieldPaths
    }

    // Add additional args (spread them into the request for forward compatibility)
    if (this._config.additionalArgs) {
      Object.assign(request, this._config.additionalArgs)
    }

    return request
  }

  /**
   * Formats messages for Bedrock API.
   *
   * @param messages - SDK messages
   * @returns Bedrock-formatted messages
   */
  private _formatMessages(messages: Message[]): BedrockMessage[] {
    return messages.map((message) => ({
      role: message.role,
      content: message.content.map((block) => this._formatContentBlock(block)),
    }))
  }

  /**
   * Determines whether to include the status field in tool results.
   *
   * Uses the includeToolResultStatus config option:
   * - If explicitly true, always include status
   * - If explicitly false, never include status
   * - If 'auto' (default), check if model ID matches known patterns
   *
   * @returns True if status field should be included, false otherwise
   */
  private _shouldIncludeToolResultStatus(): boolean {
    const includeStatus = this._config.includeToolResultStatus ?? 'auto'

    if (includeStatus === true) return true
    if (includeStatus === false) return false

    // Auto-detection mode: check if modelId contains any pattern
    const shouldInclude = MODELS_INCLUDE_STATUS.some((pattern) => this._config.modelId?.includes(pattern))

    // Log debug message for auto-detection
    console.debug(`Auto-detected includeToolResultStatus=${shouldInclude} for model: ${this._config.modelId}`)

    return shouldInclude
  }

  /**
   * Formats a content block for Bedrock API.
   *
   * @param block - SDK content block
   * @returns Bedrock-formatted content block
   */
  private _formatContentBlock(block: ContentBlock | SystemContentBlock): BedrockContentBlock {
    switch (block.type) {
      case 'textBlock':
        return { text: block.text }

      case 'toolUseBlock':
        return {
          toolUse: {
            toolUseId: block.toolUseId,
            name: block.name,
            input: block.input,
          },
        }

      case 'toolResultBlock': {
        const content = block.content.map((content) => {
          switch (content.type) {
            case 'textBlock':
              return { text: content.text }
            case 'jsonBlock':
              return { json: content.json }
          }
        })

        return {
          toolResult: {
            toolUseId: block.toolUseId,
            content,
            ...(this._shouldIncludeToolResultStatus() && { status: block.status }),
          },
        }
      }

      case 'reasoningBlock': {
        if (block.text) {
          return {
            reasoningContent: {
              reasoningText: {
                text: block.text,
                signature: block.signature,
              },
            },
          }
        } else if (block.redactedContent) {
          return {
            reasoningContent: {
              redactedContent: block.redactedContent,
            },
          }
        } else {
          throw Error("reasoning content format incorrect. Either 'text' or 'redactedContent' must be set.")
        }
      }

      case 'cachePointBlock':
        return { cachePoint: { type: block.cacheType } }

      case 'guardContentBlock': {
        if (block.text) {
          return {
            guardContent: {
              text: {
                text: block.text.text,
                qualifiers: block.text.qualifiers,
              },
            },
          }
        } else if (block.image) {
          return {
            guardContent: {
              image: {
                format: block.image.format,
                source: { bytes: block.image.source.bytes },
              },
            },
          }
        } else {
          throw new Error('GuardContentBlock must have either text or image content')
        }
      }
    }
  }

  private _mapBedrockEventToSDKEvent(event: ConverseCommandOutput): ModelStreamEvent[] {
    const events: ModelStreamEvent[] = []

    // Message start
    const output = ensureDefined(event.output, 'event.output')
    const message = ensureDefined(output.message, 'output.message')
    const role = ensureDefined(message.role, 'message.role')
    events.push({
      type: 'modelMessageStartEvent',
      role,
    })

    // Match on content blocks
    const blockHandlers = {
      text: (textBlock: string): void => {
        events.push({ type: 'modelContentBlockStartEvent' })
        events.push({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: textBlock },
        })
        events.push({ type: 'modelContentBlockStopEvent' })
      },
      toolUse: (block: ToolUseBlock): void => {
        events.push({
          type: 'modelContentBlockStartEvent',
          start: {
            type: 'toolUseStart',
            name: ensureDefined(block.name, 'toolUse.name'),
            toolUseId: ensureDefined(block.toolUseId, 'toolUse.toolUseId'),
          },
        })
        events.push({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'toolUseInputDelta', input: JSON.stringify(ensureDefined(block.input, 'toolUse.input')) },
        })
        events.push({ type: 'modelContentBlockStopEvent' })
      },
      reasoningContent: (block: ReasoningContentBlock): void => {
        if (!block) return
        events.push({ type: 'modelContentBlockStartEvent' })

        const delta: ReasoningContentDelta = { type: 'reasoningContentDelta' }
        if (block.reasoningText) {
          delta.text = ensureDefined(block.reasoningText.text, 'reasoningText.text')
          if (block.reasoningText.signature) delta.signature = block.reasoningText.signature
        } else if (block.redactedContent) {
          delta.redactedContent = block.redactedContent
        }

        if (Object.keys(delta).length > 1) {
          events.push({ type: 'modelContentBlockDeltaEvent', delta })
        }

        events.push({ type: 'modelContentBlockStopEvent' })
      },
    }

    const content = ensureDefined(message.content, 'message.content')
    content.forEach((block) => {
      for (const key in block) {
        if (key in blockHandlers) {
          const handlerKey = key as keyof typeof blockHandlers
          // @ts-expect-error - We know the value type corresponds to the handler key.
          blockHandlers[handlerKey](block[handlerKey])
        } else {
          console.warn(`Skipping unsupported block key: ${key}`)
        }
      }
    })

    const stopReasonRaw = ensureDefined(event.stopReason, 'event.stopReason') as string
    events.push({
      type: 'modelMessageStopEvent',
      stopReason: this._transformStopReason(stopReasonRaw, event),
    })

    const usage = ensureDefined(event.usage, 'output.usage')
    const metadataEvent: ModelStreamEvent = {
      type: 'modelMetadataEvent',
      usage: {
        inputTokens: ensureDefined(usage.inputTokens, 'usage.inputTokens'),
        outputTokens: ensureDefined(usage.outputTokens, 'usage.outputTokens'),
        totalTokens: ensureDefined(usage.totalTokens, 'usage.totalTokens'),
      },
    }

    if (event.metrics) {
      metadataEvent.metrics = {
        latencyMs: ensureDefined(event.metrics.latencyMs, 'metrics.latencyMs'),
      }
    }

    events.push(metadataEvent)

    return events
  }

  /**
   * Maps a Bedrock event to SDK streaming events.
   *
   * @param chunk - Bedrock event chunk
   * @returns Array of SDK streaming events
   */
  private _mapStreamedBedrockEventToSDKEvent(chunk: ConverseStreamOutput): ModelStreamEvent[] {
    const events: ModelStreamEvent[] = []

    // Extract the event type key
    const eventType = ensureDefined(Object.keys(chunk)[0], 'eventType') as keyof ConverseStreamOutput
    const eventData = chunk[eventType as keyof ConverseStreamOutput]

    switch (eventType) {
      case 'messageStart': {
        const data = eventData as BedrockMessageStartEvent
        events.push({
          type: 'modelMessageStartEvent',
          role: ensureDefined(data.role, 'messageStart.role'),
        })
        break
      }

      case 'contentBlockStart': {
        const data = eventData as BedrockContentBlockStartEvent

        const event: ModelStreamEvent = {
          type: 'modelContentBlockStartEvent',
        }

        if (data.start?.toolUse) {
          const toolUse = data.start.toolUse
          event.start = {
            type: 'toolUseStart',
            name: ensureDefined(toolUse.name, 'toolUse.name'),
            toolUseId: ensureDefined(toolUse.toolUseId, 'toolUse.toolUseId'),
          }
        }

        events.push(event)
        break
      }

      case 'contentBlockDelta': {
        const data = eventData as BedrockContentBlockDeltaEvent
        const delta = ensureDefined(data.delta, 'contentBlockDelta.delta')
        const deltaHandlers = {
          text: (textValue: string): void => {
            events.push({
              type: 'modelContentBlockDeltaEvent',
              delta: { type: 'textDelta', text: textValue },
            })
          },
          toolUse: (toolUse: ToolUseBlockDelta): void => {
            if (!toolUse?.input) return
            events.push({
              type: 'modelContentBlockDeltaEvent',
              delta: { type: 'toolUseInputDelta', input: toolUse.input },
            })
          },
          reasoningContent: (reasoning: ReasoningContentBlockDelta): void => {
            if (!reasoning) return
            const reasoningDelta: ReasoningContentDelta = { type: 'reasoningContentDelta' }
            if (reasoning.text) reasoningDelta.text = reasoning.text
            if (reasoning.signature) reasoningDelta.signature = reasoning.signature
            if (reasoning.redactedContent) reasoningDelta.redactedContent = reasoning.redactedContent

            if (Object.keys(reasoningDelta).length > 1) {
              events.push({ type: 'modelContentBlockDeltaEvent', delta: reasoningDelta })
            }
          },
        }

        for (const key in delta) {
          if (key in deltaHandlers) {
            const handlerKey = key as keyof typeof deltaHandlers
            // @ts-expect-error - We know the value type corresponds to the handler key.
            deltaHandlers[handlerKey](delta[handlerKey])
          } else {
            console.warn(`Skipping unsupported delta key: ${key}`)
          }
        }

        break
      }

      case 'contentBlockStop': {
        events.push({
          type: 'modelContentBlockStopEvent',
        })
        break
      }

      case 'messageStop': {
        const data = eventData as BedrockMessageStopEvent

        const stopReasonRaw = ensureDefined(data.stopReason, 'messageStop.stopReason') as string
        const event: ModelStreamEvent = {
          type: 'modelMessageStopEvent',
          stopReason: this._transformStopReason(stopReasonRaw, data),
        }

        if (data.additionalModelResponseFields) {
          event.additionalModelResponseFields = data.additionalModelResponseFields
        }

        events.push(event)
        break
      }

      case 'metadata': {
        const data = eventData as BedrockConverseStreamMetadataEvent

        const event: ModelStreamEvent = {
          type: 'modelMetadataEvent',
        }

        if (data.usage) {
          const usage = data.usage

          const usageInfo: Usage = {
            inputTokens: ensureDefined(usage.inputTokens, 'usage.inputTokens'),
            outputTokens: ensureDefined(usage.outputTokens, 'usage.outputTokens'),
            totalTokens: ensureDefined(usage.totalTokens, 'usage.totalTokens'),
          }

          if (usage.cacheReadInputTokens !== undefined) {
            usageInfo.cacheReadInputTokens = usage.cacheReadInputTokens
          }
          if (usage.cacheWriteInputTokens !== undefined) {
            usageInfo.cacheWriteInputTokens = usage.cacheWriteInputTokens
          }

          event.usage = usageInfo
        }

        if (data.metrics) {
          event.metrics = {
            latencyMs: ensureDefined(data.metrics.latencyMs, 'metrics.latencyMs'),
          }
        }

        if (data.trace) {
          event.trace = data.trace
        }

        events.push(event)
        break
      }
      case 'internalServerException':
      case 'modelStreamErrorException':
      case 'serviceUnavailableException':
      case 'validationException':
      case 'throttlingException': {
        throw eventData
      }
      default:
        // Log warning for unsupported event types (for forward compatibility)
        console.warn(`Unsupported Bedrock event type: ${eventType}`)
        break
    }

    return events
  }

  /**
   * Transforms a Bedrock stop reason into the SDK's format.
   *
   * @param stopReasonRaw - The raw stop reason string from Bedrock.
   * @param event - The full event output, used to check for tool_use adjustments.
   * @returns The transformed stop reason string.
   */
  private _transformStopReason(stopReasonRaw: string, event?: ConverseCommandOutput | BedrockMessageStopEvent): string {
    let mappedStopReason: string

    if (stopReasonRaw in STOP_REASON_MAP) {
      mappedStopReason = STOP_REASON_MAP[stopReasonRaw as keyof typeof STOP_REASON_MAP]
    } else {
      console.warn(`Unknown stop reason: "${stopReasonRaw}". Converting to camelCase: "${snakeToCamel(stopReasonRaw)}"`)
      mappedStopReason = snakeToCamel(stopReasonRaw)
    }

    // Adjust for tool_use, which is sometimes incorrectly reported as end_turn
    if (
      mappedStopReason === 'endTurn' &&
      event &&
      'output' in event &&
      event.output?.message?.content?.some((block) => 'toolUse' in block)
    ) {
      mappedStopReason = 'toolUse'
      console.warn(`Adjusting stop reason from 'end_turn' to 'tool_use' due to tool use in content blocks.`)
    }

    return mappedStopReason
  }
}
