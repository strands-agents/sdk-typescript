/**
 * Default values for model providers.
 *
 * These defaults are subject to change between versions. Set values explicitly
 * on model configurations to pin behavior across upgrades.
 */

export const MODEL_DEFAULTS = {
  anthropic: {
    modelId: 'claude-sonnet-4-6',
    maxTokens: 64_000,
  },
  bedrock: {
    modelId: 'global.anthropic.claude-sonnet-4-6',
    region: 'us-west-2',
  },
  openai: {
    modelId: 'gpt-5.4',
  },
  gemini: {
    modelId: 'gemini-2.5-flash',
  },
} as const

/**
 * Builds a warning message for when the default model ID is used.
 *
 * @param defaultModelId - The default model ID being used
 * @returns Formatted warning message string
 */
export function defaultModelWarningMessage(defaultModelId: string): string {
  return `model_id=<${defaultModelId}> | using default modelId, which is subject to change | set modelId explicitly to pin the value`
}

/**
 * Builds a warning message for when the default max tokens value is used.
 *
 * @param defaultMaxTokens - The default max tokens value being used
 * @returns Formatted warning message string
 */
export function defaultMaxTokensWarningMessage(defaultMaxTokens: number): string {
  return `max_tokens=<${defaultMaxTokens}> | using default maxTokens, which is subject to change | set maxTokens explicitly to pin the value`
}

/**
 * Metadata for known model IDs.
 *
 * Values sourced from provider documentation and
 * https://github.com/BerriAI/litellm/blob/litellm_internal_staging/model_prices_and_context_window.json
 *
 * For Bedrock models with cross-region prefixes (e.g. `us.`, `eu.`, `global.`),
 * {@link getModelMetadata} strips the prefix before lookup so only the base model ID is needed here.
 */
export interface ModelMetadataEntry {
  /**
   * Maximum context window size in tokens (input + output combined).
   */
  contextWindowLimit: number
}

export const MODEL_METADATA: Record<string, ModelMetadataEntry> = {
  // Anthropic (direct API)
  'claude-sonnet-4-6': { contextWindowLimit: 1_000_000 },
  'claude-sonnet-4-20250514': { contextWindowLimit: 1_000_000 },
  'claude-sonnet-4-5': { contextWindowLimit: 200_000 },
  'claude-sonnet-4-5-20250929': { contextWindowLimit: 200_000 },
  'claude-opus-4-6': { contextWindowLimit: 1_000_000 },
  'claude-opus-4-6-20260205': { contextWindowLimit: 1_000_000 },
  'claude-opus-4-7': { contextWindowLimit: 1_000_000 },
  'claude-opus-4-7-20260416': { contextWindowLimit: 1_000_000 },
  'claude-opus-4-5': { contextWindowLimit: 200_000 },
  'claude-opus-4-5-20251101': { contextWindowLimit: 200_000 },
  'claude-opus-4-20250514': { contextWindowLimit: 200_000 },
  'claude-opus-4-1': { contextWindowLimit: 200_000 },
  'claude-opus-4-1-20250805': { contextWindowLimit: 200_000 },
  'claude-haiku-4-5': { contextWindowLimit: 200_000 },
  'claude-haiku-4-5-20251001': { contextWindowLimit: 200_000 },
  'claude-3-7-sonnet-20250219': { contextWindowLimit: 200_000 },
  'claude-3-5-sonnet-20241022': { contextWindowLimit: 200_000 },
  'claude-3-5-sonnet-20240620': { contextWindowLimit: 200_000 },
  'claude-3-5-haiku-20241022': { contextWindowLimit: 200_000 },
  'claude-3-opus-20240229': { contextWindowLimit: 200_000 },
  'claude-3-haiku-20240307': { contextWindowLimit: 200_000 },

  // Bedrock Anthropic (base model IDs — cross-region prefixes stripped by getModelMetadata)
  'anthropic.claude-sonnet-4-6': { contextWindowLimit: 1_000_000 },
  'anthropic.claude-sonnet-4-20250514-v1:0': { contextWindowLimit: 1_000_000 },
  'anthropic.claude-sonnet-4-5-20250929-v1:0': { contextWindowLimit: 200_000 },
  'anthropic.claude-opus-4-6-v1': { contextWindowLimit: 1_000_000 },
  'anthropic.claude-opus-4-7': { contextWindowLimit: 1_000_000 },
  'anthropic.claude-opus-4-5-20251101-v1:0': { contextWindowLimit: 200_000 },
  'anthropic.claude-opus-4-20250514-v1:0': { contextWindowLimit: 200_000 },
  'anthropic.claude-opus-4-1-20250805-v1:0': { contextWindowLimit: 200_000 },
  'anthropic.claude-haiku-4-5-20251001-v1:0': { contextWindowLimit: 200_000 },
  'anthropic.claude-haiku-4-5@20251001': { contextWindowLimit: 200_000 },
  'anthropic.claude-3-7-sonnet-20250219-v1:0': { contextWindowLimit: 200_000 },
  'anthropic.claude-3-7-sonnet-20240620-v1:0': { contextWindowLimit: 200_000 },
  'anthropic.claude-3-5-sonnet-20241022-v2:0': { contextWindowLimit: 200_000 },
  'anthropic.claude-3-5-sonnet-20240620-v1:0': { contextWindowLimit: 200_000 },
  'anthropic.claude-3-5-haiku-20241022-v1:0': { contextWindowLimit: 200_000 },
  'anthropic.claude-3-opus-20240229-v1:0': { contextWindowLimit: 200_000 },
  'anthropic.claude-3-haiku-20240307-v1:0': { contextWindowLimit: 200_000 },
  'anthropic.claude-3-sonnet-20240229-v1:0': { contextWindowLimit: 200_000 },
  'anthropic.claude-mythos-preview': { contextWindowLimit: 1_000_000 },

  // Bedrock Amazon Nova
  'amazon.nova-pro-v1:0': { contextWindowLimit: 300_000 },
  'amazon.nova-lite-v1:0': { contextWindowLimit: 300_000 },
  'amazon.nova-micro-v1:0': { contextWindowLimit: 128_000 },
  'amazon.nova-premier-v1:0': { contextWindowLimit: 1_000_000 },
  'amazon.nova-2-lite-v1:0': { contextWindowLimit: 1_000_000 },
  'amazon.nova-2-pro-preview-20251202-v1:0': { contextWindowLimit: 1_000_000 },

  // OpenAI
  'gpt-5.5': { contextWindowLimit: 1_050_000 },
  'gpt-5.5-pro': { contextWindowLimit: 1_050_000 },
  'gpt-5.4': { contextWindowLimit: 1_050_000 },
  'gpt-5.4-pro': { contextWindowLimit: 1_050_000 },
  'gpt-5.4-mini': { contextWindowLimit: 272_000 },
  'gpt-5.4-nano': { contextWindowLimit: 272_000 },
  'gpt-5.2': { contextWindowLimit: 272_000 },
  'gpt-5.2-pro': { contextWindowLimit: 272_000 },
  'gpt-5.1': { contextWindowLimit: 272_000 },
  'gpt-5': { contextWindowLimit: 272_000 },
  'gpt-5-mini': { contextWindowLimit: 272_000 },
  'gpt-5-nano': { contextWindowLimit: 272_000 },
  'gpt-5-pro': { contextWindowLimit: 128_000 },
  'gpt-4.1': { contextWindowLimit: 1_047_576 },
  'gpt-4.1-mini': { contextWindowLimit: 1_047_576 },
  'gpt-4.1-nano': { contextWindowLimit: 1_047_576 },
  'gpt-4o': { contextWindowLimit: 128_000 },
  'gpt-4o-mini': { contextWindowLimit: 128_000 },
  'gpt-4-turbo': { contextWindowLimit: 128_000 },
  o3: { contextWindowLimit: 200_000 },
  'o3-mini': { contextWindowLimit: 200_000 },
  'o3-pro': { contextWindowLimit: 200_000 },
  'o4-mini': { contextWindowLimit: 200_000 },
  o1: { contextWindowLimit: 200_000 },

  // Google Gemini
  'gemini-2.5-flash': { contextWindowLimit: 1_048_576 },
  'gemini-2.5-flash-lite': { contextWindowLimit: 1_048_576 },
  'gemini-2.5-pro': { contextWindowLimit: 1_048_576 },
  'gemini-2.0-flash': { contextWindowLimit: 1_048_576 },
  'gemini-2.0-flash-lite': { contextWindowLimit: 1_048_576 },
  'gemini-3-pro-preview': { contextWindowLimit: 1_048_576 },
  'gemini-3-flash-preview': { contextWindowLimit: 1_048_576 },
  'gemini-3.1-pro-preview': { contextWindowLimit: 1_048_576 },
  'gemini-3.1-flash-lite-preview': { contextWindowLimit: 1_048_576 },
}

/**
 * Known Bedrock cross-region routing prefixes.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html
 */
const BEDROCK_REGION_PREFIXES = new Set(['us', 'eu', 'ap', 'global', 'apac', 'au', 'jp', 'us-gov'])

/**
 * Looks up metadata for a model ID.
 *
 * For Bedrock cross-region model IDs (e.g. `us.anthropic.claude-sonnet-4-6`),
 * the region prefix is stripped before lookup.
 *
 * @param modelId - The model ID to look up
 * @returns The metadata entry, or undefined if not found
 */
export function getModelMetadata(modelId: string): ModelMetadataEntry | undefined {
  const direct = MODEL_METADATA[modelId]
  if (direct !== undefined) return direct

  // Strip known Bedrock cross-region prefixes
  const dotIndex = modelId.indexOf('.')
  if (dotIndex !== -1) {
    const prefix = modelId.substring(0, dotIndex)
    if (BEDROCK_REGION_PREFIXES.has(prefix)) {
      return MODEL_METADATA[modelId.substring(dotIndex + 1)]
    }
  }

  return undefined
}

/**
 * Looks up the context window limit for a model ID.
 *
 * @param modelId - The model ID to look up
 * @returns The context window limit in tokens, or undefined if not found
 */
export function getContextWindowLimit(modelId: string): number | undefined {
  return getModelMetadata(modelId)?.contextWindowLimit
}
