import { Agent, BedrockModel, SessionManager, FileStorage } from '@strands-agents/sdk'

const session = new SessionManager({
  sessionId: 'test-session',
  storage: { snapshot: new FileStorage('/tmp/strands-sessions') },
  saveLatestOn: 'invocation',
})

const agent = new Agent({
  model: new BedrockModel(),
  sessionManager: session,
  id: 'my-agent',
})

// First invocation, state is saved
await agent.invoke('Remember that my favorite color is blue.')

// Create a new agent with the same session to test restore
const agent2 = new Agent({
  model: new BedrockModel(),
  sessionManager: new SessionManager({
    sessionId: 'test-session',
    storage: { snapshot: new FileStorage('/tmp/strands-sessions') },
  }),
  id: 'my-agent',
})

await agent2.invoke('What is my favorite color?')
