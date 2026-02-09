import { z } from 'zod'

export type StructuredOutputSchemaId =
  | 'article_summary_v1'
  | 'orchestration_decision_v1'
  | 'agent_review_verdict_v1'

export const STRUCTURED_OUTPUT_SCHEMAS: Record<StructuredOutputSchemaId, z.ZodType> = {
  article_summary_v1: z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    sentiment: z.enum(['positive', 'neutral', 'negative']),
    keywords: z.array(z.string().min(1)).min(3).max(10),
  }),
  orchestration_decision_v1: z
    .object({
      objective: z.string().min(1),
      decision: z.enum(['GO', 'HOLD']),
      confidence: z.number().min(0).max(100),
      teamDesign: z
        .array(
          z
            .object({
              name: z.string().min(1),
              role: z.string().min(1),
              tools: z.array(z.string().min(1)),
              justification: z.string().min(1),
            })
            .strict()
        )
        .min(3)
        .max(6),
      keyMetrics: z
        .object({
          projectedActiveUsersMonth: z.number(),
          infraCostPerActiveUserUsd: z.number(),
          supportCapacityGap: z.number(),
        })
        .strict(),
      topRisks: z.array(z.string().min(1)).min(3).max(5),
      artifacts: z
        .object({
          reportPath: z.string().min(1),
          journalTasksLogged: z.number().int().min(0),
        })
        .strict(),
      assumptions: z.array(z.string().min(1)).min(1).max(6),
      executiveSummary: z.string().min(1),
    })
    .strict(),
  agent_review_verdict_v1: z
    .object({
      objective: z.string().min(1),
      candidateAnswer: z.string().min(1),
      review: z
        .object({
          verdict: z.enum(['PASS', 'REVISE', 'FAIL']),
          overallScore: z.number().min(0).max(100),
          dimensionScores: z
            .object({
              correctness: z.number().min(0).max(100),
              completeness: z.number().min(0).max(100),
              clarity: z.number().min(0).max(100),
              constraintCompliance: z.number().min(0).max(100),
            })
            .strict(),
          rationale: z.string().min(1),
          criticalIssues: z.array(z.string().min(1)).max(5),
          recommendedEdits: z.array(z.string().min(1)).max(8),
        })
        .strict(),
      revisedAnswer: z.string().min(1),
      actionsTaken: z.array(z.string().min(1)).min(1).max(8),
      confidence: z.number().min(0).max(100),
    })
    .strict(),
}
