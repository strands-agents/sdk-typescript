import type { CuratedModelProfile } from '../types'

export interface CuratedTopLevelModelOption {
  modelId: string
  provider: string
  displayName: string
  intentLabel: string
  speed: 'fast' | 'balanced' | 'slow'
  quality: 'good' | 'high' | 'frontier'
  cost: 'low' | 'medium' | 'high'
  specialties: string[]
  notes: string
  pricePer1kTokensInput: number
  pricePer1kTokensOutput: number
}

export const TOP_LEVEL_MODEL_PROFILE_OPTIONS: Array<{
  value: CuratedModelProfile
  label: string
  description: string
}> = [
  {
    value: 'quality',
    label: 'Quality',
    description: 'Claude Opus 4.5 for highest-quality orchestration and reasoning.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Claude Sonnet 4.5 for strong performance and cost balance for orchestration.',
  },
  {
    value: 'speed',
    label: 'Speed',
    description: 'Amazon Nova Micro for very fast, low-cost orchestration loops.',
  },
  {
    value: 'cost',
    label: 'Cost',
    description: 'Amazon Nova Micro for lowest-cost orchestration runs.',
  },
  {
    value: 'reasoning',
    label: 'Reasoning',
    description: 'Claude Opus 4.5 for deep reasoning and complex instruction-following.',
  },
  {
    value: 'coding',
    label: 'Coding',
    description: 'Claude Sonnet 4.5 for strong coding and agent interaction.',
  },
]

export const DEFAULT_TOP_LEVEL_MODEL_PROFILE: CuratedModelProfile = 'balanced'

export const TOP_LEVEL_MODEL_PROFILE_DEFAULTS: Record<CuratedModelProfile, string> = {
  speed: 'us.amazon.nova-micro-v1:0',
  quality: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  cost: 'us.amazon.nova-micro-v1:0',
  reasoning: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  coding: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  balanced: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
}

export const TOP_LEVEL_CURATED_MODELS: CuratedTopLevelModelOption[] = [
  {
    modelId: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
    provider: 'Anthropic',
    displayName: 'Anthropic Claude Opus 4.5',
    intentLabel: 'Top Tier/Quality',
    speed: 'balanced',
    quality: 'frontier',
    cost: 'high',
    specialties: ['reasoning', 'coding', 'multi-step workflows'],
    notes:
      'Opus 4.5 is a high-capability reasoning and coding model for complex orchestration workflows.',
    pricePer1kTokensInput: 0.005,
    pricePer1kTokensOutput: 0.025,
  },
  {
    modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    provider: 'Anthropic',
    displayName: 'Anthropic Claude Sonnet 4.5',
    intentLabel: 'Balanced/Quality',
    speed: 'balanced',
    quality: 'high',
    cost: 'medium',
    specialties: ['general tasks', 'reasoning', 'agent interaction'],
    notes: 'Sonnet 4.5 provides a strong quality/cost middle ground for top-level orchestration.',
    pricePer1kTokensInput: 0.003,
    pricePer1kTokensOutput: 0.015,
  },
  {
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    provider: 'Anthropic',
    displayName: 'Anthropic Claude Haiku 4.5',
    intentLabel: 'Fast/Low Cost',
    speed: 'fast',
    quality: 'good',
    cost: 'low',
    specialties: ['fast inference', 'scaled sub-agents', 'chat'],
    notes: 'Haiku 4.5 is optimized for latency and throughput for lightweight agent loops.',
    pricePer1kTokensInput: 0.001,
    pricePer1kTokensOutput: 0.005,
  },
  {
    modelId: 'cohere.command-r-plus-v1:0',
    provider: 'Cohere',
    displayName: 'Cohere Command R+',
    intentLabel: 'Fast/Instruction',
    speed: 'fast',
    quality: 'high',
    cost: 'medium',
    specialties: ['instruction-following', 'tooling', 'text-generation'],
    notes: 'High-quality instruction following with good latency for interactive agents.',
    pricePer1kTokensInput: 0.003,
    pricePer1kTokensOutput: 0.015,
  },
  {
    modelId: 'ai21.jamba-1-5-large-v1:0',
    provider: 'AI21 Labs',
    displayName: 'AI21 Jamba 1.5 Large',
    intentLabel: 'Balanced/Long Form',
    speed: 'balanced',
    quality: 'high',
    cost: 'medium',
    specialties: ['creative generation', 'long-form'],
    notes: 'Solid for long-form generation and document-focused tasks.',
    pricePer1kTokensInput: 0.002,
    pricePer1kTokensOutput: 0.008,
  },
  {
    modelId: 'us.amazon.nova-micro-v1:0',
    provider: 'Amazon (Nova)',
    displayName: 'Amazon Nova Micro',
    intentLabel: 'Very Fast/Low Cost',
    speed: 'fast',
    quality: 'good',
    cost: 'low',
    specialties: ['low-latency chat', 'edge-friendly'],
    notes: 'Speed/price optimized; good for lightweight worker agents.',
    pricePer1kTokensInput: 0.00004,
    pricePer1kTokensOutput: 0.00014,
  },
  {
    modelId: 'us.amazon.nova-lite-v1:0',
    provider: 'Amazon (Nova)',
    displayName: 'Amazon Nova Lite',
    intentLabel: 'Fast/Multimodal/Sub-Agents',
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
    displayName: 'Amazon Nova Pro',
    intentLabel: 'Balanced/Multimodal',
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
    displayName: 'Meta Llama 3.3 70B Instruct',
    intentLabel: 'Open/High Quality',
    speed: 'slow',
    quality: 'high',
    cost: 'high',
    specialties: ['open-instruction tuning', 'adaptable reasoning'],
    notes: 'Strong open-weight option for heavier instruction tasks.',
    pricePer1kTokensInput: 0.00058,
    pricePer1kTokensOutput: 0.00071,
  },
  {
    modelId: 'openai.gpt-oss-120b-1:0',
    provider: 'OpenAI (OSS)',
    displayName: 'OpenAI GPT OSS 120B',
    intentLabel: 'Research/Scale',
    speed: 'slow',
    quality: 'high',
    cost: 'high',
    specialties: ['research', 'inference at-scale'],
    notes: 'Large OSS GPT variant for research and scaled inference workloads.',
    pricePer1kTokensInput: 0.00015,
    pricePer1kTokensOutput: 0.0006,
  },
  {
    modelId: 'mistral.mistral-large-3-675b-instruct',
    provider: 'Mistral',
    displayName: 'Mistral Large 3',
    intentLabel: 'Balanced/Code',
    speed: 'balanced',
    quality: 'high',
    cost: 'medium',
    specialties: ['instruct', 'code', 'reasoning'],
    notes: 'High-quality instruct model with strong code and reasoning efficiency.',
    pricePer1kTokensInput: 0.0005,
    pricePer1kTokensOutput: 0.0015,
  },
  {
    modelId: 'amazon.titan-tg1-large',
    provider: 'Amazon (Titan)',
    displayName: 'Amazon Titan Text Large',
    intentLabel: 'Cheapest/Baseline',
    speed: 'fast',
    quality: 'good',
    cost: 'low',
    specialties: ['cheap chat', 'baseline tasks', 'fast inference'],
    notes: 'Baseline Titan text model for simple agent workflows and compatibility paths.',
    pricePer1kTokensInput: 0.0008,
    pricePer1kTokensOutput: 0.0016,
  },
]

export const TOP_LEVEL_CURATED_MODEL_BY_ID = new Map(
  TOP_LEVEL_CURATED_MODELS.map((model) => [model.modelId, model] as const)
)

const DYNAMIC_AGENT_COST_THRESHOLD_PER_1K = 0.01

export const DYNAMIC_AGENT_MODELS: CuratedTopLevelModelOption[] = TOP_LEVEL_CURATED_MODELS.filter(
  (model) =>
    model.pricePer1kTokensInput <= DYNAMIC_AGENT_COST_THRESHOLD_PER_1K &&
    model.pricePer1kTokensOutput <= DYNAMIC_AGENT_COST_THRESHOLD_PER_1K
)

export const DYNAMIC_AGENT_MODEL_IDS = new Set(DYNAMIC_AGENT_MODELS.map((model) => model.modelId))
