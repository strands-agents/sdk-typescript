/**
 * Google Gemini model provider implementation.
 *
 * This module provides integration with Google's Gemini API,
 * supporting streaming responses, tool use, and configurable model parameters.
 *
 * @see https://ai.google.dev/api
 */

import { GoogleGenAI } from '@google/genai'
import { Model } from '../models/model.js'
import type { BaseModelConfig, StreamOptions } from '../models/model.js'
import type { Message, ContentBlock } from '../types/messages.js'
import type { ImageBlock, DocumentBlock } from '../types/media.js'
import { encodeBase64 } from '../types/media.js'
import type { ModelStreamEvent } from '../models/streaming.js'
import { ContextWindowOverflowError } from '../errors.js'
import { logger } from '../logging/logger.js'

/**
 * Browser-compatible MIME type lookup.
 * Maps file extensions to MIME types without using Node.js path module.
 */
const mimeTypeLookup = (format: string): string => {
  const mimeTypes: Record<string, string> = {
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    // Documents
    pdf: 'application/pdf',
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    txt: 'text/plain',
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    md: 'text/markdown',
  }
  return mimeTypes[format.toLowerCase()] || 'application/octet-stream'
}

const DEFAULT_GEMINI_MODEL_ID = 'gemini-2.5-flash'

/**
 * Error message patterns that indicate context window overflow.
 * Used to detect when input exceeds the model's context window.
 */
const GEMINI_CONTEXT_WINDOW_OVERFLOW_PATTERNS = ['exceeds the maximum number of tokens']

/**
 * Configuration interface for Gemini model provider.
 *
 * Extends BaseModelConfig with Gemini-specific configuration options
 * for model parameters and request settings.
 *
 * @example
 * ```typescript
 * const config: GeminiModelConfig = {
 *   modelId: 'gemini-2.5-flash',
 *   params: { temperature: 0.7, maxTokens: 1024 }
 * }
 * ```
 */
export interface GeminiModelConfig extends BaseModelConfig {
  /**
   * Gemini model identifier (e.g., gemini-2.5-flash, gemini-1.5-pro).
   */
  modelId?: string

  /**
   * Additional model parameters (e.g., temperature, maxTokens).
   * For a complete list of supported parameters, see
   * https://ai.google.dev/api/generate-content#generationconfig.
   */
  params?: Record<string, unknown>
}

/**
 * Options interface for creating a GeminiModel instance.
 */
export interface GeminiModelOptions extends GeminiModelConfig {
  /**
   * Arguments for the underlying Gemini client (e.g., apiKey).
   * For a complete list of supported arguments, see
   * https://googleapis.github.io/nodejs-genai/.
   */
  clientArgs?: Record<string, unknown>
}

/**
 * Gemini model provider implementation.
 *
 * Implements the Model interface for Google Gemini using the Generate Content API.
 * Supports streaming responses, tool use, and comprehensive configuration.
 *
 * @example
 * ```typescript
 * const provider = new GeminiModel({
 *   modelId: 'gemini-2.5-flash',
 *   clientArgs: { apiKey: 'your-api-key' },
 *   params: { temperature: 0.7, maxTokens: 1024 }
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
export class GeminiModel extends Model<GeminiModelConfig> {
  private _config: GeminiModelConfig
  private _client: GoogleGenAI

  /**
   * Creates a new GeminiModel instance.
   *
   * @param options - Configuration for model and client
   *
   * @example
   * ```typescript
   * // Minimal configuration with API key and model ID
   * const provider = new GeminiModel({
   *   modelId: 'gemini-2.5-flash',
   *   clientArgs: { apiKey: 'your-api-key' }
   * })
   *
   * // With additional model configuration
   * const provider = new GeminiModel({
   *   modelId: 'gemini-2.5-flash',
   *   clientArgs: { apiKey: 'your-api-key' },
   *   params: { temperature: 0.8, maxTokens: 2048 }
   * })
   * ```
   */
  constructor(options?: GeminiModelOptions) {
    super()
    const { clientArgs, ...modelConfig } = options || {}

    // Initialize model config with default model ID if not provided
    this._config = {
      modelId: DEFAULT_GEMINI_MODEL_ID,
      ...modelConfig,
    }

    // Initialize Google Gen AI client
    // The constructor takes an options object with apiKey
    const apiKey =
      clientArgs && typeof clientArgs === 'object' && 'apiKey' in clientArgs ? (clientArgs.apiKey as string) : undefined

    if (apiKey) {
      this._client = new GoogleGenAI({ apiKey })
    } else {
      // Fallback: try to construct with empty apiKey (may fail, but allows for testing)
      this._client = new GoogleGenAI({ apiKey: '' })
    }
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
   *   params: { temperature: 0.9, maxTokens: 2048 }
   * })
   * ```
   */
  updateConfig(modelConfig: GeminiModelConfig): void {
    // Merge params object if both exist
    if (this._config.params && modelConfig.params) {
      this._config = {
        ...this._config,
        ...modelConfig,
        params: { ...this._config.params, ...modelConfig.params },
      }
    } else {
      this._config = { ...this._config, ...modelConfig }
    }
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
  getConfig(): GeminiModelConfig {
    return this._config
  }

  /**
   * Streams a conversation with the Gemini model.
   * Returns an async iterable that yields streaming events as they occur.
   *
   * @param messages - Array of conversation messages
   * @param options - Optional streaming configuration
   * @returns Async iterable of streaming events
   *
   * @throws \{ContextWindowOverflowError\} When input exceeds the model's context window
   *
   * @example
   * ```typescript
   * const provider = new GeminiModel({
   *   modelId: 'gemini-2.5-flash',
   *   clientArgs: { apiKey: 'your-api-key' }
   * })
   * const messages: Message[] = [
   *   { role: 'user', content: [{ type: 'textBlock', text: 'What is 2+2?' }] }
   * ]
   *
   * for await (const event of provider.stream(messages)) {
   *   if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
   *     process.stdout.write(event.delta.text)
   *   }
   * }
   * ```
   *
   * @example
   * ```typescript
   * // With tool use
   * const options: StreamOptions = {
   *   systemPrompt: 'You are a helpful assistant',
   *   toolSpecs: [calculatorTool]
   * }
   *
   * for await (const event of provider.stream(messages, options)) {
   *   if (event.type === 'modelMessageStopEvent' && event.stopReason === 'toolUse') {
   *     console.log('Model wants to use a tool')
   *   }
   * }
   * ```
   */
  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    // Validate messages array is not empty
    if (!messages || messages.length === 0) {
      throw new Error('At least one message is required')
    }

    try {
      // Format the request
      const request = this._formatRequest(messages, options)

      // Create streaming request using the models API
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await this._client.models.generateContentStream(request as any)

      // Track streaming state
      const streamState = {
        messageStarted: false,
        textContentBlockStarted: false,
        toolContentBlockStarted: false,
        toolUsed: false,
      }

      // Emit message start event
      yield {
        type: 'modelMessageStartEvent',
        role: 'assistant',
      }
      streamState.messageStarted = true

      // Process streaming response
      let lastEvent: {
        candidates?: Array<{
          finishReason?: string
          content?: { parts?: unknown[] }
        }>
        usageMetadata?: {
          promptTokenCount?: number
          totalTokenCount?: number
        }
      } | null = null
      for await (const event of stream) {
        lastEvent = event as {
          candidates?: Array<{
            finishReason?: string
            content?: { parts?: unknown[] }
          }>
          usageMetadata?: {
            promptTokenCount?: number
            totalTokenCount?: number
          }
        }
        const candidates = event.candidates || []
        const candidate = candidates[0]
        if (!candidate) continue

        const content = candidate.content
        if (!content || !content.parts) continue

        const parts = content.parts

        for (const part of parts) {
          // Handle function calls (tool use)
          if (part.functionCall) {
            const functionCall = part.functionCall

            // Emit tool use start event
            if (!streamState.toolContentBlockStarted) {
              // Stop text content block if it was started
              if (streamState.textContentBlockStarted) {
                yield {
                  type: 'modelContentBlockStopEvent',
                }
                streamState.textContentBlockStarted = false
              }

              // Use function call id if available, otherwise use name
              // Note: Gemini may not always populate id, so we fall back to name
              const toolUseId = functionCall.id || functionCall.name || ''

              yield {
                type: 'modelContentBlockStartEvent',
                start: {
                  type: 'toolUseStart',
                  name: functionCall.name || '',
                  toolUseId,
                },
              }
              streamState.toolContentBlockStarted = true
              streamState.toolUsed = true
            }

            // Emit tool use input delta
            if (functionCall.args) {
              yield {
                type: 'modelContentBlockDeltaEvent',
                delta: {
                  type: 'toolUseInputDelta',
                  input: JSON.stringify(functionCall.args),
                },
              }
            }
          }

          // Handle text content
          if (part.text) {
            // Start text content block if not already started
            if (!streamState.textContentBlockStarted && !streamState.toolContentBlockStarted) {
              yield {
                type: 'modelContentBlockStartEvent',
              }
              streamState.textContentBlockStarted = true
            }
            // Handle reasoning content (thought)
            if (part.thought) {
              const delta: {
                type: 'reasoningContentDelta'
                text?: string
                signature?: string
              } = {
                type: 'reasoningContentDelta' as const,
                text: part.text,
              }

              if (part.thoughtSignature) {
                // Convert Uint8Array to string if needed
                // Check if it's a Uint8Array by checking for byteLength property
                const sig = part.thoughtSignature as unknown
                if (
                  sig &&
                  typeof sig === 'object' &&
                  sig !== null &&
                  'byteLength' in sig &&
                  typeof (sig as { byteLength?: unknown }).byteLength === 'number'
                ) {
                  delta.signature = new TextDecoder().decode(sig as Uint8Array)
                } else {
                  delta.signature = String(part.thoughtSignature)
                }
              }

              yield {
                type: 'modelContentBlockDeltaEvent',
                delta,
              }
            } else {
              // Regular text content
              yield {
                type: 'modelContentBlockDeltaEvent',
                delta: {
                  type: 'textDelta',
                  text: part.text,
                },
              }
            }
          }
        }
      }

      // Emit content block stop events
      if (streamState.toolContentBlockStarted) {
        yield {
          type: 'modelContentBlockStopEvent',
        }
        streamState.toolContentBlockStarted = false
      }

      if (streamState.textContentBlockStarted) {
        yield {
          type: 'modelContentBlockStopEvent',
        }
        streamState.textContentBlockStarted = false
      }

      // Determine stop reason
      let stopReason = 'endTurn'
      if (streamState.toolUsed) {
        stopReason = 'toolUse'
      } else if (lastEvent?.candidates?.[0]?.finishReason) {
        const finishReason = lastEvent.candidates[0].finishReason
        if (finishReason === 'MAX_TOKENS') {
          stopReason = 'maxTokens'
        } else if (finishReason === 'STOP') {
          stopReason = 'endTurn'
        }
      }

      // Emit message stop event
      yield {
        type: 'modelMessageStopEvent',
        stopReason,
      }

      // Emit metadata event if available
      if (lastEvent?.usageMetadata) {
        const usage = lastEvent.usageMetadata
        yield {
          type: 'modelMetadataEvent',
          usage: {
            inputTokens: usage.promptTokenCount || 0,
            outputTokens: (usage.totalTokenCount || 0) - (usage.promptTokenCount || 0),
            totalTokens: usage.totalTokenCount || 0,
          },
          metrics: {
            latencyMs: 0, // TODO: Gemini API doesn't provide latency in usage metadata
          },
        }
      }
    } catch (error) {
      const err = error as Error

      // Check for context window overflow
      if (err.message && GEMINI_CONTEXT_WINDOW_OVERFLOW_PATTERNS.some((pattern) => err.message.includes(pattern))) {
        throw new ContextWindowOverflowError(err.message)
      }

      // Check for throttling errors (Google Gen AI SDK uses ApiError)
      if ('status' in err && (err.status === 'RESOURCE_EXHAUSTED' || err.status === 'UNAVAILABLE')) {
        // Re-throw as-is (no ModelThrottledError class exists in TypeScript SDK)
        throw err
      }

      // Re-throw other errors unchanged
      throw err
    }
  }

  /**
   * Formats a request for the Gemini Generate Content API.
   *
   * @param messages - Conversation messages
   * @param options - Stream options
   * @returns Formatted Gemini request
   */
  private _formatRequest(messages: Message[], options?: StreamOptions): Record<string, unknown> {
    const request: Record<string, unknown> = {
      model: this._config.modelId || DEFAULT_GEMINI_MODEL_ID,
      contents: this._formatMessages(messages),
    }

    // Build config object
    const config: Record<string, unknown> = {}

    // Add system instruction if provided
    if (options?.systemPrompt !== undefined) {
      if (typeof options.systemPrompt === 'string') {
        config.systemInstruction = options.systemPrompt
      } else if (Array.isArray(options.systemPrompt) && options.systemPrompt.length > 0) {
        // Extract text blocks from system prompt array
        const textBlocks: string[] = []
        for (const block of options.systemPrompt) {
          if (block.type === 'textBlock') {
            textBlocks.push(block.text)
          } else {
            logger.warn(`block_type=<${block.type}> | unsupported system prompt block type, ignoring`)
          }
        }
        if (textBlocks.length > 0) {
          config.systemInstruction = textBlocks.join('')
        }
      }
    }

    // Add tools if provided
    if (options?.toolSpecs && options.toolSpecs.length > 0) {
      config.tools = this._formatTools(options.toolSpecs)
    }

    // Add generation config (model parameters)
    if (this._config.params) {
      Object.assign(config, this._config.params)
    }

    if (Object.keys(config).length > 0) {
      request.config = config
    }

    return request
  }

  /**
   * Formats messages for Gemini API.
   * Handles role mapping (user -\> user, assistant -\> model).
   *
   * @param messages - SDK messages
   * @returns Gemini-formatted messages
   */
  private _formatMessages(messages: Message[]): Array<{ role: string; parts: unknown[] }> {
    return messages.map((message) => {
      const parts = message.content.map((block) => this._formatContentBlock(block)).filter((part) => part !== null)

      return {
        role: message.role === 'user' ? 'user' : 'model',
        parts,
      }
    })
  }

  /**
   * Formats a content block for Gemini API.
   *
   * @param block - SDK content block
   * @returns Gemini-formatted part or null if unsupported
   */
  private _formatContentBlock(block: ContentBlock): Record<string, unknown> | null {
    switch (block.type) {
      case 'textBlock':
        return {
          text: block.text,
        }

      case 'imageBlock': {
        const imageBlock = block as ImageBlock
        if (imageBlock.source.type === 'imageSourceBytes') {
          const mimeType = mimeTypeLookup(imageBlock.format)
          const base64 = encodeBase64(String.fromCharCode(...imageBlock.source.bytes))
          return {
            inlineData: {
              data: base64,
              mimeType,
            },
          }
        } else {
          logger.warn(
            `image_source_type=<${imageBlock.source.type}> | unsupported image source type, only bytes are supported`
          )
          return null
        }
      }

      case 'documentBlock': {
        const docBlock = block as DocumentBlock
        if (docBlock.source.type === 'documentSourceBytes') {
          const mimeType = mimeTypeLookup(docBlock.format)
          const base64 = encodeBase64(String.fromCharCode(...docBlock.source.bytes))
          return {
            inlineData: {
              data: base64,
              mimeType,
            },
          }
        } else {
          logger.warn(
            `document_source_type=<${docBlock.source.type}> | unsupported document source type, only bytes are supported`
          )
          return null
        }
      }

      case 'toolUseBlock':
        return {
          functionCall: {
            name: block.name,
            args: block.input,
          },
        }

      case 'toolResultBlock': {
        // Format tool result content
        const output: Array<{ json?: unknown; text?: string }> = []
        for (const content of block.content) {
          if (content.type === 'jsonBlock') {
            output.push({ json: content.json })
          } else if (content.type === 'textBlock') {
            // TextBlock formats to { text: string }
            output.push({ text: content.text })
          }
        }

        return {
          functionResponse: {
            name: block.toolUseId, // Note: Gemini requires name to be set, we use toolUseId
            response: {
              output,
            },
          },
        }
      }

      case 'reasoningBlock': {
        const part: {
          text: string
          thought: boolean
          thoughtSignature?: Uint8Array
        } = {
          text: block.text || '',
          thought: true,
        }
        if (block.signature) {
          // Convert string signature to Uint8Array
          part.thoughtSignature = new TextEncoder().encode(block.signature)
        }
        return part
      }

      default:
        logger.warn(`block_type=<${block.type}> | unsupported content block type, skipping`)
        return null
    }
  }

  /**
   * Formats tool specifications for Gemini API.
   *
   * @param toolSpecs - Array of tool specifications
   * @returns Gemini-formatted tools array
   */
  private _formatTools(toolSpecs: Array<{ name: string; description: string; inputSchema?: unknown }>): Array<{
    functionDeclarations: Array<{
      name: string
      description: string
      parametersJsonSchema: Record<string, unknown>
    }>
  }> {
    return [
      {
        functionDeclarations: toolSpecs.map((spec) => {
          // Gemini requires parametersJsonSchema to be a JSON schema describing an object
          // The schema must have type: 'object' at the root level
          const inputSchema = (spec.inputSchema as Record<string, unknown>) || {}

          // Ensure the schema describes an object type
          let parametersSchema: Record<string, unknown>
          if (inputSchema.type === 'object') {
            // Schema already has type: 'object', use it as-is
            parametersSchema = inputSchema
          } else if (inputSchema.properties || inputSchema.type) {
            // Schema has properties or a type, but not type: 'object'
            // Wrap it to ensure type: 'object' at root
            parametersSchema = {
              type: 'object',
              properties: (inputSchema.properties as Record<string, unknown>) || {},
              required: inputSchema.required,
              additionalProperties: inputSchema.additionalProperties,
            }
          } else {
            // No schema provided, use empty object schema
            parametersSchema = {
              type: 'object',
              properties: {},
            }
          }

          return {
            name: spec.name,
            description: spec.description,
            parametersJsonSchema: parametersSchema,
          }
        }),
      },
    ]
  }
}
