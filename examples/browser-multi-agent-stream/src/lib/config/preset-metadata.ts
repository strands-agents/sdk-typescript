import type { PresetGuide } from '../types'
import { PRESETS } from './presets'

/** Display labels for preset dropdown. */
export const PRESET_LABELS: Record<string, string> = {
  single: 'Single Agent',
  research: 'Research Team',
  code: 'Code Review',
  content: 'Content Pipeline',
  tools: 'Tool demo',
  orchestrator_factory: 'Orchestrator Factory',
  orchestrator_contract: 'Orchestrator Contract',
  agent_review_judge: 'Agent Review / LLM Judge',
  structured_output: 'Structured Output Guide',
  session: 'Session / Persistence Guide',
  agent_tool: 'Agents-as-Tools Guide',
  telemetry: 'Telemetry / Tracing Guide',
  interrupts: 'Interrupts Guide',
  steering: 'Steering Guide',
  custom: 'Custom',
}

export const PRESET_GUIDES: Record<string, PresetGuide> = {
  single: {
    feature: 'Single Agent',
    summary: 'Fast, focused baseline with one agent.',
    steps: [
      'Use this as your baseline before adding orchestration complexity.',
      'Tune the system prompt for voice and constraints.',
      'Compare cost/latency against team-based presets in History.',
    ],
  },
  research: {
    feature: 'Swarm',
    summary: 'Collaborative handoff flow with specialist roles.',
    steps: [
      'Adjust system prompts for stronger role boundaries.',
      'Change entry point and max handoffs to test convergence behavior.',
      'Compare execution order and per-node costs in Metrics + History.',
    ],
  },
  code: {
    feature: 'Swarm',
    summary: 'Planner/coder/reviewer loop for iterative delivery.',
    steps: [
      'Increase complexity in prompt and watch extra handoffs.',
      'Limit tools on reviewer to force concise QA feedback.',
      'Inspect timeline lanes for bottlenecks.',
    ],
  },
  content: {
    feature: 'Swarm',
    summary: 'Pipeline-style collaboration for content generation.',
    steps: [
      'Swap role order to see impact on quality and cost.',
      'Tune prompts for brevity vs depth.',
      'Review historical runs to compare prompt variants.',
    ],
  },
  tools: {
    feature: 'Tooling + Swarm',
    summary: 'Constrained tool access per agent.',
    steps: [
      'Edit tool lists to test least-privilege patterns.',
      'Try invalid tools and verify safe filtering behavior.',
      'Track per-node token/cost impact.',
    ],
  },
  graph: {
    feature: 'Graph',
    summary: 'Deterministic DAG with parallel branches and merge.',
    steps: [
      'Add/remove edges and entry points to reshape execution.',
      'Use History to inspect node order across iterations.',
      'Tune prompt specificity per node for deterministic outputs.',
    ],
  },
  orchestrator_factory: {
    feature: 'Dynamic Sub-Agent Orchestration',
    summary: 'Single orchestrator dynamically creates and runs a specialist team via the swarm tool.',
    steps: [
      'Keep the top-level mode on Single so all delegation happens through one orchestrator agent.',
      'Inspect Logs for the swarm tool call payload and generated specialist roles/tool scopes.',
      'Use History to compare orchestration quality, token cost, and decision consistency across prompt variants.',
    ],
  },
  orchestrator_contract: {
    feature: 'Orchestration + Structured Contract',
    summary: 'Dynamic sub-agent generation with strict JSON output for downstream systems.',
    steps: [
      'Run once and verify the output is valid against orchestration_decision_v1.',
      'Inspect Logs to confirm swarm was called and specialist team design was generated.',
      'Review History to compare confidence, decision, and cost trends across prompt or data changes.',
    ],
  },
  agent_review_judge: {
    feature: 'Agent Review / LLM-as-Judge',
    summary: 'Two-stage orchestration: builder team creates, judge team evaluates and drives revision.',
    steps: [
      'Inspect Logs to verify two swarm calls: one for generation, one for judging.',
      'Confirm structured output includes verdict, dimension scores, and any revised answer.',
      'Use History to benchmark score quality versus token/cost overhead across prompt variants.',
    ],
  },
  structured_output: {
    feature: 'Structured Output',
    summary: 'Schema-enforced JSON extraction (strict).',
    steps: [
      'Run with the default schema and verify output is valid JSON.',
      'Edit the prompt content, keeping extraction scope clear and bounded.',
      'Inspect History output payloads to confirm schema consistency over time.',
    ],
  },
  session: {
    feature: 'Session Management (guided)',
    summary: 'Prompt pattern for persistence-aware workflows.',
    steps: [
      'Run once to store a preference, then run follow-ups to verify memory recall.',
      'Persisted run records are queryable in History dashboard.',
      'This preset uses SDK FileSessionManager with a stable session ID across runs.',
    ],
  },
  agent_tool: {
    feature: 'Agents as Tools (guided)',
    summary: 'Role split mirrors delegator-specialist tool orchestration.',
    steps: [
      'Add specialist-only tools and keep orchestrator lightweight.',
      'Force explicit delegation language in orchestrator prompt.',
      'Measure delegation overhead vs single-agent runs.',
    ],
  },
  telemetry: {
    feature: 'OpenTelemetry',
    summary: 'Rich span generation and run-level trace persistence.',
    steps: [
      'Enable OTEL_ENABLED=1 to emit and store spans.',
      'Inspect Logs and History telemetry snapshots per run.',
      'Compare duration + cost trends over multiple runs.',
    ],
  },
  interrupts: {
    feature: 'Interrupts (guided)',
    summary: 'Prompt design for explicit human approval checkpoints.',
    steps: [
      'Ask for approval gates before risky actions.',
      'Capture approval reasoning in run history events.',
      'Integrate SDK interrupt APIs for full pause/resume flows in custom server logic.',
    ],
  },
  steering: {
    feature: 'Steering (guided)',
    summary: 'Plan/execution checkpoints suited for runtime steering.',
    steps: [
      'Inject policy constraints in planner prompt.',
      'Use run history to compare decisions over time.',
      'Integrate Steering handlers in server for dynamic guidance controls.',
    ],
  },
  custom: {
    feature: 'Custom',
    summary: 'Start from scratch and compose your own scenario.',
    steps: [
      'Add agents, prompts, and tool constraints.',
      'Switch between single and swarm to compare orchestration.',
      'Use history/cost analytics to iterate on quality and efficiency.',
    ],
  },
}

export interface PresetCatalogEntry {
  key: string
  label: string
  feature: string
  summary: string
  mode: 'single' | 'swarm' | 'graph'
  agentCount: number
  hasStructuredOutput: boolean
}

export const PRESET_CATALOG: PresetCatalogEntry[] = Object.entries(PRESET_LABELS)
  .filter(([key]) => key !== 'custom' && key !== 'graph')
  .map(([key, label]) => {
    const preset = PRESETS[key]
    const guide = PRESET_GUIDES[key]
    return {
      key,
      label,
      feature: guide?.feature ?? 'Preset',
      summary: guide?.summary ?? 'Ready-to-run example preset.',
      mode: preset?.mode ?? 'swarm',
      agentCount: preset?.agents?.length ?? 0,
      hasStructuredOutput: preset?.structuredOutputSchema != null,
    }
  })

export interface AgentLibraryEntry {
  libraryId: string
  sourcePresetKey: string
  sourcePresetLabel: string
  sourceFeature: string
  name: string
  systemPrompt: string
  tools: string[]
}

const seenAgentTemplates = new Set<string>()

export const AGENT_LIBRARY: AgentLibraryEntry[] = Object.entries(PRESETS)
  .filter(([presetKey, preset]) => presetKey !== 'custom' && preset.agents.length > 0)
  .flatMap(([presetKey, preset]) =>
    preset.agents.flatMap((agent, index) => {
      const normalizedPrompt = agent.systemPrompt.trim().toLowerCase()
      const normalizedTools = (agent.tools ?? []).join(',').toLowerCase()
      const dedupeKey = `${agent.name.trim().toLowerCase()}::${normalizedPrompt}::${normalizedTools}`
      if (seenAgentTemplates.has(dedupeKey)) return []
      seenAgentTemplates.add(dedupeKey)
      return [
        {
          libraryId: `${presetKey}-${index}-${agent.name}`,
          sourcePresetKey: presetKey,
          sourcePresetLabel: PRESET_LABELS[presetKey] ?? presetKey,
          sourceFeature: PRESET_GUIDES[presetKey]?.feature ?? 'Preset',
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          tools: [...(agent.tools ?? [])],
        },
      ]
    })
  )
  .sort((a, b) => a.name.localeCompare(b.name) || a.sourcePresetLabel.localeCompare(b.sourcePresetLabel))
