import type { StructuredOutputSchemaId } from '../types'

export const STRUCTURED_OUTPUT_SCHEMAS: Record<
  StructuredOutputSchemaId,
  {
    label: string
    summary: string
    schema: Record<string, unknown>
    example: Record<string, unknown>
  }
> = {
  article_summary_v1: {
    label: 'article_summary_v1',
    summary:
      'The agent must return strict JSON with a concise article summary payload.',
    schema: {
      type: 'object',
      required: ['title', 'summary', 'sentiment', 'keywords'],
      additionalProperties: false,
      properties: {
        title: { type: 'string', minLength: 1 },
        summary: { type: 'string', minLength: 1 },
        sentiment: {
          type: 'string',
          enum: ['positive', 'neutral', 'negative'],
        },
        keywords: {
          type: 'array',
          minItems: 3,
          maxItems: 10,
          items: { type: 'string', minLength: 1 },
        },
      },
    },
    example: {
      title:
        'TypeScript Adoption Rises Despite Migration Tradeoffs',
      summary:
        'Teams are adopting TypeScript for safer refactoring and maintainability, while migration effort can slow short-term delivery.',
      sentiment: 'neutral',
      keywords: ['typescript', 'adoption', 'refactoring', 'maintainability'],
    },
  },
  orchestration_decision_v1: {
    label: 'orchestration_decision_v1',
    summary:
      'Decision contract for orchestrator-led dynamic sub-agent execution.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'objective',
        'decision',
        'confidence',
        'teamDesign',
        'keyMetrics',
        'topRisks',
        'artifacts',
        'assumptions',
        'executiveSummary',
      ],
      properties: {
        objective: { type: 'string', minLength: 1 },
        decision: { type: 'string', enum: ['GO', 'HOLD'] },
        confidence: { type: 'number', minimum: 0, maximum: 100 },
        teamDesign: {
          type: 'array',
          minItems: 3,
          maxItems: 6,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'role', 'tools', 'justification'],
            properties: {
              name: { type: 'string', minLength: 1 },
              role: { type: 'string', minLength: 1 },
              tools: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
              },
              justification: { type: 'string', minLength: 1 },
            },
          },
        },
        keyMetrics: {
          type: 'object',
          additionalProperties: false,
          required: [
            'projectedActiveUsersMonth',
            'infraCostPerActiveUserUsd',
            'supportCapacityGap',
          ],
          properties: {
            projectedActiveUsersMonth: { type: 'number' },
            infraCostPerActiveUserUsd: { type: 'number' },
            supportCapacityGap: { type: 'number' },
          },
        },
        topRisks: {
          type: 'array',
          minItems: 3,
          maxItems: 5,
          items: { type: 'string', minLength: 1 },
        },
        artifacts: {
          type: 'object',
          additionalProperties: false,
          required: ['reportPath', 'journalTasksLogged'],
          properties: {
            reportPath: { type: 'string', minLength: 1 },
            journalTasksLogged: { type: 'number', minimum: 0 },
          },
        },
        assumptions: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: { type: 'string', minLength: 1 },
        },
        executiveSummary: { type: 'string', minLength: 1 },
      },
    },
    example: {
      objective: 'Assess Atlas launch readiness with dynamic specialist team analysis.',
      decision: 'HOLD',
      confidence: 78,
      teamDesign: [
        {
          name: 'demand_analyst',
          role: 'Forecast activation and growth load.',
          tools: ['calculator', 'parse_json'],
          justification: 'Needed for deterministic volume projections.',
        },
        {
          name: 'reliability_engineer',
          role: 'Evaluate latency/SLO and incident signals.',
          tools: ['parse_json'],
          justification: 'Converts raw reliability telemetry into gating criteria.',
        },
        {
          name: 'support_planner',
          role: 'Estimate support staffing shortfall.',
          tools: ['calculator'],
          justification: 'Computes ticket capacity gap and mitigation options.',
        },
      ],
      keyMetrics: {
        projectedActiveUsersMonth: 30240,
        infraCostPerActiveUserUsd: 1.79,
        supportCapacityGap: 3,
      },
      topRisks: [
        'Support capacity below expected demand',
        'p95 latency above SLA target',
        'Elevated recent incident frequency',
      ],
      artifacts: {
        reportPath: './artifacts/atlas_governance_report.md',
        journalTasksLogged: 2,
      },
      assumptions: [
        'Activation rate remains stable across the month.',
        'Ticket capacity per agent is unchanged.',
      ],
      executiveSummary:
        'Dynamic specialist analysis indicates launch risk remains above threshold; hold release until support and latency controls are improved.',
    },
  },
  agent_review_verdict_v1: {
    label: 'agent_review_verdict_v1',
    summary:
      'Evaluation contract for LLM-as-judge flows with scoring, verdict, and revision trace.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'objective',
        'candidateAnswer',
        'review',
        'revisedAnswer',
        'actionsTaken',
        'confidence',
      ],
      properties: {
        objective: { type: 'string', minLength: 1 },
        candidateAnswer: { type: 'string', minLength: 1 },
        review: {
          type: 'object',
          additionalProperties: false,
          required: [
            'verdict',
            'overallScore',
            'dimensionScores',
            'rationale',
            'criticalIssues',
            'recommendedEdits',
          ],
          properties: {
            verdict: { type: 'string', enum: ['PASS', 'REVISE', 'FAIL'] },
            overallScore: { type: 'number', minimum: 0, maximum: 100 },
            dimensionScores: {
              type: 'object',
              additionalProperties: false,
              required: ['correctness', 'completeness', 'clarity', 'constraintCompliance'],
              properties: {
                correctness: { type: 'number', minimum: 0, maximum: 100 },
                completeness: { type: 'number', minimum: 0, maximum: 100 },
                clarity: { type: 'number', minimum: 0, maximum: 100 },
                constraintCompliance: { type: 'number', minimum: 0, maximum: 100 },
              },
            },
            rationale: { type: 'string', minLength: 1 },
            criticalIssues: {
              type: 'array',
              maxItems: 5,
              items: { type: 'string', minLength: 1 },
            },
            recommendedEdits: {
              type: 'array',
              maxItems: 8,
              items: { type: 'string', minLength: 1 },
            },
          },
        },
        revisedAnswer: { type: 'string', minLength: 1 },
        actionsTaken: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: { type: 'string', minLength: 1 },
        },
        confidence: { type: 'number', minimum: 0, maximum: 100 },
      },
    },
    example: {
      objective: 'Plan migration from polling to event-driven updates within six weeks.',
      candidateAnswer:
        'Phase rollout by domain, deploy event bus adapters, and monitor error budgets during dual-run.',
      review: {
        verdict: 'REVISE',
        overallScore: 81,
        dimensionScores: {
          correctness: 86,
          completeness: 74,
          clarity: 83,
          constraintCompliance: 79,
        },
        rationale:
          'Plan is directionally solid but lacks explicit rollback sequencing and dependency gating.',
        criticalIssues: [
          'Rollback path does not define trigger thresholds.',
          'No explicit ownership map for production cutover.',
        ],
        recommendedEdits: [
          'Add rollback gates tied to latency/error SLOs.',
          'Define on-call ownership by migration phase.',
          'Add explicit no-downtime validation checklist.',
        ],
      },
      revisedAnswer:
        'Added phased rollback gates, ownership map, and no-downtime verification checklist while preserving six-week timeline.',
      actionsTaken: [
        'Ran builder swarm to draft baseline plan.',
        'Ran judge swarm for rubric scoring and critique.',
        'Applied high-priority edits from judge feedback.',
      ],
      confidence: 84,
    },
  },
}
