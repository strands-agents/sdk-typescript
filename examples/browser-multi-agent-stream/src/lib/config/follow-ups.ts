export const FOLLOW_UP_SUGGESTIONS: Record<string, string[]> = {
  session: [
    'What preferences do you currently remember for me?',
    'Update my preference: I prefer concise bullets and weekly status summaries.',
    'Using my saved preferences, rewrite the previous answer.',
    'Forget my last preference and store this instead: prioritize risk-first recommendations.',
  ],
  steering: [
    'Revise the plan with explicit approval checkpoints before risky steps.',
    'Keep the same goal but optimize for lower cost and faster delivery.',
    'Add stricter rollback gates and measurable go/no-go criteria.',
    'Provide two alternatives with clear tradeoffs and recommend one.',
  ],
  interrupts: [
    'Pause before execution and ask for explicit approval on any production-impacting action.',
    'Rewrite the plan so every risky step has a human confirmation gate.',
  ],
  'mode:single': [
    'Refine your previous answer with tighter scope and concrete next actions.',
  ],
  'mode:swarm': [
    'Keep the same team roles but reduce handoffs and focus on concise output.',
  ],
  'mode:graph': [
    'Keep this DAG, but tighten each node output contract to one short paragraph.',
  ],
  session_context: [
    'Continue from previous context and only include changes since the last response.',
  ],
}
