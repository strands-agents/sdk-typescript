import { resolveCuratedModelPricing } from './curated-models.js'

export function computeCostUsd(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  modelId: string | undefined
): number | null {
  if (!modelId) return null
  if (inputTokens == null && outputTokens == null) return null
  const pricing = resolveCuratedModelPricing(modelId)
  if (!pricing) return null
  const inTokens = inputTokens ?? 0
  const outTokens = outputTokens ?? 0
  const cost = (inTokens / 1000) * pricing.inputPer1k + (outTokens / 1000) * pricing.outputPer1k
  return Number(cost.toFixed(8))
}
