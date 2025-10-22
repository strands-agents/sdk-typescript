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
  ConverseStreamCommand,
  ThrottlingException,
  type BedrockRuntimeClientConfig,
  type ConverseStreamCommandInput,
  type ConverseStreamOutput,
  type Message as BedrockMessage,
  type ContentBlock as BedrockContentBlock,
  type InferenceConfiguration,
  type Tool,
  type MessageStartEvent as BedrockMessageStartEvent,
  type ContentBlockStartEvent as BedrockContentBlockStartEvent,
  type ContentBlockDeltaEvent as BedrockContentBlockDeltaEvent,
  type ContentBlockStopEvent as BedrockContentBlockStopEvent,
  type MessageStopEvent as BedrockMessageStopEvent,
  type ConverseStreamMetadataEvent as BedrockConverseStreamMetadataEvent,
} from '@aws-sdk/client-bedrock-runtime'
import type { ModelProvider, BaseModelConfig, StreamOptions } from '../models/model'
import type { Message, ContentBlock, Role } from '../types/messages'
import type { ModelProviderStreamEvent, ReasoningDelta, Usage } from '../models/streaming'
import type { JSONValue } from '../types/json'
import { ContextWindowOverflowError, ModelThrottledError } from '../errors'

/**
 * Default Bedrock model ID.
 * Uses Claude Sonnet 4.5 with global inference profile for cross-region availability.
 */
export const DEFAULT_BEDROCK_MODEL_ID = 'global.anthropic.claude-sonnet-4-5-20250929-v1:0'

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
}

/**
 * Options for creating a BedrockModelProvider instance.
 */
export interface BedrockModelProviderOptions {
  /**
   * Configuration for the Bedrock model.
   */
  modelConfig?: BedrockModelConfig

  /**
   * Configuration for the Bedrock Runtime client.
   */
  clientConfig?: BedrockRuntimeClientConfig
}

/**
 * AWS Bedrock model provider implementation.
 *
 * Implements the ModelProvider interface for AWS Bedrock using the Converse Stream API.
 * Supports streaming responses, tool use, prompt caching, and comprehensive error handling.
 *
 * @example
 * ```typescript
 * const provider = new BedrockModelProvider({
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
 *   { role: 'user', content: [{ type: 'textBlock', text: 'Hello!' }] }
 * ]
 *
 * for await (const event of provider.stream(messages)) {
 *   if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
 *     process.stdout.write(event.delta.text)
 *   }
 * }
 * ```
 */
export class BedrockModelProvider implements ModelProvider<BedrockModelConfig, BedrockRuntimeClientConfig> {
  private config: BedrockModelConfig
  private client: BedrockRuntimeClient

  /**
   * Creates a new BedrockModelProvider instance.
   *
   * @param options - Optional configuration for model and client
   *
   * @example
   * ```typescript
   * // Minimal configuration with defaults
   * const provider = new BedrockModelProvider()
   *
   * // With model configuration
   * const provider = new BedrockModelProvider({
   *   modelConfig: {
   *     modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
   *     maxTokens: 2048,
   *     temperature: 0.8,
   *     cachePrompt: 'ephemeral'
   *   }
   * })
   *
   * // With client configuration
   * const provider = new BedrockModelProvider({
   *   clientConfig: {
   *     region: 'us-east-1',
   *     credentials: myCredentials
   *   }
   * })
   * ```
   */
  constructor(options?: BedrockModelProviderOptions) {
    const modelConfig = options?.modelConfig || {}
    const clientConfig = options?.clientConfig || {}

    // Initialize model config with default model ID if not provided
    this.config = {
      modelId: DEFAULT_BEDROCK_MODEL_ID,
      ...modelConfig,
    }

    // Build user agent string (extend if provided, otherwise use SDK identifier)
    const customUserAgent = clientConfig.customUserAgent
      ? `${clientConfig.customUserAgent} strands-agents-ts-sdk`
      : 'strands-agents-ts-sdk'

    // Initialize Bedrock Runtime client with custom user agent
    this.client = new BedrockRuntimeClient({
      ...clientConfig,
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
    this.config = { ...this.config, ...modelConfig }
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
    return this.config
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
   *   { role: 'user', content: [{ type: 'textBlock', text: 'What is 2+2?' }] }
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
  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelProviderStreamEvent> {
    try {
      // Format the request for Bedrock
      const request = this.formatRequest(messages, options)

      // Create and send the command
      const command = new ConverseStreamCommand(request)
      const response = await this.client.send(command)

      // Stream the response
      if (response.stream) {
        for await (const chunk of response.stream) {
          // Map Bedrock events to SDK events
          const events = this.mapBedrockEventToSDKEvents(chunk)
          for (const event of events) {
            yield event
          }
        }
      }
    } catch (error) {
      const err = error as Error

      // Check for throttling (check this first as it's most specific)
      if (err instanceof ThrottlingException) {
        throw new ModelThrottledError(err.message)
      }

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
  private formatRequest(messages: Message[], options?: StreamOptions): ConverseStreamCommandInput {
    const request: ConverseStreamCommandInput = {
      modelId: this.config.modelId,
      messages: this.formatMessages(messages),
    }

    // Add system prompt with optional caching
    if (options?.systemPrompt || this.config.cachePrompt) {
      const system: BedrockContentBlock[] = []

      if (options?.systemPrompt) {
        system.push({ text: options.systemPrompt })
      }

      if (this.config.cachePrompt) {
        system.push({ cachePoint: { type: this.config.cachePrompt as 'default' } })
      }

      request.system = system
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

      if (this.config.cacheTools) {
        tools.push({
          cachePoint: { type: this.config.cacheTools as 'default' },
        } as Tool)
      }

      const toolConfig = {
        tools: tools,
      }

      if (options.toolChoice) {
        Object.assign(toolConfig, { toolChoice: options.toolChoice as JSONValue })
      }

      request.toolConfig = toolConfig
    }

    // Add inference configuration
    const inferenceConfig: InferenceConfiguration = {}
    if (this.config.maxTokens !== undefined) inferenceConfig.maxTokens = this.config.maxTokens
    if (this.config.temperature !== undefined) inferenceConfig.temperature = this.config.temperature
    if (this.config.topP !== undefined) inferenceConfig.topP = this.config.topP
    if (this.config.stopSequences !== undefined) inferenceConfig.stopSequences = this.config.stopSequences

    if (Object.keys(inferenceConfig).length > 0) {
      request.inferenceConfig = inferenceConfig
    }

    // Add additional request fields
    if (this.config.additionalRequestFields) {
      request.additionalModelRequestFields = this.config.additionalRequestFields
    }

    // Add additional response field paths
    if (this.config.additionalResponseFieldPaths) {
      request.additionalModelResponseFieldPaths = this.config.additionalResponseFieldPaths
    }

    // Add additional args (spread them into the request for forward compatibility)
    if (this.config.additionalArgs) {
      Object.assign(request, this.config.additionalArgs)
    }

    return request
  }

  /**
   * Formats messages for Bedrock API.
   *
   * @param messages - SDK messages
   * @returns Bedrock-formatted messages
   */
  private formatMessages(messages: Message[]): BedrockMessage[] {
    return messages.map((message) => ({
      role: message.role,
      content: message.content.map((block) => this.formatContentBlock(block)),
    }))
  }

  /**
   * Formats a content block for Bedrock API.
   *
   * @param block - SDK content block
   * @returns Bedrock-formatted content block
   */
  private formatContentBlock(block: ContentBlock): BedrockContentBlock {
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
            case 'toolResultTextContent':
              return { text: content.text }
            case 'toolResultJsonContent':
              return { json: content.json }
            default:
              throw new Error(`Unsupported tool result content type: ${JSON.stringify(content)}`)
          }
        })

        return {
          toolResult: {
            toolUseId: block.toolUseId,
            content,
            status: block.status,
          },
        }
      }

      default:
        throw new Error(`Unsupported content block type: ${JSON.stringify(block)}`)
    }
  }

  /**
   * Maps a Bedrock event to SDK streaming events.
   *
   * @param chunk - Bedrock event chunk
   * @returns Array of SDK streaming events
   */
  /**
   * Maps a Bedrock event to SDK streaming events.
   *
   * @param chunk - Bedrock event chunk
   * @returns Array of SDK streaming events
   */
  private mapBedrockEventToSDKEvents(chunk: ConverseStreamOutput): ModelProviderStreamEvent[] {
    const events: ModelProviderStreamEvent[] = []

    // Extract the event type key
    const eventKeys = Object.keys(chunk)
    if (eventKeys.length === 0) {
      throw new Error('Invalid chunk: no event keys present')
    }

    const eventType = eventKeys[0]! as keyof ConverseStreamOutput
    const eventData = chunk[eventType as keyof ConverseStreamOutput]

    switch (eventType) {
      case 'messageStart': {
        const data = eventData as BedrockMessageStartEvent
        events.push({
          type: 'modelMessageStartEvent',
          role: data.role! as Role,
        })
        break
      }

      case 'contentBlockStart': {
        const data = eventData as BedrockContentBlockStartEvent

        const event: ModelProviderStreamEvent = {
          type: 'modelContentBlockStartEvent',
        }

        if ('contentBlockIndex' in data) {
          event.contentBlockIndex = data.contentBlockIndex as number
        }

        if ('start' in data && data.start && 'toolUse' in data.start) {
          const toolUse = data.start.toolUse
          event.start = {
            type: 'toolUseStart',
            name: toolUse.name! as string,
            toolUseId: toolUse.toolUseId! as string,
          }
        }

        events.push(event)
        break
      }

      case 'contentBlockDelta': {
        const data = eventData as BedrockContentBlockDeltaEvent
        const delta = data.delta!
        const event: ModelProviderStreamEvent = {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: '' },
        }

        if ('contentBlockIndex' in data) {
          event.contentBlockIndex = data.contentBlockIndex as number
        }

        const deltaKey = Object.keys(delta)[0]!

        switch (deltaKey) {
          case 'text': {
            event.delta = {
              type: 'textDelta',
              text: delta.text! as string,
            }
            break
          }
          case 'toolUse': {
            event.delta = {
              type: 'toolUseInputDelta',
              input: delta.toolUse!.input! as string,
            }
            break
          }
          case 'reasoningContent': {
            const reasoning = delta.reasoningContent!
            const reasoningDelta: ReasoningDelta = {
              type: 'reasoningDelta',
            }
            if (reasoning.text) reasoningDelta.text = reasoning.text as string
            if (reasoning.signature) reasoningDelta.signature = reasoning.signature as string
            event.delta = reasoningDelta
            break
          }
          default: {
            console.warn(`Unsupported delta format: ${JSON.stringify(delta)}`)
            break
          }
        }

        events.push(event)
        break
      }

      case 'contentBlockStop': {
        const data = eventData as BedrockContentBlockStopEvent

        const event: ModelProviderStreamEvent = {
          type: 'modelContentBlockStopEvent',
        }

        if ('contentBlockIndex' in data) {
          event.contentBlockIndex = data.contentBlockIndex as number
        }

        events.push(event)
        break
      }

      case 'messageStop': {
        const data = eventData as BedrockMessageStopEvent

        const event: ModelProviderStreamEvent = {
          type: 'modelMessageStopEvent',
        }

        const stopReason = data.stopReason! as string
        const mappedStopReason =
          stopReason === 'end_turn'
            ? 'endTurn'
            : stopReason === 'tool_use'
              ? 'toolUse'
              : stopReason === 'max_tokens'
                ? 'maxTokens'
                : stopReason === 'stop_sequence'
                  ? 'stopSequence'
                  : stopReason === 'content_filtered'
                    ? 'contentFiltered'
                    : stopReason === 'guardrail_intervened'
                      ? 'guardrailIntervened'
                      : undefined

        event.stopReason = mappedStopReason!

        if ('additionalModelResponseFields' in data) {
          event.additionalModelResponseFields = data.additionalModelResponseFields as JSONValue
        }

        events.push(event)
        break
      }

      case 'metadata': {
        const data = eventData as BedrockConverseStreamMetadataEvent

        const event: ModelProviderStreamEvent = {
          type: 'modelMetadataEvent',
        }

        if (data.usage) {
          const usage = data.usage

          const usageInfo: Usage = {
            inputTokens: usage.inputTokens!,
            outputTokens: usage.outputTokens!,
            totalTokens: usage.totalTokens!,
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
            latencyMs: data.metrics.latencyMs!,
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
}
