import { TOP_LEVEL_CURATED_MODELS } from './models'

/** USD per 1K tokens derived from the curated model catalog. */
export const PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = (() => {
  const pricing: Record<string, { inputPer1k: number; outputPer1k: number }> = {}
  for (const model of TOP_LEVEL_CURATED_MODELS) {
    pricing[model.modelId] = {
      inputPer1k: model.pricePer1kTokensInput,
      outputPer1k: model.pricePer1kTokensOutput,
    }
    const canonical = normalizeModelId(model.modelId)
    if (!(canonical in pricing)) {
      pricing[canonical] = pricing[model.modelId]
    }
  }
  return pricing
})()

function normalizeModelId(modelId: string): string {
  const trimmed = modelId.trim()
  const match = trimmed.match(/^(us|eu|apac|global)\.(.+)$/i)
  return match ? match[2] : trimmed
}
