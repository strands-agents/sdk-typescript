import { PRICING } from './constants'

function normalizeModelId(modelId: string): string {
  const trimmed = modelId.trim()
  const match = trimmed.match(/^(us|eu|apac|global)\.(.+)$/i)
  return match ? match[2] : trimmed
}

export function computeCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string | undefined
): string {
  if (!modelId) return '—'
  const p = PRICING[modelId] ?? PRICING[normalizeModelId(modelId)]
  if (!p) return '—'
  const cost = (inputTokens / 1000) * p.inputPer1k + (outputTokens / 1000) * p.outputPer1k
  return `$${cost.toFixed(4)}`
}

export function hasPricing(modelId: string | undefined): boolean {
  return !!modelId && (modelId in PRICING || normalizeModelId(modelId) in PRICING)
}
