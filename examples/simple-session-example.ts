import { Agent, SessionManager } from '@strands-agents/sdk'
import { S3SnapshotStorage } from '../../session/storage/s3-snapshot-storage.js'

// Create agent with S3 storage
const agent = new Agent({
  sessionManager: new SessionManager({
    sessionId: 'demo-session',
    storage: {
      snapshot: new S3SnapshotStorage({
        bucket: 'my-strands-sessions',
        prefix: 'sessions', // Optional: organizes sessions under a prefix
        region: 'us-west-2'
      })
    }
  }),
  state: { user_preferences: { theme: 'dark' }, session_count: 0 }
})

// First invocation
const result = await agent.invoke('What is the square root of 1764?')
agent.state.set('session_count', 1)
console.log('\n📝 After first turn:')
console.log('  Messages:', agent.messages.length)
console.log('  State:', agent.state.getAll())

// Create new agent - it will restore from S3 snapshot
const agent2 = new Agent({
  sessionManager: new SessionManager({
    sessionId: 'demo-session',
    storage: {
      snapshot: new S3SnapshotStorage({
        bucket: 'my-strands-sessions',
        prefix: 'sessions',
        region: 'us-west-2'
      })
    }
  })
})

// Second invocation - should have conversation history AND state
const result2 = await agent2.invoke('What was my previous question?')
console.log('\n📝 After restoration:')
console.log('  Messages:', agent2.messages.length)
console.log('  State:', agent2.state.getAll())
console.log('  Theme:', agent2.state.get('user_preferences'))
console.log('  Count:', agent2.state.get('session_count'))

console.log('\n✓ Session saved to S3: s3://my-strands-sessions/sessions/demo-session/scopes/agent/default/snapshots/')