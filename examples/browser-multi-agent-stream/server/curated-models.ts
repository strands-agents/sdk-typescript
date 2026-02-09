export type CuratedModelSpeed = 'fast' | 'balanced' | 'slow'
export type CuratedModelQuality = 'good' | 'high' | 'frontier'
export type CuratedModelCost = 'low' | 'medium' | 'high'

export type CuratedModelProfile =
  | 'speed'
  | 'quality'
  | 'cost'
  | 'reasoning'
  | 'coding'
  | 'balanced'

export interface CuratedBedrockModel {
  modelId: string
  provider: string
  speed: CuratedModelSpeed
  quality: CuratedModelQuality
  cost: CuratedModelCost
  specialties: string[]
  notes: string
  pricePer1kTokensInput: number
  pricePer1kTokensOutput: number
}

export interface CuratedModelPricing {
  inputPer1k: number
  outputPer1k: number
}

export interface CuratedModelResolution {
  modelId: string
  reason: 'requested_model' | 'requested_profile' | 'fallback_profile'
  profile: CuratedModelProfile
}

export const CURATED_BEDROCK_MODELS: CuratedBedrockModel[] = [
  {
    modelId: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
    provider: 'Anthropic',
    speed: 'balanced',
    quality: 'frontier',
    cost: 'high',
    specialties: ['reasoning', 'coding', 'multi-step workflows'],
    notes:
      'Opus 4.5 is a high-capability reasoning/coding model for complex orchestration workloads.',
    pricePer1kTokensInput: 0.005, // $5.00 per 1M => $0.005 per 1k
    pricePer1kTokensOutput: 0.025, // $25.00 per 1M => $0.025 per 1k
  },
  {
    modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    provider: 'Anthropic',
    speed: 'balanced',
    quality: 'high',
    cost: 'medium',
    specialties: ['general tasks', 'reasoning', 'agent interaction'],
    notes:
      'Sonnet 4.5 is a strong performance/cost middle ground for general productivity and multi-agent orchestration.',
    pricePer1kTokensInput: 0.003, // $3.00 per 1M => $0.003 per 1k
    pricePer1kTokensOutput: 0.015, // $15.00 per 1M => $0.015 per 1k
  },
  {
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    provider: 'Anthropic',
    speed: 'fast',
    quality: 'good',
    cost: 'low',
    specialties: ['fast inference', 'scaled sub-agents', 'chat'],
    notes: 'Haiku 4.5 is optimized for low-latency, lower-cost, high-throughput sub-agent workloads.',
    pricePer1kTokensInput: 0.001, // $1.00 per 1M => $0.001 per 1k
    pricePer1kTokensOutput: 0.005, // $5.00 per 1M => $0.005 per 1k
  },
  {
    modelId: 'cohere.command-r-plus-v1:0',
    provider: 'Cohere',
    speed: 'fast',
    quality: 'high',
    cost: 'medium',
    specialties: ['instruction-following', 'tooling', 'text-generation'],
    notes:
      'Command R+ targets high-quality instruction-following with good latency for interactive agents.',
    pricePer1kTokensInput: 0.003, // $3.00 per 1M => $0.003 per 1k (reported Bedrock rate)
    pricePer1kTokensOutput: 0.015, // $15.00 per 1M => $0.015 per 1k (reported Bedrock rate)
  },
  {
    modelId: 'ai21.jamba-1-5-large-v1:0',
    provider: 'AI21 Labs',
    speed: 'balanced',
    quality: 'high',
    cost: 'medium',
    specialties: ['creative generation', 'long-form'],
    notes: 'AI21 Jamba in Bedrock; solid for long-form and document-centric tasks.',
    pricePer1kTokensInput: 0.002, // $2.00 per 1M => $0.002 per 1k
    pricePer1kTokensOutput: 0.008, // $8.00 per 1M => $0.008 per 1k
  },
  {
    modelId: 'us.amazon.nova-micro-v1:0',
    provider: 'Amazon (Nova)',
    speed: 'fast',
    quality: 'good',
    cost: 'low',
    specialties: ['low-latency chat', 'edge-friendly'],
    notes: 'Nova micro is speed/price optimized for lightweight worker agents.',
    pricePer1kTokensInput: 0.00004, // $0.04 per 1M => $0.00004 per 1k
    pricePer1kTokensOutput: 0.00014, // $0.14 per 1M => $0.00014 per 1k
  },
  {
    modelId: 'us.amazon.nova-lite-v1:0',
    provider: 'Amazon (Nova)',
    speed: 'fast',
    quality: 'good',
    cost: 'low',
    specialties: ['low-latency chat', 'multimodal', 'sub-agents'],
    notes: 'Nova Lite is a fast multimodal model optimized for low-cost sub-agent workloads.',
    pricePer1kTokensInput: 0.00006,
    pricePer1kTokensOutput: 0.00024,
  },
  {
    modelId: 'us.amazon.nova-pro-v1:0',
    provider: 'Amazon (Nova)',
    speed: 'balanced',
    quality: 'high',
    cost: 'low',
    specialties: ['multimodal', 'reasoning', 'general tasks'],
    notes: 'Nova Pro is a capable multimodal model balancing quality and cost.',
    pricePer1kTokensInput: 0.0008,
    pricePer1kTokensOutput: 0.0032,
  },
  {
    modelId: 'us.meta.llama3-3-70b-instruct-v1:0',
    provider: 'Meta',
    speed: 'slow',
    quality: 'high',
    cost: 'high',
    specialties: ['open-instruction tuning', 'adaptable reasoning'],
    notes: 'Llama 3.3 70B is a strong open-instruction option for heavy instruction workloads.',
    pricePer1kTokensInput: 0.00058, // $0.58 per 1M => $0.00058 per 1k (reported)
    pricePer1kTokensOutput: 0.00071, // $0.71 per 1M => $0.00071 per 1k (reported)
  },
  {
    modelId: 'openai.gpt-oss-120b-1:0',
    provider: 'OpenAI (OSS)',
    speed: 'slow',
    quality: 'high',
    cost: 'high',
    specialties: ['research', 'inference at-scale'],
    notes:
      'Open-source GPT variants available in Bedrock for large-scale, on-prem-like use-cases.',
    pricePer1kTokensInput: 0.00015, // AWS lists GPT OSS 120B at $0.00015 per 1k input
    pricePer1kTokensOutput: 0.00060, // AWS lists GPT OSS 120B at $0.00060 per 1k output
  },
  {
    modelId: 'mistral.mistral-large-3-675b-instruct',
    provider: 'Mistral',
    speed: 'balanced',
    quality: 'high',
    cost: 'medium',
    specialties: ['instruct', 'code', 'reasoning'],
    notes: 'Mistral Large 3 is a high-quality instruct model with good efficiency.',
    pricePer1kTokensInput: 0.0005, // $0.00050 per 1k (AWS Bedrock listing for Mistral Large 3)
    pricePer1kTokensOutput: 0.00150, // $0.00150 per 1k (AWS Bedrock listing)
  },
  {
    modelId: 'amazon.titan-tg1-large',
    provider: 'Amazon (Titan)',
    speed: 'fast',
    quality: 'good',
    cost: 'low',
    specialties: ['cheap chat', 'baseline tasks', 'fast inference'],
    notes: 'Titan Text Large is a baseline text model for simple workloads and compatibility paths.',
    pricePer1kTokensInput: 0.0008, // $0.80 per 1M => $0.0008 per 1k
    pricePer1kTokensOutput: 0.0016, // $1.60 per 1M => $0.0016 per 1k
  },
]

export const TOP_LEVEL_PROFILE_DEFAULTS: Record<CuratedModelProfile, string> = {
  speed: 'us.amazon.nova-micro-v1:0',
  quality: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  cost: 'us.amazon.nova-micro-v1:0',
  reasoning: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  coding: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  balanced: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
}

export const DEFAULT_TOP_LEVEL_PROFILE: CuratedModelProfile = 'balanced'

export const DYNAMIC_AGENT_PROFILE_DEFAULTS: Record<CuratedModelProfile, string> = {
  speed: 'us.amazon.nova-micro-v1:0',
  quality: 'us.amazon.nova-pro-v1:0',
  cost: 'us.amazon.nova-micro-v1:0',
  reasoning: 'us.amazon.nova-pro-v1:0',
  coding: 'us.amazon.nova-pro-v1:0',
  balanced: 'us.amazon.nova-lite-v1:0',
}

export const DEFAULT_DYNAMIC_AGENT_PROFILE: CuratedModelProfile = 'balanced'

export const CURATED_MODEL_IDS = new Set(CURATED_BEDROCK_MODELS.map((model) => model.modelId))
const CURATED_MODEL_ID_BY_CANONICAL = (() => {
  const map = new Map<string, string>()
  for (const model of CURATED_BEDROCK_MODELS) {
    const canonicalId = normalizeCuratedModelId(model.modelId)
    if (!map.has(canonicalId)) map.set(canonicalId, model.modelId)
  }
  return map
})()

export const CURATED_MODEL_PROFILE_VALUES = Object.keys(
  TOP_LEVEL_PROFILE_DEFAULTS
) as CuratedModelProfile[]

const DYNAMIC_AGENT_COST_THRESHOLD_PER_1K = 0.01

export const DYNAMIC_AGENT_MODELS: CuratedBedrockModel[] = CURATED_BEDROCK_MODELS.filter(
  (model) =>
    model.pricePer1kTokensInput <= DYNAMIC_AGENT_COST_THRESHOLD_PER_1K &&
    model.pricePer1kTokensOutput <= DYNAMIC_AGENT_COST_THRESHOLD_PER_1K
)

export const DYNAMIC_AGENT_MODEL_IDS = new Set(DYNAMIC_AGENT_MODELS.map((model) => model.modelId))

export const CURATED_MODEL_SELECTION_GUIDANCE =
  'Curated model profiles: speed, quality, cost, reasoning, coding, balanced. ' +
  'Use agents[].model_profile to pick a profile or agents[].model_settings.model_id with an allowed model ID. ' +
  `Allowed model IDs for dynamic agents: ${DYNAMIC_AGENT_MODELS.map((model) => model.modelId).join(', ')}.`

export function normalizeCuratedModelId(modelId: string): string {
  const trimmed = modelId.trim()
  const match = trimmed.match(/^(us|eu|apac|global)\.(.+)$/i)
  return match ? match[2] : trimmed
}

const CURATED_MODEL_PRICING_BY_CANONICAL = (() => {
  const map = new Map<string, CuratedModelPricing>()
  for (const model of CURATED_BEDROCK_MODELS) {
    map.set(normalizeCuratedModelId(model.modelId), {
      inputPer1k: model.pricePer1kTokensInput,
      outputPer1k: model.pricePer1kTokensOutput,
    })
  }
  return map
})()

const CURATED_MODEL_DEFAULT_REGION_BY_CANONICAL = new Map<string, string>([
  // AI21 Jamba 1.5 Large is single-Region in Bedrock (us-east-1).
  ['ai21.jamba-1-5-large-v1:0', 'us-east-1'],
])

export function resolveCuratedModelPricing(modelId: string | undefined): CuratedModelPricing | undefined {
  if (modelId == null) return undefined
  const normalized = normalizeCuratedModelId(modelId)
  return CURATED_MODEL_PRICING_BY_CANONICAL.get(normalized)
}

export function resolveCuratedModelRegion(modelId: string, fallbackRegion: string): string {
  const normalized = normalizeCuratedModelId(modelId)
  return CURATED_MODEL_DEFAULT_REGION_BY_CANONICAL.get(normalized) ?? fallbackRegion
}

export function isCuratedBedrockModelId(modelId: string): boolean {
  const trimmed = modelId.trim()
  if (trimmed === '') return false
  if (CURATED_MODEL_IDS.has(trimmed)) return true
  const canonicalId = normalizeCuratedModelId(trimmed)
  return CURATED_MODEL_ID_BY_CANONICAL.has(canonicalId)
}

export function resolveCuratedBedrockModelId(options: {
  requestedModelId?: string
  requestedProfile?: string
  defaultProfile?: CuratedModelProfile
  profileDefaults?: Record<CuratedModelProfile, string>
}): CuratedModelResolution {
  const profileDefaults = options.profileDefaults ?? TOP_LEVEL_PROFILE_DEFAULTS
  const defaultProfile = options.defaultProfile ?? DEFAULT_TOP_LEVEL_PROFILE
  const requestedModelId = options.requestedModelId?.trim()

  if (requestedModelId != null && requestedModelId !== '') {
    const canonicalId = normalizeCuratedModelId(requestedModelId)
    const resolvedModelId =
      CURATED_MODEL_IDS.has(requestedModelId)
        ? requestedModelId
        : CURATED_MODEL_ID_BY_CANONICAL.get(canonicalId)
    if (resolvedModelId != null) {
      return {
        modelId: resolvedModelId,
        reason: 'requested_model',
        profile: defaultProfile,
      }
    }
  }

  const requestedProfile = normalizeModelProfile(options.requestedProfile)
  if (requestedProfile != null) {
    return {
      modelId: resolveDefaultModelIdForProfile(requestedProfile, profileDefaults),
      reason: 'requested_profile',
      profile: requestedProfile,
    }
  }

  return {
    modelId: resolveDefaultModelIdForProfile(defaultProfile, profileDefaults),
    reason: 'fallback_profile',
    profile: defaultProfile,
  }
}

function resolveDefaultModelIdForProfile(
  profile: CuratedModelProfile,
  defaults: Record<CuratedModelProfile, string>
): string {
  return defaults[profile]
}

function normalizeModelProfile(value: string | undefined): CuratedModelProfile | undefined {
  if (value == null) return undefined
  const normalized = value.trim().toLowerCase()
  if ((CURATED_MODEL_PROFILE_VALUES as string[]).includes(normalized)) {
    return normalized as CuratedModelProfile
  }
  return undefined
}
