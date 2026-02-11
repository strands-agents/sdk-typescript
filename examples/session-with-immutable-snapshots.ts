import { Agent, SessionManager } from '@strands-agents/sdk'
import { tmpdir } from 'os'
import { join } from 'path'

console.log('🚀 Part 1: Creating conversation with immutable snapshots...\n')

let turn_count = 1

const agent = new Agent({
  sessionManager: new SessionManager({
    sessionId: 'immutable-demo',
    snapshotTrigger: ({ turnCount }) => turnCount % 1 === 0

  }),
  state: { conversation_count: 0 }
})

// Turn 1
await agent.invoke('What is 10 + 5?')
agent.state.set('conversation_count', 1)
console.log(`✓ Turn ${turn_count++} complete`)


// Turn 2
await agent.invoke('What is 20 * 3?')
agent.state.set('conversation_count', 2)
console.log(`✓ Turn  ${turn_count++} complete!`)

// Turn 3
await agent.invoke('What is 100 / 4?')
agent.state.set('conversation_count', 3)
console.log(`✓ Turn ${turn_count++} complete!`)

// Turn 4
await agent.invoke('What is 50 - 15?')
agent.state.set('conversation_count', 4)
console.log(`✓ Turn ${turn_count++} complete!`)

console.log(`\n📊 Final state: ${JSON.stringify(agent.state.getAll())}`)
console.log(`💬 Total messages: ${agent.messages.length}\n`)

console.log('🔄 Part 2: Time travel to snapshot 2...\n')

// Restore from snapshot 2 (after turn 4)
const agent2 = new Agent({
  sessionManager: new SessionManager({
    sessionId: 'immutable-demo',
      // We restore from snapshot_00002.json
    restoreSnapshotId: 2,
      // We take snapshot every 2 turns
    snapshotTrigger: ({ turnCount }) => turnCount % 2 === 0
  })
})

await agent2.invoke('What was my last question?')
console.log('✅ Travel to snapshot 2!')
await agent2.invoke('Show me our entire conversation?')
console.log('✅ Show conversation!')

console.log(`\n📊 Restored state: ${JSON.stringify(agent2.state.getAll())}`)
console.log(`💬 Restored messages: ${agent2.messages.length}`)
console.log('✓ Successfully restored from snapshot 2!')

const sessionPath = join(tmpdir(), 'strands-sessions/immutable-demo/scopes/agent/default/snapshots')
console.log(`\n📁 Session files: ${sessionPath}`)
