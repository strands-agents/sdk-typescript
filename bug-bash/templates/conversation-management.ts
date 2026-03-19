import { Agent, BedrockModel, SlidingWindowConversationManager } from '@strands-agents/sdk'

const agent = new Agent({
  model: new BedrockModel(),
  conversationManager: new SlidingWindowConversationManager({ windowSize: 4 }),
  printer: false,
})

await agent.invoke('My name is Alice.')
console.log('Messages after turn 1:', agent.messages.length)

await agent.invoke('I live in Seattle.')
console.log('Messages after turn 2:', agent.messages.length)

await agent.invoke('I like pizza.')
console.log('Messages after turn 3:', agent.messages.length)

await agent.invoke('What is my name?')
console.log('Messages after turn 4:', agent.messages.length)
console.log('Last response:', agent.messages[agent.messages.length - 1]?.content)
