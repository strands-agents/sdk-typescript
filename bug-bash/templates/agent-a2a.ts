import { Agent, BedrockModel } from '@strands-agents/sdk'
import { A2AExpressServer } from '@strands-agents/sdk/a2a'
import express from 'express'

const agent = new Agent({
  model: new BedrockModel(),
  printer: false,
  id: 'test-agent',
  name: 'Test Agent',
  description: 'A simple test agent for A2A.',
})

// Middleware mode: mount A2A endpoints in an Express app
const a2aServer = new A2AExpressServer({ agent, name: 'Test Agent' })
const app = express()
app.use(a2aServer.createMiddleware())

const httpServer = app.listen(9000, '127.0.0.1', async () => {
  console.log('A2A server running on http://127.0.0.1:9000')

  // Test the agent card
  const cardRes = await fetch('http://127.0.0.1:9000/.well-known/agent-card.json')
  const card = await cardRes.json()
  console.log('Agent card:', JSON.stringify(card, null, 2))

  // Test a JSON-RPC message/send
  const rpcRes = await fetch('http://127.0.0.1:9000/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'What is 1 + 1? Reply in one word.' }],
          messageId: 'msg-1',
        },
      },
    }),
  })
  const rpcResult = await rpcRes.json()
  console.log('RPC result:', JSON.stringify(rpcResult, null, 2))

  httpServer.close()
})
