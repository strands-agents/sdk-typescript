import { Agent, BedrockModel, Swarm } from '@strands-agents/sdk'

const model = new BedrockModel({ maxTokens: 1024 })

const researcher = new Agent({
  model,
  printer: false,
  id: 'researcher',
  description: 'Researches a topic and gathers key facts.',
  systemPrompt: 'Research the answer, then hand off to the writer agent.',
})

const writer = new Agent({
  model,
  printer: false,
  id: 'writer',
  description: 'Writes a polished final answer.',
  systemPrompt: 'Write the final answer in one clear paragraph. Do not hand off.',
})

const swarm = new Swarm({
  nodes: [researcher, writer],
  start: 'researcher',
  maxSteps: 4,
})

const result = await swarm.invoke('What is the largest ocean on Earth?')
console.log('Agents:', result.results.map((r) => r.nodeId).join(' -> '))
