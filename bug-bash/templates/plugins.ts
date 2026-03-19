import { Agent, BedrockModel, BeforeInvocationEvent, AfterInvocationEvent, BeforeToolCallEvent, AfterModelCallEvent, AgentResultEvent, tool } from '@strands-agents/sdk'
import { z } from 'zod'

// --- Hooks ---

const counterTool = tool({
  name: 'increment_counter',
  description: 'Increments a counter stored in agent appState.',
  inputSchema: z.object({}),
  callback: (_input, context) => {
    const current = context!.agent.appState.get<number>('counter') ?? 0
    context!.agent.appState.set('counter', current + 1)
    return `Counter is now ${current + 1}`
  },
})

const agent = new Agent({
  model: new BedrockModel(),
  tools: [counterTool],
  printer: false,
})

// Register lifecycle hooks
agent.addHook(BeforeInvocationEvent, () => console.log('[hook] beforeInvocation'))
agent.addHook(AfterInvocationEvent, () => console.log('[hook] afterInvocation'))
agent.addHook(BeforeToolCallEvent, (e) => console.log(`[hook] beforeToolCall: ${e.toolUse.name}`))
agent.addHook(AgentResultEvent, (e) => console.log(`[hook] agentResult: ${e.result.stopReason}`))

// Cleanup: this hook should NOT fire after cleanup() is called
const cleanup = agent.addHook(AfterModelCallEvent, () => console.log('[hook] SHOULD NOT FIRE'))
cleanup()

// --- Retry ---
// Uncomment to test retry on model error:
// agent.addHook(AfterModelCallEvent, (event) => {
//   if (event.error) {
//     console.log('[hook] retrying model call...')
//     event.retry = true
//   }
// })

// --- App State ---

agent.appState.set('greeting', 'hello')
console.log('Pre-set state:', agent.appState.get('greeting'))

await agent.invoke('Increment the counter 3 times.')
console.log('Counter:', agent.appState.get('counter'))
