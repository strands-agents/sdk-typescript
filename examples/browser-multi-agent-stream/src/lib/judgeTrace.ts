export interface JudgeDimensionScores {
  correctness: number
  completeness: number
  clarity: number
  constraintCompliance: number
}

export interface JudgeReview {
  verdict: 'PASS' | 'REVISE' | 'FAIL'
  overallScore: number
  dimensionScores: JudgeDimensionScores
  rationale: string
  criticalIssues: string[]
  recommendedEdits: string[]
}

export interface JudgeTraceData {
  objective: string
  candidateAnswer: string
  review: JudgeReview
  revisedAnswer: string
  actionsTaken: string[]
  confidence: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function parseNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseJudgeTraceData(value: unknown): JudgeTraceData | null {
  const root = asRecord(value)
  if (root == null) return null

  const objective = typeof root.objective === 'string' ? root.objective : null
  const candidateAnswer = typeof root.candidateAnswer === 'string' ? root.candidateAnswer : null
  const revisedAnswer = typeof root.revisedAnswer === 'string' ? root.revisedAnswer : null
  const actionsTaken = isStringArray(root.actionsTaken) ? root.actionsTaken : null
  const confidence = parseNumber(root.confidence)
  const reviewRaw = asRecord(root.review)
  if (
    objective == null ||
    candidateAnswer == null ||
    revisedAnswer == null ||
    actionsTaken == null ||
    confidence == null ||
    reviewRaw == null
  ) {
    return null
  }

  const verdictRaw = reviewRaw.verdict
  const verdict = verdictRaw === 'PASS' || verdictRaw === 'REVISE' || verdictRaw === 'FAIL' ? verdictRaw : null
  const overallScore = parseNumber(reviewRaw.overallScore)
  const rationale = typeof reviewRaw.rationale === 'string' ? reviewRaw.rationale : null
  const criticalIssues = isStringArray(reviewRaw.criticalIssues) ? reviewRaw.criticalIssues : null
  const recommendedEdits = isStringArray(reviewRaw.recommendedEdits) ? reviewRaw.recommendedEdits : null
  const dimensions = asRecord(reviewRaw.dimensionScores)
  if (
    verdict == null ||
    overallScore == null ||
    rationale == null ||
    criticalIssues == null ||
    recommendedEdits == null ||
    dimensions == null
  ) {
    return null
  }

  const correctness = parseNumber(dimensions.correctness)
  const completeness = parseNumber(dimensions.completeness)
  const clarity = parseNumber(dimensions.clarity)
  const constraintCompliance = parseNumber(dimensions.constraintCompliance)
  if (correctness == null || completeness == null || clarity == null || constraintCompliance == null) {
    return null
  }

  return {
    objective,
    candidateAnswer,
    revisedAnswer,
    actionsTaken,
    confidence,
    review: {
      verdict,
      overallScore,
      rationale,
      criticalIssues,
      recommendedEdits,
      dimensionScores: {
        correctness,
        completeness,
        clarity,
        constraintCompliance,
      },
    },
  }
}
