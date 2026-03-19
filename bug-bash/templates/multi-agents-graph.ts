import { Agent, BedrockModel, Graph } from '@strands-agents/sdk'

const model = new BedrockModel({ maxTokens: 1024 })

const researcher = new Agent({
  model,
  printer: false,
  id: 'researcher',
  systemPrompt: 'Research the topic and provide key facts in 2-3 sentences.',
})

const writer = new Agent({
  model,
  printer: false,
  id: 'writer',
  systemPrompt: 'Rewrite the research into a polished paragraph.',
})

const graph = new Graph({
  nodes: [researcher, writer],
  edges: [['researcher', 'writer']],
})

const result = await graph.invoke('What is the largest ocean on Earth?')
console.log('Status:', result.status)
console.log('Output:', result.content.find((b) => b.type === 'textBlock')?.text)
