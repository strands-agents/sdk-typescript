/**
 * Contains helpers for creating various model providers that work both in node & the browser
 */

import { inject } from 'vitest'
import { BedrockModel, type BedrockModelOptions } from '$/sdk/models/bedrock.js'
import { OpenAIModel, type OpenAIModelOptions } from '$/sdk/models/openai.js'
import { AnthropicModel, type AnthropicModelOptions } from '$/sdk/models/anthropic.js'
import { GeminiModel, type GeminiModelOptions } from '$/sdk/models/gemini/model.js'

/**
 * Configuration for reasoning/thinking feature support.
 */
export interface ReasoningFeature {
  /** Model ID to use for reasoning tests */
  modelId: string
}

/**
 * Feature support flags for model providers.
 * Used to conditionally run tests based on model capabilities.
 */
export interface ProviderFeatures {
  /** Reasoning/thinking content support. False if not supported. */
  reasoning: ReasoningFeature | false
  /** Whether the model supports tool use */
  tools: boolean
  /** Whether the model supports image input */
  images: boolean
  /** Whether the model supports document input */
  documents: boolean
  /** Whether the model supports video input */
  video: boolean
}

export const bedrock = {
  name: 'BedrockModel',
  supports: {
    reasoning: {
      modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
    },
    tools: true,
    images: true,
    documents: true,
    video: true,
  } satisfies ProviderFeatures,
  get skip() {
    return inject('provider-bedrock').shouldSkip
  },
  createModel: (options: BedrockModelOptions = {}): BedrockModel => {
    const credentials = inject('provider-bedrock')?.credentials
    if (!credentials) {
      throw new Error('No Bedrock credentials provided')
    }

    return new BedrockModel({
      ...options,
      clientConfig: {
        ...(options.clientConfig ?? {}),
        credentials: credentials,
      },
    })
  },
  /** Creates a model configured for reasoning/thinking tests */
  createReasoningModel: (options: BedrockModelOptions = {}): BedrockModel => {
    const credentials = inject('provider-bedrock').credentials
    if (!credentials) {
      throw new Error('No Bedrock credentials provided')
    }

    return new BedrockModel({
      ...options,
      modelId: options.modelId ?? bedrock.supports.reasoning.modelId,
      // Enable extended thinking via additionalRequestFields
      additionalRequestFields: {
        ...(options.additionalRequestFields as Record<string, unknown> | undefined),
        thinking: { type: 'enabled', budget_tokens: 1024 },
      },
      clientConfig: {
        ...(options.clientConfig ?? {}),
        credentials: credentials,
      },
    })
  },
}

export const openai = {
  name: 'OpenAIModel',
  supports: {
    reasoning: {
      modelId: 'o1-mini',
    },
    tools: true,
    images: true,
    documents: true,
    video: false,
  } satisfies ProviderFeatures,
  get skip() {
    return inject('provider-openai').shouldSkip
  },
  createModel: (config: OpenAIModelOptions = {}): OpenAIModel => {
    const apiKey = inject('provider-openai')?.apiKey
    if (!apiKey) {
      throw new Error('No OpenAI apiKey provided')
    }

    return new OpenAIModel({
      ...config,
      apiKey: apiKey,
      clientConfig: {
        ...(config.clientConfig ?? {}),
        dangerouslyAllowBrowser: true,
      },
    })
  },
  /** Creates a model configured for reasoning/thinking tests */
  createReasoningModel: (config: OpenAIModelOptions = {}): OpenAIModel => {
    const apiKey = inject('provider-openai').apiKey
    if (!apiKey) {
      throw new Error('No OpenAI apiKey provided')
    }

    return new OpenAIModel({
      ...config,
      modelId: config.modelId ?? openai.supports.reasoning.modelId,
      apiKey: apiKey,
      clientConfig: {
        ...(config.clientConfig ?? {}),
        dangerouslyAllowBrowser: true,
      },
    })
  },
}

export const anthropic = {
  name: 'AnthropicModel',
  get skip() {
    return inject('provider-anthropic').shouldSkip
  },
  createModel: (config: AnthropicModelOptions = {}): AnthropicModel => {
    const apiKey = inject('provider-anthropic')?.apiKey
    if (!apiKey) {
      throw new Error('No Anthropic apiKey provided')
    }

    return new AnthropicModel({
      ...config,
      apiKey: apiKey,
      clientConfig: {
        ...(config.clientConfig ?? {}),
        dangerouslyAllowBrowser: true,
      },
    })
  },
}

export const gemini = {
  name: 'GeminiModel',
  supports: {
    // Gemini thinking models (gemini-2.5-flash-preview, gemini-3-flash-preview) require
    // preview access. Set to false until stable thinking models are available.
    // Note: When enabled, thinking models also require thought signature handling for
    // tool calls - see Python SDK PR #1382.
    reasoning: false,
    tools: false, // Not yet implemented
    images: true,
    documents: true,
    video: true,
  } satisfies ProviderFeatures,
  get skip() {
    return inject('provider-gemini').shouldSkip
  },
  createModel: (config: GeminiModelOptions = {}): GeminiModel => {
    const apiKey = inject('provider-gemini').apiKey
    if (!apiKey) {
      throw new Error('No Gemini apiKey provided')
    }

    return new GeminiModel({
      ...config,
      apiKey: apiKey,
    })
  },
  /** Creates a model configured for reasoning/thinking tests */
  createReasoningModel: (config: GeminiModelOptions = {}): GeminiModel => {
    const reasoning = gemini.supports.reasoning as ReasoningFeature | false
    if (!reasoning) {
      throw new Error('Gemini reasoning is not currently supported')
    }

    const apiKey = inject('provider-gemini').apiKey
    if (!apiKey) {
      throw new Error('No Gemini apiKey provided')
    }

    return new GeminiModel({
      ...config,
      modelId: config.modelId ?? reasoning.modelId,
      apiKey: apiKey,
    })
  },
}

export const allProviders = [bedrock, openai, anthropic, gemini]
