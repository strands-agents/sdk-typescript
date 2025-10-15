/**
 * AWS Bedrock model provider implementation.
 *
 * This module provides integration with AWS Bedrock's Converse API,
 * supporting streaming responses, tool use, and prompt caching.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html
 */

import { BedrockRuntimeClient, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime'
import type { AwsCredentialIdentity } from '@aws-sdk/types'
import type { BaseModelConfig, ModelProvider, StreamOptions } from '@/models/model'
import type { Message, ContentBlock } from '@/types/messages'
import type { ModelProviderStreamEvent } from '@/models/streaming'
import type { JSONValue } from '@/types/json'
import { ContextWindowOverflowError, ModelThrottledError } from '@/errors'

/**
 * Default Bedrock model ID.
 * Uses Claude Sonnet 4.5 with global inference profile for cross-region availability.
 */
export const DEFAULT_BEDROCK_MODEL_ID = 'global.anthropic.claude-sonnet-4-5-20250929-v1:0'

/**
 * Default AWS region for Bedrock client.
 */
export const DEFAULT_BEDROCK_REGION = 'us-west-2'

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
 * Configuration interface for AWS Bedrock client initialization.
 *
 * This configuration controls how the Bedrock Runtime client is initialized,
 * including region selection, custom endpoints, and credential management.
 *
 * @example
 * ```typescript
 * // Use default credential chain with specific region
 * const clientConfig: BedrockClientConfig = {
 *   region: 'us-east-1'
 * }
 *
 * // Use custom endpoint for VPC/PrivateLink
 * const vpcConfig: BedrockClientConfig = {
 *   region: 'us-west-2',
 *   endpoint: 'https://vpce-abc123.bedrock-runtime.us-west-2.vpce.amazonaws.com'
 * }
 *
 * // Override credentials
 * const credConfig: BedrockClientConfig = {
 *   region: 'us-west-2',
 *   credentials: {
 *     accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
 *     secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
 *   }
 * }
 * ```
 */
export interface BedrockClientConfig {
  /**
   * AWS region for the Bedrock service.
   *
   * If not specified, will use:
   * 1. AWS_REGION environment variable
   * 2. Default region from AWS credential chain
   * 3. DEFAULT_BEDROCK_REGION constant ('us-west-2')
   */
  region?: string

  /**
   * Custom endpoint URL for VPC endpoints (AWS PrivateLink).
   *
   * Use this when accessing Bedrock through a VPC endpoint for enhanced security
   * and to keep traffic within your VPC.
   *
   * @example
   * ```typescript
   * endpoint: 'https://vpce-abc123.bedrock-runtime.us-west-2.vpce.amazonaws.com'
   * ```
   */
  endpoint?: string

  /**
   * Optional credential override for AWS authentication.
   *
   * If not provided, the AWS SDK will use the default credential chain:
   * 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
   * 2. Shared credentials file (~/.aws/credentials)
   * 3. ECS/EC2 instance metadata
   *
   * @example
   * ```typescript
   * credentials: {
   *   accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
   *   secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
   *   sessionToken: 'optional-session-token'
   * }
   * ```
   */
  credentials?: AwsCredentialIdentity
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
   *
   * This controls the length of the model's output. The actual number of tokens
   * generated may be less if the model naturally completes its response.
   *
   * @example
   * ```typescript
   * maxTokens: 1024  // Generate up to 1024 tokens
   * ```
   */
  maxTokens?: number

  /**
   * Controls randomness in generation.
   *
   * Higher values (e.g., 0.8) make output more random and creative.
   * Lower values (e.g., 0.2) make output more focused and deterministic.
   *
   * Range: 0 to 1
   *
   * @example
   * ```typescript
   * temperature: 0.7  // Balanced creativity and focus
   * ```
   */
  temperature?: number

  /**
   * Controls diversity via nucleus sampling.
   *
   * An alternative to temperature. The model considers the results of tokens
   * with top_p probability mass.
   *
   * Range: 0 to 1
   *
   * @example
   * ```typescript
   * topP: 0.9  // Consider tokens in the top 90% probability mass
   * ```
   */
  topP?: number

  /**
   * Array of sequences that will stop generation when encountered.
   *
   * When the model generates any of these sequences, it will immediately
   * stop generation and return the response.
   *
   * @example
   * ```typescript
   * stopSequences: ['END', 'STOP', '###']
   * ```
   */
  stopSequences?: string[]

  /**
   * Cache point type for the system prompt.
   *
   * Enables prompt caching to reduce latency and cost for repeated requests
   * with the same system prompt.
   *
   * Supported values: 'ephemeral', 'default'
   *
   * @see https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
   *
   * @example
   * ```typescript
   * cachePrompt: 'ephemeral'  // Cache the system prompt
   * ```
   */
  cachePrompt?: string

  /**
   * Cache point type for tools.
   *
   * Enables prompt caching for tool definitions to reduce latency and cost
   * when using the same tools across multiple requests.
   *
   * Supported values: 'ephemeral', 'default'
   *
   * @see https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
   *
   * @example
   * ```typescript
   * cacheTools: 'ephemeral'  // Cache tool definitions
   * ```
   */
  cacheTools?: string

  /**
   * Additional fields to include in the Bedrock request.
   *
   * Use this for provider-specific features not directly supported by the SDK.
   * These fields are merged into the request sent to Bedrock.
   *
   * @example
   * ```typescript
   * additionalRequestFields: {
   *   customField: 'value'
   * }
   * ```
   */
  additionalRequestFields?: Record<string, unknown>

  /**
   * Additional response field paths to extract from the Bedrock response.
   *
   * Specify paths to custom fields in the response that should be included
   * in the returned metadata.
   *
   * @example
   * ```typescript
   * additionalResponseFieldPaths: [
   *   '/customMetadata/field1',
   *   '/customMetadata/field2'
   * ]
   * ```
   */
  additionalResponseFieldPaths?: string[]

  /**
   * Whether to include status field in tool results.
   *
   * When true, tool results will include a 'status' field ('success' or 'error').
   * When false, the status field will be omitted.
   *
   * Default: true
   *
   * Note: In a future update, this will support 'auto' mode which will
   * automatically determine whether to include status based on the model ID.
   *
   * @example
   * ```typescript
   * includeToolResultStatus: true  // Include status field
   * ```
   */
  includeToolResultStatus?: boolean
}

/**
 * AWS Bedrock model provider implementation.
 *
 * Implements the ModelProvider interface for AWS Bedrock using the Converse Stream API.
 * Supports streaming responses, tool use, prompt caching, and comprehensive error handling.
 *
 * @example
 * ```typescript
 * const provider = new BedrockModelProvider(
 *   {
 *     modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
 *     maxTokens: 1024,
 *     temperature: 0.7
 *   },
 *   {
 *     region: 'us-west-2'
 *   }
 * )
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
export class BedrockModelProvider implements ModelProvider<BedrockModelConfig, BedrockClientConfig> {
  private config: BedrockModelConfig
  private client: BedrockRuntimeClient

  /**
   * Creates a new BedrockModelProvider instance.
   *
   * @param modelConfig - Configuration for the Bedrock model
   * @param clientConfig - Configuration for the Bedrock Runtime client
   *
   * @example
   * ```typescript
   * // Minimal configuration with defaults
   * const provider = new BedrockModelProvider({}, {})
   *
   * // Full configuration
   * const provider = new BedrockModelProvider(
   *   {
   *     modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
   *     maxTokens: 2048,
   *     temperature: 0.8,
   *     cachePrompt: 'ephemeral'
   *   },
   *   {
   *     region: 'us-east-1',
   *     credentials: myCredentials
   *   }
   * )
   * ```
   */
  constructor(modelConfig: BedrockModelConfig, clientConfig: BedrockClientConfig) {
    // Initialize model config with default model ID if not provided
    this.config = {
      modelId: DEFAULT_BEDROCK_MODEL_ID,
      includeToolResultStatus: true,
      ...modelConfig,
    }

    // Determine region from clientConfig, environment, or default
    // eslint-disable-next-line no-undef
    const region = clientConfig.region || process.env.AWS_REGION || DEFAULT_BEDROCK_REGION

    // Build client configuration, only including defined values
    const clientInitConfig: {
      region: string
      endpoint?: string
      credentials?: AwsCredentialIdentity
      customUserAgent: string
    } = {
      region,
      customUserAgent: 'strands-agents-ts-sdk',
    }

    // Only add endpoint if provided
    if (clientConfig.endpoint) {
      clientInitConfig.endpoint = clientConfig.endpoint
    }

    // Only add credentials if provided
    if (clientConfig.credentials) {
      clientInitConfig.credentials = clientConfig.credentials
    }

    // Initialize Bedrock Runtime client
    this.client = new BedrockRuntimeClient(clientInitConfig)
  }

  /**
   * Updates the model configuration.
   * Merges the provided configuration with existing settings.
   *
   * @param modelConfig - Partial configuration object with model-specific settings to update
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
  updateConfig(modelConfig: Partial<BedrockModelConfig>): void {
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
      const command = new ConverseStreamCommand(request as never)
      const response = await this.client.send(command)

      // Stream the response
      if (response.stream) {
        for await (const chunk of response.stream) {
          // Map Bedrock events to SDK events
          const events = this.mapBedrockEventToSDKEvents(chunk as never)
          for (const event of events) {
            yield event
          }
        }
      }
    } catch (error) {
      // Detect and throw specific error types
      this.handleError(error)
    }
  }

  /**
   * Formats a request for the Bedrock Converse Stream API.
   *
   * @param messages - Conversation messages
   * @param options - Stream options
   * @returns Formatted Bedrock request
   */
  private formatRequest(messages: Message[], options?: StreamOptions): Record<string, unknown> {
    const request: Record<string, unknown> = {
      modelId: this.config.modelId,
      messages: this.formatMessages(messages),
    }

    // Add system prompt with optional caching
    if (options?.systemPrompt || this.config.cachePrompt) {
      const system: unknown[] = []

      if (options?.systemPrompt) {
        system.push({ text: options.systemPrompt })
      }

      if (this.config.cachePrompt) {
        system.push({ cachePoint: { type: this.config.cachePrompt } })
      }

      request.system = system
    }

    // Add tool configuration
    if (options?.toolSpecs && options.toolSpecs.length > 0) {
      const tools: unknown[] = options.toolSpecs.map((spec) => ({
        toolSpec: {
          name: spec.name,
          description: spec.description,
          inputSchema: { json: spec.inputSchema },
        },
      }))

      if (this.config.cacheTools) {
        tools.push({ cachePoint: { type: this.config.cacheTools } })
      }

      const toolConfig: Record<string, unknown> = {
        tools,
      }

      if (options.toolChoice) {
        toolConfig.toolChoice = options.toolChoice
      }

      request.toolConfig = toolConfig
    }

    // Add inference configuration
    const inferenceConfig: Record<string, unknown> = {}
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

    return request
  }

  /**
   * Formats messages for Bedrock API.
   *
   * @param messages - SDK messages
   * @returns Bedrock-formatted messages
   */
  private formatMessages(messages: Message[]): unknown[] {
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
  private formatContentBlock(block: ContentBlock): unknown {
    if (block.type === 'textBlock') {
      return { text: block.text }
    }

    if (block.type === 'toolUseBlock') {
      return {
        toolUse: {
          toolUseId: block.toolUseId,
          name: block.name,
          input: block.input,
        },
      }
    }

    if (block.type === 'toolResultBlock') {
      const toolResult: Record<string, unknown> = {
        toolUseId: block.toolUseId,
        content: block.content.map((content) => {
          if (content.type === 'toolResultTextContent') {
            return { text: content.text }
          }
          if (content.type === 'toolResultJsonContent') {
            return { json: content.json }
          }
          return { text: JSON.stringify(content) }
        }),
      }

      if (this.config.includeToolResultStatus !== false) {
        toolResult.status = block.status
      }

      return { toolResult }
    }

    // For unsupported content types, pass through as-is
    // This allows for graceful degradation and future compatibility
    return block
  }

  /**
   * Maps a Bedrock event to SDK streaming events.
   *
   * @param chunk - Bedrock event chunk
   * @returns Array of SDK streaming events
   */
  private mapBedrockEventToSDKEvents(chunk: Record<string, unknown>): ModelProviderStreamEvent[] {
    const events: ModelProviderStreamEvent[] = []

    // Message start event
    if ('messageStart' in chunk && chunk.messageStart && typeof chunk.messageStart === 'object') {
      const messageStart = chunk.messageStart as Record<string, unknown>
      events.push({
        type: 'modelMessageStartEvent',
        role: (messageStart.role as 'user' | 'assistant') || 'assistant',
      })
    }

    // Content block start event
    if ('contentBlockStart' in chunk && chunk.contentBlockStart && typeof chunk.contentBlockStart === 'object') {
      const contentBlockStart = chunk.contentBlockStart as Record<string, unknown>
      const event: ModelProviderStreamEvent = {
        type: 'modelContentBlockStartEvent',
      }

      if ('contentBlockIndex' in contentBlockStart) {
        event.contentBlockIndex = contentBlockStart.contentBlockIndex as number
      }

      if ('start' in contentBlockStart && contentBlockStart.start && typeof contentBlockStart.start === 'object') {
        const start = contentBlockStart.start as Record<string, unknown>
        if ('toolUse' in start && start.toolUse && typeof start.toolUse === 'object') {
          const toolUse = start.toolUse as Record<string, unknown>
          event.start = {
            type: 'toolUseStart',
            name: toolUse.name as string,
            toolUseId: toolUse.toolUseId as string,
          }
        }
      }

      events.push(event)
    }

    // Content block delta event
    if ('contentBlockDelta' in chunk && chunk.contentBlockDelta && typeof chunk.contentBlockDelta === 'object') {
      const contentBlockDelta = chunk.contentBlockDelta as Record<string, unknown>
      const delta = contentBlockDelta.delta as Record<string, unknown>

      if (delta) {
        const event: ModelProviderStreamEvent = {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: '' },
        }

        if ('contentBlockIndex' in contentBlockDelta) {
          event.contentBlockIndex = contentBlockDelta.contentBlockIndex as number
        }

        // Text delta
        if ('text' in delta) {
          event.delta = {
            type: 'textDelta',
            text: delta.text as string,
          }
        }

        // Tool use input delta
        if ('toolUse' in delta && delta.toolUse && typeof delta.toolUse === 'object') {
          const toolUse = delta.toolUse as Record<string, unknown>
          event.delta = {
            type: 'toolUseInputDelta',
            input: toolUse.input as string,
          }
        }

        // Reasoning delta
        if ('reasoningContent' in delta && delta.reasoningContent && typeof delta.reasoningContent === 'object') {
          const reasoning = delta.reasoningContent as Record<string, unknown>
          const reasoningDelta: { type: 'reasoningDelta'; text?: string; signature?: string } = {
            type: 'reasoningDelta',
          }
          if (reasoning.text) reasoningDelta.text = reasoning.text as string
          if (reasoning.signature) reasoningDelta.signature = reasoning.signature as string
          event.delta = reasoningDelta
        }

        events.push(event)
      }
    }

    // Content block stop event
    if ('contentBlockStop' in chunk && chunk.contentBlockStop && typeof chunk.contentBlockStop === 'object') {
      const contentBlockStop = chunk.contentBlockStop as Record<string, unknown>
      const event: ModelProviderStreamEvent = {
        type: 'modelContentBlockStopEvent',
      }

      if ('contentBlockIndex' in contentBlockStop) {
        event.contentBlockIndex = contentBlockStop.contentBlockIndex as number
      }

      events.push(event)
    }

    // Message stop event
    if ('messageStop' in chunk && chunk.messageStop && typeof chunk.messageStop === 'object') {
      const messageStop = chunk.messageStop as Record<string, unknown>
      const event: ModelProviderStreamEvent = {
        type: 'modelMessageStopEvent',
      }

      if ('stopReason' in messageStop && messageStop.stopReason) {
        const stopReason = messageStop.stopReason as string
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
                      : null

        if (mappedStopReason) {
          event.stopReason = mappedStopReason
        }
      }

      if ('additionalModelResponseFields' in messageStop) {
        event.additionalModelResponseFields = messageStop.additionalModelResponseFields as JSONValue
      }

      events.push(event)
    }

    // Metadata event
    if ('metadata' in chunk && chunk.metadata && typeof chunk.metadata === 'object') {
      const metadata = chunk.metadata as Record<string, unknown>
      const event: ModelProviderStreamEvent = {
        type: 'modelMetadataEvent',
      }

      if ('usage' in metadata && metadata.usage && typeof metadata.usage === 'object') {
        const usage = metadata.usage as Record<string, unknown>
        const usageInfo: {
          inputTokens: number
          outputTokens: number
          totalTokens: number
          cacheReadInputTokens?: number
          cacheWriteInputTokens?: number
        } = {
          inputTokens: (usage.inputTokens as number) || 0,
          outputTokens: (usage.outputTokens as number) || 0,
          totalTokens: (usage.totalTokens as number) || 0,
        }

        if (usage.cacheReadInputTokens) {
          usageInfo.cacheReadInputTokens = usage.cacheReadInputTokens as number
        }
        if (usage.cacheCreationInputTokens) {
          usageInfo.cacheWriteInputTokens = usage.cacheCreationInputTokens as number
        }

        event.usage = usageInfo
      }

      if ('metrics' in metadata && metadata.metrics && typeof metadata.metrics === 'object') {
        const metrics = metadata.metrics as Record<string, unknown>
        event.metrics = {
          latencyMs: (metrics.latencyMs as number) || 0,
        }
      }

      if ('trace' in metadata) {
        event.trace = metadata.trace
      }

      events.push(event)
    }

    return events
  }

  /**
   * Handles errors from Bedrock API calls.
   *
   * @param error - The error to handle
   * @throws \{ContextWindowOverflowError\} For context overflow errors
   * @throws \{ModelThrottledError\} For throttling errors
   * @throws The original error for other error types
   */
  private handleError(error: unknown): never {
    if (error instanceof Error) {
      const errorMessage = error.message

      // Check for context window overflow
      if (BEDROCK_CONTEXT_WINDOW_OVERFLOW_MESSAGES.some((msg) => errorMessage.includes(msg))) {
        throw new ContextWindowOverflowError(errorMessage)
      }

      // Check for throttling
      if ('name' in error && error.name === 'ThrottlingException') {
        throw new ModelThrottledError(errorMessage)
      }

      // Check AWS SDK error code for throttling
      if ('$metadata' in error && typeof error.$metadata === 'object') {
        const metadata = error.$metadata as Record<string, unknown>
        if ('httpStatusCode' in metadata && metadata.httpStatusCode === 429) {
          throw new ModelThrottledError(errorMessage)
        }
      }
    }

    // Re-throw other errors as-is
    throw error
  }
}
