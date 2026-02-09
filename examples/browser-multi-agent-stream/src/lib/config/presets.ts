import type { PresetConfig } from '../types'

export const PRESETS: Record<string, PresetConfig> = {
  single: {
    mode: 'single',
    agents: [
      {
        id: 'sg1',
        name: 'assistant',
        systemPrompt: 'You are a concise assistant. Provide direct, practical answers.',
      },
    ],
    singleAgent: 'assistant',
    prompt: 'Give me three practical tips for improving TypeScript compile performance.',
  },
  research: {
    mode: 'swarm',
    agents: [
      { id: 'r1', name: 'researcher', systemPrompt: 'You are a researcher. Answer briefly. If the question needs a specialist, say "Hand off to writer" and nothing else.' },
      { id: 'r2', name: 'writer', systemPrompt: 'You are a writer. You receive handoffs from the researcher. Give a short, clear final answer.' },
    ],
  },
  code: {
    mode: 'swarm',
    agents: [
      { id: 'c1', name: 'planner', systemPrompt: 'You are a planner. Decide what to build and hand off to coder with a short spec.' },
      { id: 'c2', name: 'coder', systemPrompt: 'You are a coder. Implement what the planner specified. Hand off to reviewer when done.' },
      { id: 'c3', name: 'reviewer', systemPrompt: 'You are a reviewer. Review the coder output and give a short final summary.' },
    ],
  },
  content: {
    mode: 'swarm',
    agents: [
      { id: 'p1', name: 'researcher', systemPrompt: 'You are a researcher. Gather key points briefly. Hand off to drafter.' },
      { id: 'p2', name: 'drafter', systemPrompt: 'You are a drafter. Turn research into a short draft. Hand off to editor.' },
      { id: 'p3', name: 'editor', systemPrompt: 'You are an editor. Polish the draft and give the final answer.' },
    ],
  },
  tools: {
    mode: 'swarm',
    agents: [
      {
        id: 't1',
        name: 'time',
        systemPrompt:
          'You have current_time and handoff_to_agent. Get the current time, then call handoff_to_agent with agent_name "math" and a short message that includes the time so the next agent can pass it along.',
        tools: ['current_time'],
      },
      {
        id: 't2',
        name: 'math',
        systemPrompt:
          'You have calculator and handoff_to_agent. You receive handoffs from time with the current time. Run the requested calculation (e.g. 7*8+9), then call handoff_to_agent with agent_name "synthesizer" and a message that includes both the time and the calculation result.',
        tools: ['calculator'],
      },
      {
        id: 't3',
        name: 'synthesizer',
        systemPrompt:
          'You receive handoffs from math with the time and calculation result. You have no tools. Combine them into one clear, full answer for the user. Do not re-fetch time or re-calculate—use exactly what was passed to you.',
        tools: [],
      },
    ],
    prompt: 'What time is it and what is 7 * 8 + 9?',
  },
  graph: {
    mode: 'graph',
    agents: [
      {
        id: 'g1',
        name: 'analyst',
        systemPrompt:
          'You are a topic analyst. Break down the given topic into 2-3 key angles or themes. Be concise—just list the angles with a one-sentence description each.',
      },
      {
        id: 'g2',
        name: 'creative',
        systemPrompt:
          'You are a creative writer. You receive analysis from the analyst. Write a short, engaging paragraph about the topic using a storytelling or persuasive style. Focus on making it compelling for a general audience.',
      },
      {
        id: 'g3',
        name: 'technical',
        systemPrompt:
          'You are a technical writer. You receive analysis from the analyst. Write a short, precise paragraph covering the technical details and facts. Focus on accuracy and clarity for an informed audience.',
      },
      {
        id: 'g4',
        name: 'editor',
        systemPrompt:
          'You are the final editor. You receive the creative piece and the technical piece. Synthesize them into one cohesive, polished summary that balances engagement with accuracy. Provide the final answer.',
      },
    ],
    edges: [
      { from: 'analyst', to: 'creative' },
      { from: 'analyst', to: 'technical' },
      { from: 'creative', to: 'editor' },
      { from: 'technical', to: 'editor' },
    ],
    entryPoints: ['analyst'],
    prompt: 'Explain why renewable energy adoption is accelerating worldwide',
  },
  orchestrator_factory: {
    mode: 'single',
    agents: [
      {
        id: 'of1',
        name: 'orchestrator',
        systemPrompt:
          'You are the top-level orchestrator. Your job is to run a single swarm call to create a temporary specialist team, then use the swarm result plus your own tools to produce the final deliverable. Do not call swarm more than once.\n\n' +
          'Swarm call:\n' +
          '- Pass "task" (clear instruction for the specialists) and "agents": an array of specialist objects. You must include one object per specialist—e.g. for a 3-agent team, "agents" must have exactly 3 elements. Each element must be an object with "name" (string) and "system_prompt" (string). Do not omit any specialist: for launch-readiness you must include demand_analyst, reliability_analyst, and support_planner—all three are required. Do not pass one or two agents; do not merge roles into one entry. Optionally set max_handoffs (e.g. 3), max_iterations (e.g. 6), execution_timeout (e.g. 90), node_timeout (e.g. 30). Sub-agents use cost-effective defaults; only set model_profile or model_settings if the task clearly requires a different profile.\n' +
          '- Sub-agents cannot use file_write, journal, or swarm. Give them only tools they need (e.g. calculator); keep sub-agent tools minimal.\n' +
          '- Instruct a strict handoff chain so each specialist hands off to exactly one next agent: demand_analyst hands off only to reliability_analyst; reliability_analyst only to support_planner; support_planner provides final findings. In each agent\'s system_prompt, state the single handoff target (e.g. "When done, hand off only to reliability_analyst"). Do not instruct any specialist to hand off to multiple agents at once.\n\n' +
          'After swarm returns:\n' +
          '- Use calculator to compute any required metrics that are missing or need verification. Do not call swarm again.\n' +
          '- Write exactly one report with file_write (one call). Add exactly two follow-up tasks with journal (two calls).\n' +
          '- Produce your final response in the required structure, then stop—no further tool calls.\n\n' +
          'Evidence: Only claim a calculation, file write, or journal action if the tool output confirms it. Keep the final answer compact, concrete, and decision-ready.',
        tools: [
          'swarm',
          'parse_json',
          'calculator',
          'current_time',
          'file_write',
          'file_read',
          'journal',
          'think',
        ],
      },
    ],
    singleAgent: 'orchestrator',
    prompt:
      'Run a launch-readiness war room for Project Atlas.\n\n' +
      'Input dataset (JSON):\n' +
      '{"signups_per_week":18000,"activation_rate":0.42,"infra_cost_monthly_usd":54000,"expected_tickets_per_week":3100,"tickets_per_agent_capacity":420,"current_support_agents":5,"error_budget_burn_pct":63,"incident_count_last_14d":4,"p95_latency_ms":410,"sla_target_p95_ms":350}\n\n' +
      'Required:\n' +
      '1) In one swarm call, pass "agents" as an array of exactly 3 objects—one per specialist. All three are required: (1) demand_analyst, (2) reliability_analyst, (3) support_planner. Use a strict handoff chain: in each system_prompt, tell that agent to hand off to only the next one in line—demand_analyst → reliability_analyst only; reliability_analyst → support_planner only; support_planner gives final findings (no handoff to both or multiple agents). Example: demand_analyst system_prompt should say "When done, hand off only to reliability_analyst." Do not omit reliability_analyst; the team must include all three.\n' +
      '2) Compute these metrics (use calculator if needed): projected_active_users_month = signups_per_week * activation_rate * 4.33; infra_cost_per_active_user = infra_cost_monthly_usd / projected_active_users_month; support_capacity_gap = expected_tickets_per_week - (current_support_agents * tickets_per_agent_capacity).\n' +
      '3) Decide GO or HOLD with confidence score (0–100) and top 3 launch risks.\n' +
      '4) Write exactly one report to ./artifacts/atlas_launch_report.md (≤ 800 words).\n' +
      '5) Add exactly two follow-up tasks via journal.\n' +
      '6) Final response structure: Team Design → Key Calculations → Decision (GO/HOLD + confidence) → Top 3 Risks → Artifact + Journal Confirmation → Executive Summary (≤ 120 words).\n\n' +
      'Stop immediately after producing the final structured response.',
  },
  orchestrator_contract: {
    mode: 'single',
    agents: [
      {
        id: 'oc1',
        name: 'orchestrator',
        systemPrompt:
          'You are a principal orchestration agent. For complex tasks, call swarm once to generate and run a temporary specialist team. Default spawned sub-agents to the curated Bedrock default profile unless the task clearly requires a different profile/model. Keep sub-agent tools minimal and never allow sub-agents to call file-writing, journaling, or recursive swarm tools. Use tool outputs as evidence, compute required metrics, write exactly one concise report artifact, and return only structured output that conforms to the configured schema.',
        tools: [
          'swarm',
          'parse_json',
          'calculator',
          'file_write',
          'file_read',
          'journal',
          'think',
        ],
      },
    ],
    singleAgent: 'orchestrator',
    structuredOutputSchema: 'orchestration_decision_v1',
    prompt:
      'You are running release governance for project Atlas.\n\nInput dataset:\n{"signups_per_week":18000,"activation_rate":0.42,"infra_cost_monthly_usd":54000,"expected_tickets_per_week":3100,"tickets_per_agent_capacity":420,"current_support_agents":5,"error_budget_burn_pct":63,"incident_count_last_14d":4,"p95_latency_ms":410,"sla_target_p95_ms":350}\n\nRequired workflow:\n1) Call swarm exactly once and create a 4-agent team: demand analyst, reliability engineer, support planner, decision editor.\n2) In the swarm payload, set each spawned specialist to model_provider "bedrock". Use curated defaults unless quality/reasoning/coding needs justify explicit model_profile or curated model_settings.model_id.\n3) Team must produce and you must verify: projectedActiveUsersMonth, infraCostPerActiveUserUsd, supportCapacityGap.\n4) Decide GO or HOLD with confidence score.\n5) Write exactly one concise report to ./artifacts/atlas_governance_report.md (max 1200 words).\n6) Add exactly two follow-up tasks with journal.\n\nReturn final answer strictly through structured output.',
  },
  agent_review_judge: {
    mode: 'single',
    agents: [
      {
        id: 'ar1',
        name: 'review_orchestrator',
        systemPrompt:
          'You are a review orchestrator. You must run exactly two swarm calls: one builder swarm, then one judge swarm. Use curated Bedrock defaults for spawned sub-agents unless there is a clear reason to override. After the builder call, extract a single candidate plan and pass that exact candidate text into the judge swarm task under a clear "Candidate Plan To Review" section. Judge agents must score and critique the provided candidate, not rewrite from scratch. If verdict is REVISE or FAIL, revise once using judge feedback. Do not call file-writing or journaling tools for this preset. Keep outputs concise and finish immediately after emitting the required structured output.',
        tools: ['swarm', 'parse_json', 'calculator', 'think'],
      },
    ],
    singleAgent: 'review_orchestrator',
    structuredOutputSchema: 'agent_review_verdict_v1',
    prompt:
      'Task: Draft an implementation plan to migrate a large TypeScript API from polling to event-driven updates.\n\nConstraints:\n- Keep rollout under 6 weeks.\n- Avoid downtime.\n- Include observability and rollback strategy.\n- Include top risks and mitigations.\n- Do not write files or produce extra documents.\n\nRequired process:\n1) Call swarm to create a builder team (planner, platform engineer, reliability engineer) and produce a candidate answer.\n2) In the builder swarm payload, set each spawned specialist to model_provider "bedrock". Use curated defaults unless stronger quality/reasoning/coding is required, then use model_profile or curated model_settings.model_id.\n3) Call swarm again to create a judge team (strict reviewer + product stakeholder proxy), defaulting to the same curated profile strategy.\n4) The second swarm task must include the full candidate answer verbatim in a section titled "Candidate Plan To Review".\n5) Ask the judge team to score that exact candidate on correctness, completeness, clarity, and constraint compliance.\n6) If verdict is REVISE or FAIL, improve the answer once using judge feedback.\n7) In actionsTaken, explicitly state that the candidate plan was passed to the judge swarm.\n8) Return only structured output.',
  },
  custom: { agents: [] },
  structured_output: {
    mode: 'single',
    agents: [
      {
        id: 'so1',
        name: 'extractor',
        systemPrompt:
          'Extract article information and respond through structured output only.',
        tools: [],
      },
    ],
    singleAgent: 'extractor',
    structuredOutputSchema: 'article_summary_v1',
    prompt:
      'Extract a structured summary from this article:\n"TypeScript adoption is climbing because teams want better refactoring safety and maintainability. However, migration costs can slow teams down."',
  },
  session: {
    mode: 'single',
    agents: [
      {
        id: 's1',
        name: 'memory_coach',
        systemPrompt:
          'You maintain user preferences across runs using conversation memory. When asked about saved preferences, answer from remembered context. If no preferences have been shared yet, say that clearly and ask for them.',
      },
    ],
    singleAgent: 'memory_coach',
    sessionId: 'session-persistence-guide',
    prompt:
      'Store this preference and confirm: "I prefer concise answers and weekly execution summaries."',
  },
  agent_tool: {
    mode: 'swarm',
    agents: [
      {
        id: 'at1',
        name: 'orchestrator',
        systemPrompt:
          'Delegate math and writing subtasks clearly, then merge responses into one final answer.',
      },
      {
        id: 'at2',
        name: 'specialist',
        systemPrompt:
          'Handle delegated calculations and draft concise, factual text when asked by the orchestrator.',
        tools: ['calculator'],
      },
    ],
    prompt: 'Create a two-line brief: include 23*19 result and one sentence on why delegation improves reliability.',
  },
  telemetry: {
    mode: 'swarm',
    agents: [
      {
        id: 'te1',
        name: 'observer',
        systemPrompt:
          'Use tools and explicit reasoning so traces include rich spans and events.',
        tools: ['current_time', 'calculator', 'think'],
      },
      {
        id: 'te2',
        name: 'summarizer',
        systemPrompt: 'Summarize the observer output into a final concise answer.',
      },
    ],
    prompt: 'Get current time, compute 144/12+7, then provide a concise incident-style summary.',
  },
  interrupts: {
    mode: 'single',
    agents: [
      {
        id: 'i1',
        name: 'reviewer',
        systemPrompt:
          'Propose a risky action and explicitly ask for human confirmation before proceeding.',
      },
    ],
    singleAgent: 'reviewer',
    prompt: 'Draft a production-change plan that requires explicit user confirmation before execution.',
  },
  steering: {
    mode: 'swarm',
    agents: [
      {
        id: 'st1',
        name: 'planner',
        systemPrompt:
          'Generate a plan with checkpoints and explicit opportunities for steering adjustments.',
      },
      {
        id: 'st2',
        name: 'executor',
        systemPrompt:
          'Follow the plan, report deviations, and provide options where guidance could alter execution.',
      },
    ],
    prompt: 'Plan and execute a phased migration from REST polling to event-driven updates.',
  },
}
